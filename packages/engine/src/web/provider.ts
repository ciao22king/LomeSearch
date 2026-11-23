/**
 * Optional external search providers.
 *
 * The local index stays the default and the only source that never leaves the
 * machine. These providers exist for the case where the local index has nothing
 * useful: the browser asks for them explicitly (`/search?q=…&web=1`), the page
 * says which service received the query, and nothing is cached or logged.
 *
 * Only providers with a documented JSON API are implemented. Bing is *not* one
 * of them (its Search API was retired in 2025), so Bing appears as a link
 * target: the query leaves the browser only when the reader clicks.
 */

export interface WebResult {
  title: string;
  url: string;
  snippet: string;
  site: string;
}

/** Services a query can be handed to by clicking a link. */
export const EXTERNAL_ENGINES = {
  bing: { name: 'Bing', endpoint: 'https://www.bing.com/search', param: 'q' },
  duckduckgo: { name: 'DuckDuckGo', endpoint: 'https://duckduckgo.com/', param: 'q' },
  brave: { name: 'Brave Search', endpoint: 'https://search.brave.com/search', param: 'q' },
  startpage: { name: 'Startpage', endpoint: 'https://www.startpage.com/sp/search', param: 'query' },
  mojeek: { name: 'Mojeek', endpoint: 'https://www.mojeek.com/search', param: 'q' },
  google: { name: 'Google', endpoint: 'https://www.google.com/search', param: 'q' },
} as const;

export type ExternalEngineId = keyof typeof EXTERNAL_ENGINES;

export function isExternalEngineId(value: string | null | undefined): value is ExternalEngineId {
  return typeof value === 'string' && Object.hasOwn(EXTERNAL_ENGINES, value);
}

/** A link that sends the query to `id` once it is opened. */
export function externalSearchUrl(id: ExternalEngineId, query: string): string {
  const engine = EXTERNAL_ENGINES[id];
  const url = new URL(engine.endpoint);
  url.searchParams.set(engine.param, query);
  return url.toString();
}

export type WebProviderId = 'brave' | 'searxng';

export interface WebProviderConfig {
  id: WebProviderId;
  /** Subscription token for Brave. */
  apiKey?: string;
  /** Base URL of a SearXNG instance, e.g. `http://127.0.0.1:8080`. */
  baseUrl?: string;
  /** Override for tests and self-hosted proxies. */
  fetchImpl?: typeof fetch;
}

export interface WebProvider {
  id: WebProviderId;
  /** Shown on the page: which service received the query. */
  name: string;
  host: string;
  search(query: string, limit: number): Promise<WebResult[]>;
}

const REQUEST_TIMEOUT_MS = 5000;

export class WebSearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebSearchError';
  }
}

export function isWebProviderId(value: string | null | undefined): value is WebProviderId {
  return value === 'brave' || value === 'searxng';
}

export function createWebProvider(config: WebProviderConfig): WebProvider {
  return config.id === 'brave' ? new BraveProvider(config) : new SearxngProvider(config);
}

async function requestJson(
  fetchImpl: typeof fetch,
  url: string,
  headers: Record<string, string>,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: {
        accept: 'application/json',
        'accept-language': 'en',
        // Explicit opt-outs, for services that honour them.
        dnt: '1',
        'sec-gpc': '1',
        ...headers,
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new WebSearchError(error instanceof Error ? error.message : 'network error');
  }
  if (!response.ok) throw new WebSearchError(`HTTP ${response.status}`);
  try {
    return await response.json();
  } catch {
    throw new WebSearchError('invalid JSON');
  }
}

function text(value: unknown, limit = 400): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '';
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function toResults(rows: unknown, limit: number): WebResult[] {
  if (!Array.isArray(rows)) return [];
  const results: WebResult[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const record = row as Record<string, unknown>;
    const url = text(record.url, 2048);
    const title = text(record.title, 300);
    if (!/^https?:\/\//i.test(url) || !title) continue;
    results.push({
      title,
      url,
      snippet: text(record.description ?? record.content ?? record.snippet),
      site: hostOf(url),
    });
    if (results.length >= limit) break;
  }
  return results;
}

class BraveProvider implements WebProvider {
  readonly id = 'brave' as const;
  readonly name = 'Brave Search';
  readonly host = 'api.search.brave.com';

  constructor(private readonly config: WebProviderConfig) {}

  async search(query: string, limit: number): Promise<WebResult[]> {
    if (!this.config.apiKey) throw new WebSearchError('missing API key');
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(Math.min(Math.max(limit, 1), 20)));
    url.searchParams.set('safesearch', 'moderate');
    const payload = await requestJson(this.config.fetchImpl ?? fetch, url.toString(), {
      'x-subscription-token': this.config.apiKey,
    });
    const web = (payload as { web?: { results?: unknown } } | null)?.web;
    return toResults(web?.results, limit);
  }
}

class SearxngProvider implements WebProvider {
  readonly id = 'searxng' as const;
  readonly name = 'SearXNG';
  readonly host: string;

  constructor(private readonly config: WebProviderConfig) {
    if (!config.baseUrl) throw new WebSearchError('missing SearXNG base URL');
    const parsed = new URL(config.baseUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new WebSearchError('SearXNG base URL must be http or https');
    }
    this.host = parsed.host;
  }

  async search(query: string, limit: number): Promise<WebResult[]> {
    const url = new URL('/search', this.config.baseUrl);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    const payload = await requestJson(this.config.fetchImpl ?? fetch, url.toString(), {});
    const rows = (payload as { results?: unknown } | null)?.results;
    return toResults(rows, limit);
  }
}
