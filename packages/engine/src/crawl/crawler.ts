import { createHash } from 'node:crypto';
import { canonicalizeUrl, siteOf } from '../core/url.js';
import { RobotsTxt } from '../core/robots.js';
import { decodeHtml } from '../core/encoding.js';
import { extractHtml } from '../core/html.js';
import { simhash, hammingDistance, type Fingerprint } from '../core/simhash.js';
import { tokenize } from '../core/tokenizer.js';
import type { SearchIndex } from '../index/index.js';
import { Frontier } from './frontier.js';
import { fetchResource, FetchError, type FetchOptions } from './fetcher.js';
import { loadSitemap } from './sitemap.js';

/**
 * The crawler.
 *
 * Seeds go into a polite frontier. Each response is decoded, extracted, deduped
 * (exact content hash plus SimHash for near-duplicates), indexed, and its links
 * are fed back into the frontier. Sitemaps declared in robots.txt and the
 * conventional `/sitemap.xml` are expanded before the link crawl starts, which
 * is what makes a small crawl cover a site completely.
 */

export const DEFAULT_USER_AGENT = 'LomeSearchBot/1.0 (+https://lomesearch.example/bot)';

export interface CrawlOptions {
  seeds: string[];
  index: SearchIndex;
  maxPages?: number;
  maxDepth?: number;
  sameSite?: boolean;
  concurrency?: number;
  perHostDelayMs?: number;
  userAgent?: string;
  respectRobots?: boolean;
  followNofollow?: boolean;
  discoverSitemaps?: boolean;
  maxBytes?: number;
  timeoutMs?: number;
  commitEvery?: number;
  onEvent?: (event: CrawlEvent) => void;
  signal?: AbortSignal;
}

export type CrawlEvent =
  | { type: 'fetched'; url: string; status: number; elapsedMs: number }
  | { type: 'indexed'; url: string; title: string; links: number }
  | { type: 'skipped'; url: string; reason: string }
  | { type: 'error'; url: string; message: string };

export interface CrawlStats {
  fetched: number;
  indexed: number;
  skipped: number;
  errors: number;
  bytes: number;
  sitemapUrls: number;
  durationMs: number;
}

interface RobotsCacheEntry {
  robots: RobotsTxt;
  fetchedAt: number;
}

const ROBOTS_TTL_MS = 60 * 60 * 1000;
const MAX_RECENT_FINGERPRINTS = 4096;
const MAX_SITEMAPS = 64;

export class Crawler {
  private readonly options: Required<
    Pick<
      CrawlOptions,
      | 'maxPages'
      | 'maxDepth'
      | 'sameSite'
      | 'concurrency'
      | 'perHostDelayMs'
      | 'userAgent'
      | 'respectRobots'
      | 'followNofollow'
      | 'discoverSitemaps'
      | 'maxBytes'
      | 'timeoutMs'
      | 'commitEvery'
    >
  >;
  private readonly index: SearchIndex;
  private readonly frontier: Frontier;
  private readonly robotsCache = new Map<string, RobotsCacheEntry>();
  private readonly recentFingerprints: Fingerprint[] = [];
  private readonly seedSites = new Set<string>();
  private readonly seedOrigins = new Set<string>();
  private readonly onEvent?: (event: CrawlEvent) => void;
  private readonly signal?: AbortSignal;
  private inFlight = 0;
  private sinceCommit = 0;
  private stats: CrawlStats = emptyStats();
  private startedAt = 0;

  constructor(options: CrawlOptions) {
    this.index = options.index;
    this.onEvent = options.onEvent;
    this.signal = options.signal;
    this.options = {
      maxPages: options.maxPages ?? 200,
      maxDepth: options.maxDepth ?? 3,
      sameSite: options.sameSite ?? true,
      concurrency: options.concurrency ?? 4,
      perHostDelayMs: options.perHostDelayMs ?? 1_000,
      userAgent: options.userAgent ?? DEFAULT_USER_AGENT,
      respectRobots: options.respectRobots ?? true,
      followNofollow: options.followNofollow ?? false,
      discoverSitemaps: options.discoverSitemaps ?? true,
      maxBytes: options.maxBytes ?? 5 * 1024 * 1024,
      timeoutMs: options.timeoutMs ?? 15_000,
      commitEvery: options.commitEvery ?? 50,
    };
    this.frontier = new Frontier({
      perHostDelayMs: this.options.perHostDelayMs,
      maxConcurrentPerHost: 1,
    });
    for (const seed of options.seeds) {
      const site = siteOf(seed);
      if (site) this.seedSites.add(site);
      try {
        this.seedOrigins.add(new URL(seed).origin);
      } catch {
        // Invalid seeds are ignored; enqueue() rejects them as well.
      }
    }
  }

  /** Adds URLs with the highest priority; used by IndexNow and manual submits. */
  enqueue(urls: string[], priority = 0, depth = 0, lastmod?: string): number {
    let added = 0;
    for (const raw of urls) {
      const url = canonicalizeUrl(raw);
      if (!url) continue;
      if (this.options.sameSite && !this.isAllowedSite(url)) continue;
      if (
        this.frontier.add({
          url,
          priority,
          depth,
          discoveredAt: Date.now(),
          lastmod,
        })
      ) {
        added++;
      }
    }
    return added;
  }

  get pending(): number {
    return this.frontier.size + this.inFlight;
  }

  async run(seeds: string[] = []): Promise<CrawlStats> {
    this.stats = emptyStats();
    this.startedAt = Date.now();
    for (const seed of seeds) this.enqueue([seed], 0, 0);
    if (this.options.discoverSitemaps) await this.expandSitemaps();
    if (this.frontier.size === 0) {
      this.stats.durationMs = Date.now() - this.startedAt;
      return this.stats;
    }

    const workers = Array.from({ length: this.options.concurrency }, () => this.worker());
    await Promise.all(workers);
    if (this.index.hasPendingChanges) this.index.commit();
    this.stats.durationMs = Date.now() - this.startedAt;
    return this.stats;
  }

  private async worker(): Promise<void> {
    for (;;) {
      if (this.signal?.aborted) return;
      if (this.stats.fetched >= this.options.maxPages) return;
      const entry = this.frontier.take();
      if (!entry) {
        if (this.frontier.size === 0 && this.inFlight === 0) return;
        const wait = Math.min(250, Math.max(10, this.frontier.nextWakeAt() - Date.now()));
        await sleep(wait);
        continue;
      }
      this.inFlight++;
      try {
        await this.process(entry.url, entry.depth);
      } catch (error) {
        this.stats.errors++;
        this.emit({
          type: 'error',
          url: entry.url,
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        this.inFlight--;
        this.frontier.complete(entry.url, this.options.perHostDelayMs);
      }
    }
  }

  private async process(url: string, depth: number): Promise<void> {
    if (this.options.respectRobots && !(await this.allowedByRobots(url))) {
      this.stats.skipped++;
      this.emit({ type: 'skipped', url, reason: 'robots.txt' });
      return;
    }

    const previous = this.index.storedDocument(url);
    const headers: Record<string, string> = {};
    if (previous?.etag) headers['if-none-match'] = previous.etag;
    if (previous?.lastModified) headers['if-modified-since'] = previous.lastModified;

    const result = await fetchResource(url, this.fetchOptions(headers));
    this.stats.fetched++;
    this.stats.bytes += result.body.length;
    this.emit({ type: 'fetched', url, status: result.status, elapsedMs: result.elapsedMs });

    if (result.status === 304) {
      this.stats.skipped++;
      this.emit({ type: 'skipped', url, reason: 'not-modified' });
      // The body is unchanged, but the crawl still has to reach the pages it
      // links to: the stored outlinks are reused instead of refetching.
      if (previous && depth < this.options.maxDepth) {
        for (const link of previous.outlinks) {
          if (!this.isAllowedSite(link)) continue;
          this.frontier.add({
            url: link,
            priority: 2,
            depth: depth + 1,
            discoveredAt: Date.now(),
            referrer: url,
          });
        }
      }
      return;
    }
    if (result.status < 200 || result.status >= 300) {
      this.stats.skipped++;
      this.emit({ type: 'skipped', url, reason: `http-${result.status}` });
      return;
    }

    const finalUrl = canonicalizeUrl(result.finalUrl) ?? url;
    if (finalUrl !== url) this.frontier.remember(finalUrl);

    const contentType = result.contentType.split(';')[0]?.trim() ?? '';
    if (contentType !== 'text/html' && contentType !== 'application/xhtml+xml' && contentType !== 'text/plain') {
      this.stats.skipped++;
      this.emit({ type: 'skipped', url, reason: `content-type:${contentType || 'unknown'}` });
      return;
    }

    const contentHash = createHash('sha256').update(result.body).digest('hex');
    if (previous && previous.contentHash === contentHash) {
      this.stats.skipped++;
      this.emit({ type: 'skipped', url, reason: 'unchanged' });
      return;
    }

    if (contentType === 'text/plain') {
      const text = decodeHtml(result.body, result.contentType);
      this.indexDocument({
        url: finalUrl,
        title: finalUrl,
        body: text.slice(0, 24_000),
        contentType,
        status: result.status,
        depth,
        byteSize: result.body.length,
        contentHash,
        etag: result.headers.get('etag') ?? '',
        lastModified: result.headers.get('last-modified') ?? '',
      });
      return;
    }

    const html = decodeHtml(result.body, result.contentType);
    const page = extractHtml(html, { maxTextLength: 24_000, maxLinks: 500 });
    if (page.metaRobots.includes('noindex')) {
      this.stats.skipped++;
      this.emit({ type: 'skipped', url, reason: 'noindex' });
      return;
    }
    if (page.canonical) {
      const canonical = canonicalizeUrl(page.canonical, finalUrl);
      if (canonical && canonical !== finalUrl) {
        this.frontier.remember(canonical);
        this.stats.skipped++;
        this.emit({ type: 'skipped', url, reason: `canonical:${canonical}` });
        return;
      }
    }

    const bodyTokens = tokenize(page.text);
    const fingerprint = simhash(bodyTokens.slice(0, 20_000).map((token) => token.term));
    if (this.isNearDuplicate(fingerprint)) {
      this.stats.skipped++;
      this.emit({ type: 'skipped', url, reason: 'near-duplicate' });
      return;
    }

    const base = page.baseHref ? canonicalizeUrl(page.baseHref, finalUrl) ?? finalUrl : finalUrl;
    const links: string[] = [];
    const discovered: Array<{ url: string; nofollow: boolean }> = [];
    for (const link of page.links) {
      if (link.href.startsWith('#') || /^(javascript|mailto|tel|data):/i.test(link.href)) continue;
      const canonical = canonicalizeUrl(link.href, base);
      if (!canonical) continue;
      // Stored outlinks are the followable ones: they are reused for recrawls
      // and for the link graph, where nofollow must not pass authority.
      if ((!link.nofollow || this.options.followNofollow) && links.length < 500) {
        links.push(canonical);
      }
      discovered.push({ url: canonical, nofollow: link.nofollow });
    }

    this.indexDocument({
      url: finalUrl,
      title: page.title || finalUrl,
      description: page.description || page.ogDescription,
      headings: page.headings,
      body: page.text,
      lang: page.lang,
      contentType,
      status: result.status,
      depth,
      byteSize: result.body.length,
      contentHash,
      outlinks: links,
      etag: result.headers.get('etag') ?? '',
      lastModified: result.headers.get('last-modified') ?? '',
    });
    this.rememberFingerprint(fingerprint);

    if (depth < this.options.maxDepth) {
      for (const link of discovered) {
        if (link.nofollow && !this.options.followNofollow) continue;
        if (!this.isAllowedSite(link.url)) continue;
        this.frontier.add({
          url: link.url,
          priority: 2,
          depth: depth + 1,
          discoveredAt: Date.now(),
          referrer: finalUrl,
        });
      }
    }
  }

  private indexDocument(document: Parameters<SearchIndex['addDocument']>[0]): void {
    this.index.addDocument(document);
    this.stats.indexed++;
    this.emit({
      type: 'indexed',
      url: document.url,
      title: document.title,
      links: document.outlinks?.length ?? 0,
    });
    this.sinceCommit++;
    if (this.sinceCommit >= this.options.commitEvery) {
      this.index.commit();
      this.sinceCommit = 0;
    }
  }

  private isAllowedSite(url: string): boolean {
    if (this.seedSites.size === 0) return true;
    const site = siteOf(url);
    return site !== null && this.seedSites.has(site);
  }

  private fetchOptions(headers: Record<string, string> = {}): FetchOptions {
    return {
      userAgent: this.options.userAgent,
      timeoutMs: this.options.timeoutMs,
      maxBytes: this.options.maxBytes,
      headers,
      signal: this.signal,
    };
  }

  private async allowedByRobots(url: string): Promise<boolean> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    const robots = await this.robotsFor(parsed.origin);
    return robots.isAllowed(`${parsed.pathname}${parsed.search}`, this.options.userAgent);
  }

  private async robotsFor(origin: string): Promise<RobotsTxt> {
    const cached = this.robotsCache.get(origin);
    if (cached && Date.now() - cached.fetchedAt < ROBOTS_TTL_MS) return cached.robots;
    let robots = RobotsTxt.allowAll();
    try {
      const result = await fetchResource(`${origin}/robots.txt`, this.fetchOptions());
      if (result.status >= 200 && result.status < 300) {
        robots = RobotsTxt.parse(result.body.toString('utf8'));
      } else if (result.status >= 500) {
        robots = RobotsTxt.parse('User-agent: *\nDisallow: /');
      }
    } catch {
      robots = RobotsTxt.allowAll();
    }
    this.robotsCache.set(origin, { robots, fetchedAt: Date.now() });
    return robots;
  }

  private async expandSitemaps(): Promise<void> {
    const origins = this.seedOrigins;
    let sitemapCount = 0;

    const queue: Array<{ url: string; depth: number }> = [];
    for (const origin of origins) {
      const robots = await this.robotsFor(origin);
      for (const sitemap of robots.sitemaps) queue.push({ url: sitemap, depth: 0 });
      queue.push({ url: `${origin}/sitemap.xml`, depth: 0 });
    }

    while (queue.length > 0 && sitemapCount < MAX_SITEMAPS) {
      const item = queue.shift()!;
      sitemapCount++;
      try {
        const document = await loadSitemap(item.url, this.fetchOptions());
        for (const entry of document.urls) {
          const url = canonicalizeUrl(entry.loc);
          if (!url || !this.isAllowedSite(url)) continue;
          if (
            this.frontier.add({
              url,
              priority: 1,
              depth: 0,
              discoveredAt: Date.now(),
              lastmod: entry.lastmod,
            })
          ) {
            this.stats.sitemapUrls++;
          }
        }
        if (item.depth < 2) {
          for (const nested of document.sitemaps) queue.push({ url: nested, depth: item.depth + 1 });
        }
      } catch {
        // A missing sitemap is normal; the link crawl still covers the site.
      }
    }
  }

  private isNearDuplicate(fingerprint: Fingerprint): boolean {
    for (const other of this.recentFingerprints) {
      if (hammingDistance(fingerprint, other) <= 3) return true;
    }
    return false;
  }

  private rememberFingerprint(fingerprint: Fingerprint): void {
    this.recentFingerprints.push(fingerprint);
    if (this.recentFingerprints.length > MAX_RECENT_FINGERPRINTS) this.recentFingerprints.shift();
  }

  private emit(event: CrawlEvent): void {
    this.onEvent?.(event);
  }
}

function emptyStats(): CrawlStats {
  return {
    fetched: 0,
    indexed: 0,
    skipped: 0,
    errors: 0,
    bytes: 0,
    sitemapUrls: 0,
    durationMs: 0,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { FetchError };
