/**
 * HTTP fetching for the crawler.
 *
 * Built on the runtime's fetch so that redirects, content decoding and TLS are
 * handled by the platform. The crawler adds the parts a crawler needs: a byte
 * cap enforced while streaming, a total timeout, conditional requests, and a
 * stable user agent.
 */

export interface FetchOptions {
  userAgent: string;
  timeoutMs?: number;
  maxBytes?: number;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface FetchResult {
  status: number;
  finalUrl: string;
  headers: Headers;
  body: Buffer;
  contentType: string;
  elapsedMs: number;
  truncated: boolean;
}

export class FetchError extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'FetchError';
  }
}

const DEFAULT_TIMEOUT = 15_000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

export async function fetchResource(url: string, options: FetchOptions): Promise<FetchResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
  const started = Date.now();

  let response: Response;
  try {
    response = await fetch(url, {
      redirect: 'follow',
      signal,
      headers: {
        'user-agent': options.userAgent,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5',
        'accept-language': 'en;q=0.9,it;q=0.8,*;q=0.5',
        ...options.headers,
      },
    });
  } catch (error) {
    const code =
      error instanceof Error && error.name === 'TimeoutError'
        ? 'timeout'
        : signal.aborted
          ? 'aborted'
          : 'network';
    throw new FetchError(
      error instanceof Error ? error.message : String(error),
      url,
      code,
    );
  }

  const { body, truncated } = await readCapped(response, maxBytes, signal);
  return {
    status: response.status,
    finalUrl: response.url || url,
    headers: response.headers,
    body,
    contentType: (response.headers.get('content-type') ?? '').toLowerCase(),
    elapsedMs: Date.now() - started,
    truncated,
  };
}

async function readCapped(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<{ body: Buffer; truncated: boolean }> {
  if (!response.body) return { body: Buffer.alloc(0), truncated: false };
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const remaining = maxBytes - total;
      if (value.byteLength > remaining) {
        chunks.push(Buffer.from(value.subarray(0, remaining)));
        total = maxBytes;
        truncated = true;
        break;
      }
      chunks.push(Buffer.from(value));
      total += value.byteLength;
      if (signal.aborted) {
        truncated = true;
        break;
      }
    }
  } finally {
    if (truncated) {
      try {
        await reader.cancel();
      } catch {
        // The stream may already be closed.
      }
    }
    reader.releaseLock();
  }
  return { body: Buffer.concat(chunks), truncated };
}

export async function fetchText(url: string, options: FetchOptions): Promise<string> {
  const result = await fetchResource(url, {
    ...options,
    maxBytes: options.maxBytes ?? 2 * 1024 * 1024,
  });
  if (result.status < 200 || result.status >= 300) {
    throw new FetchError(`HTTP ${result.status}`, url, 'status');
  }
  return result.body.toString('utf8');
}
