import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Public Suffix List support.
 *
 * Site identity (cookies, `site:` filters, crawler politeness, IndexNow host
 * validation) has to be based on the registrable domain, not on the last label.
 * `co.uk`, `github.io` and `*.ck` are all handled by the standard algorithm.
 */

interface SuffixRules {
  exact: Set<string>;
  wildcard: Set<string>;
  exception: Set<string>;
}

let rules: SuffixRules | null = null;

function dataCandidates(): string[] {
  const candidates = [
    new URL('../../../data/public_suffix_list.dat', import.meta.url),
    new URL('../../data/public_suffix_list.dat', import.meta.url),
  ];
  if (process.env.LOMESEARCH_PSL) candidates.unshift(new URL(`file://${process.env.LOMESEARCH_PSL}`));
  return candidates.map((url) => fileURLToPath(url));
}

function loadRules(): SuffixRules {
  const parsed: SuffixRules = { exact: new Set(), wildcard: new Set(), exception: new Set() };
  let text = '';
  let lastError: unknown = null;
  for (const candidate of dataCandidates()) {
    try {
      text = readFileSync(candidate, 'utf8');
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!text) {
    throw new Error(
      `public suffix list not found (${String(lastError)}); set LOMESEARCH_PSL to override`,
    );
  }
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('//')) continue;
    if (line.startsWith('!')) {
      parsed.exception.add(line.slice(1).toLowerCase());
    } else if (line.startsWith('*.')) {
      parsed.wildcard.add(line.slice(2).toLowerCase());
    } else {
      parsed.exact.add(line.toLowerCase());
    }
  }
  return parsed;
}

function getRules(): SuffixRules {
  rules ??= loadRules();
  return rules;
}

function normalizeHost(host: string): string | null {
  let value = host.trim().toLowerCase();
  if (value.startsWith('[') || value.includes(':')) return null; // IPv6 literal
  if (value.endsWith('.')) value = value.slice(0, -1);
  if (!value || /^\d+\.\d+\.\d+\.\d+$/.test(value)) return null;
  if (value === 'localhost') return null;
  return value;
}

/** Returns the public suffix of a host, or null for IPs and single-label hosts. */
export function getPublicSuffix(host: string): string | null {
  const normalized = normalizeHost(host);
  if (!normalized) return null;
  const labels = normalized.split('.');
  if (labels.length < 2) return null;
  const { exact, wildcard, exception } = getRules();

  for (let i = 0; i < labels.length; i++) {
    const suffix = labels.slice(i).join('.');
    if (exception.has(suffix)) {
      return labels.slice(i + 1).join('.') || null;
    }
    if (exact.has(suffix)) return suffix;
    const parent = labels.slice(i + 1).join('.');
    if (i > 0 && wildcard.has(parent)) return suffix;
  }
  return labels[labels.length - 1] ?? null;
}

/**
 * Returns `example.co.uk` for `www.example.co.uk`, and null when the host is an
 * IP address or has no registrable part.
 */
export function getRegistrableDomain(host: string): string | null {
  const normalized = normalizeHost(host);
  if (!normalized) return null;
  const suffix = getPublicSuffix(normalized);
  if (!suffix || normalized === suffix) return null;
  const suffixLabels = suffix.split('.').length;
  const labels = normalized.split('.');
  if (labels.length <= suffixLabels) return normalized;
  return labels.slice(labels.length - suffixLabels - 1).join('.');
}

/** True when the two hosts belong to the same registrable domain. */
export function sameSite(a: string, b: string): boolean {
  const left = getRegistrableDomain(a) ?? normalizeHost(a);
  const right = getRegistrableDomain(b) ?? normalizeHost(b);
  return left !== null && left === right;
}

export function isPublicSuffix(host: string): boolean {
  const normalized = normalizeHost(host);
  if (!normalized) return false;
  return getPublicSuffix(normalized) === normalized;
}

/** Test helper: forget the parsed list so a custom file can be loaded. */
export function resetPublicSuffixCache(): void {
  rules = null;
}
