import { randomBytes } from 'node:crypto';

/**
 * IndexNow.
 *
 * LomeSearch is both sides of the protocol. Sites push changed URLs to our
 * endpoint (server side), and site owners can use the client to submit to any
 * IndexNow participant, including this engine. Keys are verified by fetching the
 * key file from the submitting host before a URL is allowed to skip the queue.
 */

export const INDEXNOW_MAX_URLS = 10_000;
export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
export const INDEXNOW_KEY_PATTERN = /^[a-zA-Z0-9-]{8,128}$/;
const KEY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface IndexNowPayload {
  host: string;
  key: string;
  keyLocation?: string;
  urlList: string[];
}

export type ValidationResult =
  | { ok: true; payload: IndexNowPayload }
  | { ok: false; status: number; error: string };

export function generateKey(): string {
  return randomBytes(16).toString('hex');
}

export function buildKeyLocation(host: string, key: string): string {
  return `https://${host}/${key}.txt`;
}

export function validatePayload(raw: unknown): ValidationResult {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, status: 400, error: 'body must be a JSON object' };
  }
  const body = raw as Record<string, unknown>;
  const host = typeof body.host === 'string' ? body.host.trim().toLowerCase() : '';
  const key = typeof body.key === 'string' ? body.key.trim() : '';
  const urlList = Array.isArray(body.urlList) ? body.urlList : null;

  if (!host || !isHostname(host)) {
    return { ok: false, status: 422, error: 'host is missing or invalid' };
  }
  if (!INDEXNOW_KEY_PATTERN.test(key)) {
    return { ok: false, status: 403, error: 'key is invalid' };
  }
  if (!urlList) {
    return { ok: false, status: 400, error: 'urlList is missing' };
  }
  if (urlList.length === 0 || urlList.length > INDEXNOW_MAX_URLS) {
    return { ok: false, status: 400, error: `urlList must contain 1-${INDEXNOW_MAX_URLS} URLs` };
  }

  const urls: string[] = [];
  for (const entry of urlList) {
    if (typeof entry !== 'string') {
      return { ok: false, status: 400, error: 'urlList entries must be strings' };
    }
    let parsed: URL;
    try {
      parsed = new URL(entry.trim());
    } catch {
      return { ok: false, status: 422, error: `invalid URL: ${entry}` };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, status: 422, error: `unsupported scheme: ${entry}` };
    }
    if (!belongsToHost(parsed.hostname, host)) {
      return { ok: false, status: 422, error: `URL is not on ${host}: ${entry}` };
    }
    urls.push(parsed.toString());
  }

  let keyLocation: string | undefined;
  if (typeof body.keyLocation === 'string' && body.keyLocation.trim()) {
    let parsed: URL;
    try {
      parsed = new URL(body.keyLocation.trim());
    } catch {
      return { ok: false, status: 422, error: 'keyLocation is not a valid URL' };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, status: 422, error: 'keyLocation must be http or https' };
    }
    if (!belongsToHost(parsed.hostname, host)) {
      return { ok: false, status: 422, error: 'keyLocation must be on the submitting host' };
    }
    keyLocation = parsed.toString();
  }

  return { ok: true, payload: { host, key, keyLocation, urlList: urls } };
}

// Only public domain names are accepted: IP literals and localhost would turn
// key verification into a request forgery primitive.
function isHostname(host: string): boolean {
  if (host.length > 253 || !host.includes('.')) return false;
  return /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host);
}

function belongsToHost(candidate: string, host: string): boolean {
  const value = candidate.toLowerCase().replace(/\.$/, '');
  return value === host || value.endsWith(`.${host}`);
}

export type KeyVerification = 'valid' | 'invalid' | 'unreachable';

export interface VerifyOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export async function verifyKeyFile(
  payload: IndexNowPayload,
  options: VerifyOptions = {},
): Promise<KeyVerification> {
  const doFetch = options.fetchImpl ?? fetch;
  const signal = AbortSignal.timeout(options.timeoutMs ?? 5_000);
  let location = payload.keyLocation ?? buildKeyLocation(payload.host, payload.key);
  try {
    // Redirects are followed manually so a key file cannot point the crawler at
    // an unrelated host.
    for (let hop = 0; hop < 4; hop++) {
      const response = await doFetch(location, {
        signal,
        redirect: 'manual',
        headers: { 'user-agent': 'LomeSearchBot/1.0 (IndexNow verification)' },
      });
      if (response.status >= 300 && response.status < 400) {
        const next = response.headers.get('location');
        if (!next) return 'invalid';
        const resolved = new URL(next, location);
        if (!belongsToHost(resolved.hostname, payload.host)) return 'invalid';
        location = resolved.toString();
        continue;
      }
      if (response.status === 404 || response.status === 410) return 'invalid';
      if (!response.ok) return 'unreachable';
      const text = (await response.text()).trim();
      return text === payload.key ? 'valid' : 'invalid';
    }
    return 'invalid';
  } catch {
    return 'unreachable';
  }
}

/** Caches verification results so a burst of submissions verifies once. */
export class IndexNowVerifier {
  private readonly cache = new Map<string, { result: KeyVerification; at: number }>();

  constructor(private readonly options: VerifyOptions = {}) {}

  async verify(payload: IndexNowPayload): Promise<KeyVerification> {
    const key = `${payload.host}|${payload.key}|${payload.keyLocation ?? ''}`;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < KEY_CACHE_TTL_MS) return cached.result;
    const result = await verifyKeyFile(payload, this.options);
    if (result !== 'unreachable') this.cache.set(key, { result, at: Date.now() });
    return result;
  }
}

export interface IndexNowSubmitResult {
  ok: boolean;
  status: number;
  message: string;
  submitted: number;
}

export class IndexNowClient {
  constructor(
    private readonly config: {
      host: string;
      key: string;
      endpoint?: string;
      keyLocation?: string;
      fetchImpl?: typeof fetch;
    },
  ) {}

  async submit(urls: string[]): Promise<IndexNowSubmitResult> {
    if (urls.length === 0) {
      return { ok: false, status: 400, message: 'no URLs to submit', submitted: 0 };
    }
    const endpoint = this.config.endpoint ?? INDEXNOW_ENDPOINT;
    const doFetch = this.config.fetchImpl ?? fetch;
    let submitted = 0;
    let status = 200;
    let message = 'ok';

    for (let start = 0; start < urls.length; start += INDEXNOW_MAX_URLS) {
      const chunk = urls.slice(start, start + INDEXNOW_MAX_URLS);
      const payload: IndexNowPayload = {
        host: this.config.host,
        key: this.config.key,
        urlList: chunk,
      };
      if (this.config.keyLocation) payload.keyLocation = this.config.keyLocation;
      try {
        const response = await doFetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json; charset=utf-8' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(30_000),
        });
        status = response.status;
        if (!response.ok) {
          message = `endpoint returned HTTP ${response.status}`;
          return { ok: false, status, message, submitted };
        }
        submitted += chunk.length;
      } catch (error) {
        return {
          ok: false,
          status: 0,
          message: error instanceof Error ? error.message : String(error),
          submitted,
        };
      }
    }
    return { ok: true, status, message, submitted };
  }
}
