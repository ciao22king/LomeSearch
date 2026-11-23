import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { performance } from 'node:perf_hooks';
import type { SearchIndex } from '../index/index.js';
import {
  IndexNowVerifier,
  validatePayload,
  type KeyVerification,
} from '../indexnow.js';
import { renderErrorPage, renderOpenSearch, renderSearchPage } from './render.js';

/**
 * HTTP front end.
 *
 * Binds to loopback by default. There are no cookies, no sessions and no query
 * logging: the access log records the route and the status, never the query
 * string, and rate limiting keys are HMACs of the client address with a salt
 * that is rotated every day and never written to disk.
 */

export interface SearchServerOptions {
  index: SearchIndex;
  port?: number;
  bindAddress?: string;
  /** Public host name, used in OpenSearch links and IndexNow key files. */
  engineHost?: string;
  /** IndexNow key served by this instance. */
  engineKey?: string;
  submitUrls: (urls: string[], priority?: number) => number;
  verifier?: IndexNowVerifier;
  log?: (line: string) => void;
  rateLimits?: { searchPerMinute?: number; indexNowPerMinute?: number };
  /** Set when the server sits behind a reverse proxy you control. */
  trustProxy?: boolean;
  /** Extra Host header names to accept, beyond loopback and the bind address. */
  allowedHosts?: string[];
}

export interface SearchServerHandle {
  origin: string;
  port: number;
  server: Server;
  close(): Promise<void>;
}

const VERSION = '1.0.0';
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_PAGE = 100;
const RESULT_PAGE_SIZE = 10;

const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
<rect width="32" height="32" rx="8" fill="#1b4d3e"/>
<circle cx="14" cy="14" r="6.5" fill="none" stroke="#e7f0ec" stroke-width="2.4"/>
<path d="M19 19l6 6" stroke="#e7f0ec" stroke-width="2.6" stroke-linecap="round"/>
</svg>`;

class RateLimiter {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs = 60_000,
  ) {}

  take(key: string): boolean {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      if (this.buckets.size > 50_000) this.prune(now);
      return true;
    }
    if (bucket.count >= this.limit) return false;
    bucket.count++;
    return true;
  }

  private prune(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}

export async function startSearchServer(options: SearchServerOptions): Promise<SearchServerHandle> {
  const index = options.index;
  const verifier = options.verifier ?? new IndexNowVerifier();
  const log = options.log ?? (() => {});
  const bindAddress = options.bindAddress ?? '127.0.0.1';
  const engineHost = options.engineHost ?? `127.0.0.1:${options.port ?? 7717}`;
  const searchLimiter = new RateLimiter(options.rateLimits?.searchPerMinute ?? 120);
  const indexNowLimiter = new RateLimiter(options.rateLimits?.indexNowPerMinute ?? 30);
  const clientKeys = new ClientKeyFactory();
  const startedAt = Date.now();

  const server = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      log(`error ${error instanceof Error ? error.message : String(error)}`);
      if (!response.headersSent) {
        sendHtml(response, 500, renderErrorPage(500, 'Errore interno del motore di ricerca.'));
      } else {
        response.end();
      }
    });
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const started = performance.now();
    setSecurityHeaders(response);
    const allowedHosts = [...(options.allowedHosts ?? []), engineHost];
    if (!isAllowedHost(request.headers.host, bindAddress, allowedHosts)) {
      sendJson(response, 421, { error: 'host non consentito' });
      return;
    }
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    const route = routeName(url.pathname);
    response.on('finish', () => {
      const elapsed = (performance.now() - started).toFixed(1);
      log(`${request.method ?? 'GET'} ${route} ${response.statusCode} ${elapsed}ms`);
    });

    if (request.method === 'OPTIONS') {
      response.writeHead(204, { allow: 'GET, POST, OPTIONS' });
      response.end();
      return;
    }

    if (url.pathname === '/health' && (request.method === 'GET' || request.method === 'HEAD')) {
      sendJson(response, 200, { status: 'ok', version: VERSION, uptimeSeconds: Math.round((Date.now() - startedAt) / 1000) });
      return;
    }

    if (url.pathname === '/stats' && request.method === 'GET') {
      sendJson(response, 200, {
        version: VERSION,
        uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
        index: index.stats(),
      });
      return;
    }

    if (url.pathname === '/opensearch.xml' && request.method === 'GET') {
      const origin = `${url.protocol}//${request.headers.host ?? engineHost}`;
      sendXml(response, 200, renderOpenSearch(origin, engineHost));
      return;
    }

    if (url.pathname === '/favicon.svg' || url.pathname === '/favicon.ico') {
      response.writeHead(200, {
        'content-type': url.pathname.endsWith('.svg') ? 'image/svg+xml' : 'image/svg+xml',
        'cache-control': 'public, max-age=86400',
      });
      response.end(FAVICON);
      return;
    }

    if (url.pathname === '/robots.txt') {
      sendText(response, 200, 'User-agent: *\nDisallow: /\n');
      return;
    }

    if (url.pathname.startsWith('/indexnow/') && url.pathname.endsWith('.txt') && request.method === 'GET') {
      const key = url.pathname.slice('/indexnow/'.length, -'.txt'.length);
      serveKeyFile(response, key, options.engineKey);
      return;
    }
    if (/^\/[A-Za-z0-9-]{8,128}\.txt$/.test(url.pathname) && request.method === 'GET') {
      const key = url.pathname.slice(1, -'.txt'.length);
      serveKeyFile(response, key, options.engineKey);
      return;
    }

    if (url.pathname === '/indexnow') {
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'method not allowed' });
        return;
      }
      const clientKey = clientKeys.keyFor(clientAddress(request, options.trustProxy));
      if (!indexNowLimiter.take(clientKey)) {
        sendJson(response, 429, { error: 'too many submissions, retry later' });
        return;
      }
      await handleIndexNow(request, response);
      return;
    }

    if (url.pathname === '/suggest' && request.method === 'GET') {
      const clientKey = clientKeys.keyFor(clientAddress(request, options.trustProxy));
      if (!searchLimiter.take(clientKey)) {
        sendJson(response, 429, { error: 'rate limited' });
        return;
      }
      const query = url.searchParams.get('q') ?? '';
      const suggestions = index.suggest(query, 8);
      sendJson(response, 200, [query, suggestions]);
      return;
    }

    if (url.pathname === '/' || url.pathname === '/search') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        sendJson(response, 405, { error: 'method not allowed' });
        return;
      }
      const clientKey = clientKeys.keyFor(clientAddress(request, options.trustProxy));
      if (!searchLimiter.take(clientKey)) {
        sendHtml(response, 429, renderErrorPage(429, 'Troppe richieste. Riprova tra un minuto.'));
        return;
      }
      const query = (url.searchParams.get('q') ?? '').slice(0, 512);
      const page = clampPage(url.searchParams.get('page'));
      const wantsJson =
        url.searchParams.get('format') === 'json' ||
        (request.headers.accept ?? '').includes('application/json');
      const stats = index.stats();
      const renderContext = {
        origin: `${url.protocol}//${request.headers.host ?? engineHost}`,
        engineHost,
        indexStats: {
          documents: stats.documents,
          segments: stats.segments,
          indexedTerms: stats.indexedTerms,
        },
      };

      if (!query.trim()) {
        if (wantsJson) {
          sendJson(response, 200, { query: '', results: [], total: 0, tookMs: 0 });
        } else {
          sendHtml(response, 200, renderSearchPage(renderContext, '', null, 1));
        }
        return;
      }

      const result = index.search(query, {
        limit: RESULT_PAGE_SIZE,
        offset: (page - 1) * RESULT_PAGE_SIZE,
      });
      if (wantsJson) {
        sendJson(response, 200, { ...result, page });
      } else {
        sendHtml(response, 200, renderSearchPage(renderContext, query, result, page));
      }
      return;
    }

    sendHtml(response, 404, renderErrorPage(404, 'Pagina non trovata.'));
  }

  async function handleIndexNow(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let body: Buffer;
    try {
      body = await readBody(request, MAX_BODY_BYTES);
    } catch (error) {
      sendJson(response, error instanceof BodyTooLargeError ? 413 : 400, { error: 'invalid body' });
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.toString('utf8'));
    } catch {
      sendJson(response, 400, { error: 'body must be valid JSON' });
      return;
    }

    const validation = validatePayload(parsed);
    if (!validation.ok) {
      sendJson(response, validation.status, { error: validation.error });
      return;
    }
    const payload = validation.payload;
    const verification: KeyVerification = await verifier.verify(payload);

    if (verification === 'invalid') {
      sendJson(response, 403, { error: 'key verification failed' });
      return;
    }
    if (verification === 'unreachable') {
      sendJson(response, 202, {
        accepted: payload.urlList.length,
        queued: 0,
        message: 'key file not reachable yet; resubmit later',
      });
      return;
    }

    const queued = options.submitUrls(payload.urlList, 0);
    sendJson(response, 200, { accepted: payload.urlList.length, queued });
  }

  const port = options.port ?? 0;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, bindAddress, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  return {
    origin: `http://${bindAddress === '0.0.0.0' ? '127.0.0.1' : bindAddress}:${actualPort}`,
    port: actualPort,
    server,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function serveKeyFile(response: ServerResponse, key: string, engineKey?: string): void {
  if (!engineKey) {
    sendText(response, 404, 'not found');
    return;
  }
  const expected = Buffer.from(engineKey);
  const received = Buffer.from(key);
  const matches =
    expected.length === received.length && timingSafeEqual(expected, received);
  if (!matches) {
    sendText(response, 404, 'not found');
    return;
  }
  response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  response.end(engineKey);
}

function routeName(pathname: string): string {
  if (pathname === '/' || pathname === '/search') return 'search';
  if (pathname === '/suggest') return 'suggest';
  if (pathname === '/stats') return 'stats';
  if (pathname === '/health') return 'health';
  if (pathname === '/indexnow') return 'indexnow';
  if (pathname.startsWith('/indexnow/')) return 'indexnow-key';
  return 'other';
}

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader(
    'content-security-policy',
    "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  );
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('x-frame-options', 'DENY');
  response.setHeader('permissions-policy', 'geolocation=(), camera=(), microphone=(), interest-cohort=()');
  response.setHeader('cross-origin-opener-policy', 'same-origin');
  response.setHeader('cross-origin-resource-policy', 'same-origin');
  response.setHeader('cache-control', 'no-store');
}

/**
 * Rejects DNS-rebinding requests: a page on attacker.example that resolves to
 * 127.0.0.1 still sends its own Host header. Only loopback names, the address
 * the server bound to and explicitly allowed names are accepted.
 */
export function isAllowedHost(
  hostHeader: string | undefined,
  bindAddress: string,
  allowedHosts: string[] = [],
): boolean {
  if (!hostHeader) return false;
  const host = hostnameOf(hostHeader);
  if (host === '127.0.0.1' || host === 'localhost' || host === '::1') return true;
  if (host === hostnameOf(bindAddress)) return true;
  return allowedHosts.some((item) => hostnameOf(item) === host);
}

function hostnameOf(value: string): string {
  return value.replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
}

function sendJson(
  response: ServerResponse,
  status: number,
  data: unknown,
  extraHeaders: Record<string, string> = {},
): void {
  const body = JSON.stringify(data);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    ...extraHeaders,
  });
  response.end(body);
}

function sendHtml(response: ServerResponse, status: number, html: string): void {
  response.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
  response.end(html);
}

function sendXml(response: ServerResponse, status: number, xml: string): void {
  response.writeHead(status, { 'content-type': 'application/opensearchdescription+xml; charset=utf-8' });
  response.end(xml);
}

function sendText(response: ServerResponse, status: number, text: string): void {
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  response.end(text);
}

class BodyTooLargeError extends Error {}

function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    request.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > limit) {
        reject(new BodyTooLargeError('body too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function clampPage(value: string | null): number {
  const page = Number.parseInt(value ?? '1', 10);
  if (!Number.isFinite(page) || page < 1) return 1;
  return Math.min(page, MAX_PAGE);
}

function clientAddress(request: IncomingMessage, trustProxy: boolean | undefined): string {
  if (trustProxy) {
    const forwarded = request.headers['x-forwarded-for'];
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];
    if (first?.trim()) return first.trim();
  }
  return request.socket.remoteAddress ?? 'unknown';
}

/** Rotating, per-process salt: rate-limit keys are not linkable across days. */
class ClientKeyFactory {
  private salt = randomBytes(16);
  private day = new Date().toISOString().slice(0, 10);

  keyFor(address: string): string {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.salt = randomBytes(16);
    }
    return createHmac('sha256', this.salt).update(address).digest('base64url').slice(0, 16);
  }
}
