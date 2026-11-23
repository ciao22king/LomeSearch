import { getPublicSuffix, getRegistrableDomain } from './psl.js';

/**
 * URL canonicalisation. The crawler and the index agree on one textual form per
 * resource so that the same page is not stored twice because of a fragment, a
 * session parameter or a trailing dot in the host name.
 */

/** Query parameters that only carry campaign or click attribution. */
const TRACKING_PARAMS = new Set([
  'gclid',
  'dclid',
  'fbclid',
  'msclkid',
  'yclid',
  'twclid',
  'igshid',
  'mc_cid',
  'mc_eid',
  'mkt_tok',
  '_hsenc',
  '_hsmi',
  'hsctatracking',
  'vero_id',
  'vero_conv',
  'oly_anon_id',
  'oly_enc_id',
  'wickedid',
  'rb_clickid',
  's_cid',
  'ref_src',
  'ref_url',
  'spm',
  'scid',
  'cmpid',
  'campaignid',
]);

const TRACKING_PREFIXES = ['utm_', 'pk_', 'mtm_', 'matomo_', 'hsa_'];

function isTrackingParam(name: string): boolean {
  const lower = name.toLowerCase();
  return TRACKING_PARAMS.has(lower) || TRACKING_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

/** Removes empty path segments, duplicate slashes and dot segments. */
function normalizePath(pathname: string): string {
  const segments = pathname.split('/');
  const output: string[] = [];
  for (const segment of segments) {
    if (segment === '' && output.length > 0) continue;
    if (segment === '.') continue;
    if (segment === '..') {
      output.pop();
      continue;
    }
    output.push(segment);
  }
  let path = output.join('/');
  if (!path.startsWith('/')) path = `/${path}`;
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return path || '/';
}

export interface CanonicalizeOptions {
  /** Keep query parameters, including tracking ones. */
  keepQuery?: boolean;
  /** Keep the fragment identifier. */
  keepFragment?: boolean;
}

export function canonicalizeUrl(input: string, base?: string, options: CanonicalizeOptions = {}): string | null {
  const raw = input.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = base ? new URL(raw, base) : new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname) return null;

  url.username = '';
  url.password = '';
  url.hostname = url.hostname.replace(/\.$/, '').toLowerCase();
  url.pathname = normalizePath(url.pathname);

  if (options.keepQuery) {
    url.search = url.searchParams.toString() ? url.search : '';
  } else {
    const kept: Array<[string, string]> = [];
    for (const [name, value] of url.searchParams) {
      if (!isTrackingParam(name)) kept.push([name, value]);
    }
    kept.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
    const params = new URLSearchParams();
    for (const [name, value] of kept) params.append(name, value);
    url.search = params.toString() ? `?${params.toString()}` : '';
  }

  if (!options.keepFragment) url.hash = '';
  return url.toString();
}

export function parseUrl(input: string, base?: string): URL | null {
  try {
    return base ? new URL(input, base) : new URL(input);
  } catch {
    return null;
  }
}

export function hostOf(input: string): string | null {
  return parseUrl(input)?.hostname ?? null;
}

export function originOf(input: string): string | null {
  const url = parseUrl(input);
  return url ? url.origin : null;
}

export function siteOf(input: string): string | null {
  const host = hostOf(input);
  if (!host) return null;
  return getRegistrableDomain(host) ?? host;
}

export function sameOrigin(a: string, b: string): boolean {
  const left = originOf(a);
  const right = originOf(b);
  return left !== null && left === right;
}

export function isHttpUrl(input: string): boolean {
  const url = parseUrl(input);
  return url !== null && (url.protocol === 'http:' || url.protocol === 'https:');
}

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?$/;
const HOST_WITH_PORT = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d{1,5})?(?:[/?#].*)?$/i;

/**
 * Decides whether omnibox input is a URL or a search query. Deliberately
 * conservative: when in doubt the input is treated as a search, which never
 * navigates somewhere unexpected.
 */
export function looksLikeUrl(input: string): boolean {
  const value = input.trim();
  if (!value || /\s/.test(value)) return false;
  if (/^(?:https?|file|about|view-source|chrome|lomesearch):/i.test(value)) return true;
  if (value.startsWith('//')) return true;
  if (value === 'localhost' || /^localhost:\d{1,5}(?:[/?#].*)?$/i.test(value)) return true;
  if (IPV4.test(value)) return true;
  if (HOST_WITH_PORT.test(value)) {
    const host = value.split(/[/?#]/)[0] ?? '';
    const hostname = host.split(':')[0] ?? '';
    return getPublicSuffix(hostname) !== null;
  }
  return false;
}

/** Turns omnibox input into a navigable URL. */
export function normalizeUserUrl(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  if (value.startsWith('//')) return parseUrl(`https:${value}`)?.toString() ?? null;
  if (value === 'localhost' || /^localhost[:/]/.test(value) || IPV4.test(value)) {
    return parseUrl(`http://${value}`)?.toString() ?? null;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return parseUrl(value)?.toString() ?? null;
  if (HOST_WITH_PORT.test(value)) return parseUrl(`https://${value}`)?.toString() ?? null;
  return null;
}

/** Shortens a URL for display without hiding the site that is being shown. */
export function displayUrl(input: string, maxLength = 96): string {
  const url = parseUrl(input);
  if (!url) return input;
  const host = url.hostname;
  let rest = `${url.pathname}${url.search}`;
  if (rest === '/') rest = '';
  const budget = Math.max(8, maxLength - host.length);
  if (rest.length > budget) rest = `${rest.slice(0, budget - 1)}\u2026`;
  return `${host}${rest}`;
}

export function pathDepth(input: string): number {
  const url = parseUrl(input);
  if (!url) return 0;
  return url.pathname.split('/').filter(Boolean).length;
}
