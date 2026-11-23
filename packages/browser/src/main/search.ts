import type { EngineStatus, SearchEngineId, Settings, Suggestion } from '../shared/types.js';
import { SEARCH_ENGINES } from '../shared/constants.js';

/**
 * Input handling and search URL construction.
 *
 * The local engine is the default: queries never leave the machine. Remote
 * engines stay available as an explicit choice, and the custom template keeps
 * `%s` for the query.
 */

const HOST_WITH_TLD = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::\d{2,5})?(?:[/?#].*)?$/i;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}(?::\d{2,5})?(?:[/?#].*)?$/;

export function looksLikeUrl(input: string): boolean {
  const value = input.trim();
  if (!value || /\s/.test(value)) return false;
  if (/^lome:/i.test(value)) return true;
  if (/^lomesearch:\/\//i.test(value)) return true;
  if (/^https?:\/\//i.test(value)) return true;
  if (/^(localhost|127\.0\.0\.1)(?::\d+)?(?:[/?#].*)?$/i.test(value)) return true;
  if (IPV4.test(value)) return true;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return false;
  if (value.startsWith('lomesearch://')) return true;
  return HOST_WITH_TLD.test(value);
}

export function normalizeUserUrl(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  if (/^lome:/i.test(value)) {
    const page = (value.slice(5).replace(/^\/+/, '').split(/[?#]/)[0] ?? '').replace(/\/+$/, '');
    return page ? `lomesearch://${page}` : 'lomesearch://newtab';
  }
  if (value.startsWith('lomesearch://')) return value;
  if (/^https?:\/\//i.test(value)) {
    try {
      return new URL(value).toString();
    } catch {
      return null;
    }
  }
  if (/^(localhost|127\.0\.0\.1)(?::\d+)?(?:[/?#].*)?$/i.test(value)) {
    try {
      return new URL(`http://${value}`).toString();
    } catch {
      return null;
    }
  }
  if (IPV4.test(value)) {
    try {
      return new URL(`http://${value}`).toString();
    } catch {
      return null;
    }
  }
  if (HOST_WITH_TLD.test(value)) {
    try {
      return new URL(`https://${value}`).toString();
    } catch {
      return null;
    }
  }
  return null;
}

export function engineTemplate(settings: Settings, status: EngineStatus): string {
  if (settings.searchEngine === 'local') {
    return `${status.origin}/search?q=%s`;
  }
  if (settings.searchEngine === 'custom') {
    return settings.customSearchUrl.includes('%s')
      ? settings.customSearchUrl
      : `${settings.customSearchUrl}${settings.customSearchUrl.includes('?') ? '&' : '?'}q=%s`;
  }
  return SEARCH_ENGINES[settings.searchEngine as Exclude<SearchEngineId, 'local' | 'custom'>]?.url ??
    SEARCH_ENGINES.duckduckgo.url;
}

export function buildSearchUrl(settings: Settings, status: EngineStatus, query: string): string {
  return engineTemplate(settings, status).replace('%s', encodeURIComponent(query));
}

export interface InputResolution {
  kind: 'url' | 'search' | 'internal';
  url: string;
}

export function resolveInput(input: string, settings: Settings, status: EngineStatus): InputResolution {
  const value = input.trim();
  if (!value) return { kind: 'internal', url: 'lomesearch://newtab' };
  if (value.startsWith('lomesearch://')) return { kind: 'internal', url: value };
  if (/^lome:/i.test(value)) {
    const url = normalizeUserUrl(value);
    if (url) return { kind: 'internal', url };
  }
  if (looksLikeUrl(value)) {
    const url = normalizeUserUrl(value);
    if (url) return { kind: 'url', url };
  }
  return { kind: 'search', url: buildSearchUrl(settings, status, value) };
}

export function searchSuggestions(
  query: string,
  settings: Settings,
  status: EngineStatus,
): Suggestion[] {
  const value = query.trim();
  if (!value) return [];
  const suggestions: Suggestion[] = [];
  const remote = settings.searchEngine === 'local'
    ? `Search the local index`
    : `Search with ${engineName(settings)}`;
  const searchEntry: Suggestion = {
    type: 'search',
    title: value,
    subtitle: remote,
    url: buildSearchUrl(settings, status, value),
  };
  const direct = looksLikeUrl(value) ? normalizeUserUrl(value) : null;
  if (direct) {
    suggestions.push({
      type: 'url',
      title: value,
      subtitle: 'Open the address',
      url: direct,
    });
  }
  suggestions.push(searchEntry);
  return suggestions;
}

export function engineName(settings: Settings): string {
  if (settings.searchEngine === 'local') return 'local LomeSearch';
  if (settings.searchEngine === 'custom') return 'custom engine';
  return SEARCH_ENGINES[settings.searchEngine as Exclude<SearchEngineId, 'local' | 'custom'>]?.name ?? 'DuckDuckGo';
}

export function isInternalUrl(url: string): boolean {
  return url.startsWith('lomesearch://');
}

export function displayUrl(url: string): string {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'lomesearch:') {
      const page = parsed.pathname === '/' ? '' : parsed.pathname;
      return `lome:${parsed.hostname}${page}`;
    }
    const host = parsed.host.replace(/^www\./, '');
    const path = parsed.pathname === '/' ? '' : parsed.pathname;
    return `${host}${path}${parsed.search}`.slice(0, 120);
  } catch {
    return url.slice(0, 120);
  }
}
