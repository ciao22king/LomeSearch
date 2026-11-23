import type { QueryFilters } from './parser.js';

export interface FilterableDocument {
  url: string;
  site: string;
  host: string;
  lang: string;
}

export function matchesFilters(doc: FilterableDocument, filters: QueryFilters): boolean {
  if (filters.sites.length > 0) {
    const site = doc.site;
    const host = doc.host;
    const ok = filters.sites.some(
      (value) => site === value || host === value || host.endsWith(`.${value}`),
    );
    if (!ok) return false;
  }
  if (filters.hosts.length > 0 && !filters.hosts.includes(doc.host)) return false;
  if (filters.filetypes.length > 0) {
    const path = doc.url.split(/[?#]/)[0] ?? '';
    const extension = path.includes('.') ? path.slice(path.lastIndexOf('.') + 1).toLowerCase() : '';
    if (!filters.filetypes.includes(extension)) return false;
  }
  if (filters.langs.length > 0) {
    const lang = doc.lang.toLowerCase();
    if (!filters.langs.some((value) => lang.startsWith(value))) return false;
  }
  return true;
}
