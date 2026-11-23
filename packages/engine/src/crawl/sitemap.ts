import { gunzipSync } from 'node:zlib';
import { decodeEntities } from '../core/html.js';
import { fetchResource, type FetchOptions } from './fetcher.js';

/**
 * Sitemap parsing.
 *
 * Both `<urlset>` and `<sitemapindex>` are handled, as are `.xml.gz` files,
 * which arrive without a Content-Encoding and therefore have to be decompressed
 * by hand. Sitemaps are the cheapest way for a site to tell a crawler about
 * pages that are not linked from anywhere.
 */

export interface SitemapUrl {
  loc: string;
  lastmod?: string;
}

export interface SitemapDocument {
  urls: SitemapUrl[];
  sitemaps: string[];
  kind: 'urlset' | 'sitemapindex' | 'unknown';
}

const URL_BLOCK = /<url\b[^>]*>([\s\S]*?)<\/url>/gi;
const SITEMAP_BLOCK = /<sitemap\b[^>]*>([\s\S]*?)<\/sitemap>/gi;
const LOC = /<loc\b[^>]*>([\s\S]*?)<\/loc>/i;
const LASTMOD = /<lastmod\b[^>]*>([\s\S]*?)<\/lastmod>/i;

function cleanXmlText(value: string): string {
  return decodeEntities(
    value
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .trim(),
  );
}

export function parseSitemapXml(xml: string): SitemapDocument {
  const isIndex = /<sitemapindex\b/i.test(xml);
  const document: SitemapDocument = {
    urls: [],
    sitemaps: [],
    kind: isIndex ? 'sitemapindex' : /<urlset\b/i.test(xml) ? 'urlset' : 'unknown',
  };

  if (isIndex) {
    for (const match of xml.matchAll(SITEMAP_BLOCK)) {
      const block = match[1] ?? '';
      const loc = LOC.exec(block)?.[1];
      if (loc) document.sitemaps.push(cleanXmlText(loc));
    }
    return document;
  }

  for (const match of xml.matchAll(URL_BLOCK)) {
    const block = match[1] ?? '';
    const loc = LOC.exec(block)?.[1];
    if (!loc) continue;
    const url: SitemapUrl = { loc: cleanXmlText(loc) };
    const lastmod = LASTMOD.exec(block)?.[1];
    if (lastmod) url.lastmod = cleanXmlText(lastmod);
    document.urls.push(url);
  }
  return document;
}

export async function loadSitemap(url: string, options: FetchOptions): Promise<SitemapDocument> {
  const result = await fetchResource(url, { ...options, maxBytes: options.maxBytes ?? 32 * 1024 * 1024 });
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`sitemap ${url} returned HTTP ${result.status}`);
  }
  let payload = result.body;
  if (payload.length >= 2 && payload[0] === 0x1f && payload[1] === 0x8b) {
    payload = gunzipSync(payload);
  }
  return parseSitemapXml(payload.toString('utf8'));
}
