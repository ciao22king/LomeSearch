import { escapeHtml } from '../query/snippet.js';
import type { SearchResponse, SearchResult } from '../index/index.js';

/**
 * Server-rendered result pages.
 *
 * The page has no external assets and no JavaScript requirement: results, the
 * search box and pagination all work with plain links, which keeps the engine
 * usable on slow connections and keeps the privacy story simple (no third-party
 * requests, no cookies, no client-side tracking).
 */

const STYLES = `
:root {
  color-scheme: light dark;
  --bg: #fbfbf9;
  --surface: #ffffff;
  --text: #17181a;
  --muted: #5f6368;
  --line: #e3e2dd;
  --accent: #1b4d3e;
  --accent-soft: #e7f0ec;
  --mark: #fdf0c8;
  --mark-text: #3a2c00;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #131413;
    --surface: #1b1c1b;
    --text: #ecece8;
    --muted: #a0a49f;
    --line: #2c2e2c;
    --accent: #9ed3bd;
    --accent-soft: #22322c;
    --mark: #4a3d12;
    --mark-text: #f6e9bd;
  }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 16px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
a:focus-visible, button:focus-visible, input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: 4px;
}
.wrap { max-width: 760px; margin: 0 auto; padding: 32px 20px 64px; }
header.bar { display: flex; align-items: center; gap: 16px; padding: 20px 0 8px; }
.brand { font-weight: 650; letter-spacing: -0.02em; font-size: 20px; color: var(--text); }
.brand span { color: var(--accent); }
form.search { display: flex; gap: 8px; margin: 8px 0 4px; }
form.search input[type="search"] {
  flex: 1;
  min-width: 0;
  padding: 12px 14px;
  font-size: 16px;
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
}
form.search button {
  padding: 12px 18px;
  font-size: 15px;
  font-weight: 600;
  color: var(--surface);
  background: var(--accent);
  border: 0;
  border-radius: 10px;
  cursor: pointer;
}
@media (prefers-color-scheme: dark) {
  form.search button { color: #10120f; }
}
main { margin-top: 20px; }
.meta { color: var(--muted); font-size: 13px; margin: 6px 0 18px; }
ol.results { list-style: none; margin: 0; padding: 0; }
ol.results li { padding: 18px 0; border-top: 1px solid var(--line); }
ol.results li:first-child { border-top: 0; }
.result-site { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--muted); }
.result-site .dot { width: 4px; height: 4px; border-radius: 50%; background: var(--muted); display: inline-block; }
h2.result-title { margin: 4px 0 2px; font-size: 18px; line-height: 1.35; font-weight: 600; }
h2.result-title a { color: var(--accent); }
p.result-url { margin: 0 0 6px; font-size: 13px; color: var(--muted); word-break: break-all; }
p.snippet { margin: 0; font-size: 15px; color: var(--text); }
mark { background: var(--mark); color: var(--mark-text); padding: 0 1px; border-radius: 2px; }
.notice { background: var(--accent-soft); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; font-size: 14px; }
.empty { padding: 32px 0; }
.empty h2 { margin: 0 0 6px; font-size: 18px; }
nav.pager { display: flex; gap: 10px; margin-top: 28px; }
nav.pager a { padding: 8px 14px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); font-size: 14px; }
footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid var(--line); color: var(--muted); font-size: 12px; display: flex; flex-wrap: wrap; gap: 6px 16px; }
footer a { color: var(--muted); text-decoration: underline; }
.stats { display: flex; flex-wrap: wrap; gap: 10px 22px; margin: 24px 0 0; }
.stats div { font-size: 13px; color: var(--muted); }
.stats strong { display: block; font-size: 20px; color: var(--text); font-weight: 600; }
@media (max-width: 520px) {
  .wrap { padding: 20px 14px 48px; }
  header.bar { flex-wrap: wrap; }
}
`;

export interface RenderContext {
  origin: string;
  engineHost: string;
  indexStats: { documents: number; segments: number; indexedTerms: number };
}

export function renderSearchPage(
  context: RenderContext,
  query: string,
  response: SearchResponse | null,
  page: number,
): string {
  const body = response
    ? renderResults(context, query, response, page)
    : renderHome(context);
  return pageShell(context, query, body);
}

function renderHome(context: RenderContext): string {
  return `
<main>
  <div class="notice">
    Motore di ricerca locale: le query non vengono registrate, non ci sono cookie
    e nessuna richiesta esce da questa macchina.
  </div>
  <div class="stats">
    <div><strong>${formatNumber(context.indexStats.documents)}</strong>documenti indicizzati</div>
    <div><strong>${formatNumber(context.indexStats.indexedTerms)}</strong>termini nell'indice</div>
    <div><strong>${formatNumber(context.indexStats.segments)}</strong>segmenti</div>
  </div>
</main>`;
}

function renderResults(
  context: RenderContext,
  query: string,
  response: SearchResponse,
  page: number,
): string {
  if (response.results.length === 0) {
    const suggestion = response.suggestion
      ? `<p class="notice">Forse cercavi <a href="/search?q=${encodeURIComponent(response.suggestion)}">${escapeHtml(response.suggestion)}</a>?</p>`
      : '';
    return `<main>
  <p class="meta">Nessun risultato per <strong>${escapeHtml(query)}</strong> in ${response.tookMs.toFixed(1)} ms.</p>
  ${suggestion}
  <div class="empty">
    <h2>Nessun documento corrisponde alla ricerca</h2>
    <p>Prova con meno parole, senza virgolette, oppure aggiungi altre pagine all'indice con <code>lomesearch crawl</code>.</p>
  </div>
</main>`;
  }

  const items = response.results.map((result) => renderResult(result)).join('\n');
  const total =
    response.totalRelation === 'gte' ? `più di ${formatNumber(response.total)}` : formatNumber(response.total);
  const relaxed = response.relaxed
    ? '<p class="meta">Pochi risultati esatti: la ricerca è stata allargata ai termini singoli.</p>'
    : '';
  const suggestion =
    response.suggestion && response.results.length > 0
      ? `<p class="meta">Suggerimento: <a href="/search?q=${encodeURIComponent(response.suggestion)}">${escapeHtml(response.suggestion)}</a></p>`
      : '';

  const perPage = 10;
  const pager: string[] = [];
  if (page > 1) {
    pager.push(
      `<a rel="prev" href="/search?q=${encodeURIComponent(query)}&page=${page - 1}">Pagina precedente</a>`,
    );
  }
  if (response.results.length >= perPage) {
    pager.push(
      `<a rel="next" href="/search?q=${encodeURIComponent(query)}&page=${page + 1}">Pagina successiva</a>`,
    );
  }

  return `<main>
  <p class="meta">${total} risultati in ${response.tookMs.toFixed(1)} ms &middot; nessuna query registrata</p>
  ${relaxed}
  ${suggestion}
  <ol class="results">
    ${items}
  </ol>
  ${pager.length > 0 ? `<nav class="pager">${pager.join('')}</nav>` : ''}
</main>`;
}

function renderResult(result: SearchResult): string {
  const date = result.fetchedAt
    ? new Date(result.fetchedAt).toLocaleDateString('it-IT', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : '';
  const snippet = result.snippet || escapeHtml(result.description.slice(0, 240));
  const description = snippet ? `<p class="snippet">${snippet}</p>` : '';
  return `<li>
    <div class="result-site"><span>${escapeHtml(result.site || result.host)}</span><span class="dot"></span><span>${escapeHtml(result.url)}</span></div>
    <h2 class="result-title"><a href="${escapeHtml(result.url)}" rel="noreferrer noopener">${escapeHtml(result.title)}</a></h2>
    ${description}
    ${date ? `<p class="result-url">${escapeHtml(date)}${result.lang ? ` &middot; ${escapeHtml(result.lang)}` : ''}</p>` : ''}
  </li>`;
}

function pageShell(context: RenderContext, query: string, body: string): string {
  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${query ? `${escapeHtml(query)} - LomeSearch` : 'LomeSearch'}</title>
<link rel="search" type="application/opensearchdescription+xml" href="/opensearch.xml" title="LomeSearch">
<style>${STYLES}</style>
</head>
<body>
<div class="wrap">
  <header class="bar">
    <a class="brand" href="/">Lome<span>Search</span></a>
  </header>
  <form class="search" action="/search" method="get" role="search">
    <label for="q" class="visually-hidden" hidden>Cerca nell'indice</label>
    <input id="q" type="search" name="q" value="${escapeHtml(query)}" placeholder="Cerca nell'indice locale" autocomplete="off" autofocus>
    <button type="submit">Cerca</button>
  </form>
  ${body}
  <footer>
    <span>Indice locale su ${escapeHtml(context.engineHost)}</span>
    <span>Nessun cookie &middot; nessun tracciamento &middot; query non registrate</span>
    <a href="/stats">Statistiche</a>
    <a href="/opensearch.xml">OpenSearch</a>
  </footer>
</div>
</body>
</html>`;
}

export function renderOpenSearch(origin: string, host: string): string {
  const base = origin.replace(/\/$/, '');
  return `<?xml version="1.0" encoding="UTF-8"?>
<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
  <ShortName>LomeSearch</ShortName>
  <Description>Motore di ricerca locale di LomeSearch, senza tracciamento</Description>
  <InputEncoding>UTF-8</InputEncoding>
  <OutputEncoding>UTF-8</OutputEncoding>
  <Image width="16" height="16" type="image/svg+xml">${base}/favicon.svg</Image>
  <Url type="text/html" method="get" template="${base}/search?q={searchTerms}"/>
  <Url type="application/json" method="get" template="${base}/search?q={searchTerms}&amp;format=json"/>
  <Url type="application/x-suggestions+json" method="get" template="${base}/suggest?q={searchTerms}"/>
  <Attribution>LomeSearch - ${escapeHtml(host)}</Attribution>
</OpenSearchDescription>`;
}

export function renderErrorPage(status: number, message: string): string {
  return `<!doctype html>
<html lang="it"><head><meta charset="utf-8"><title>${status} - LomeSearch</title>
<style>${STYLES}</style></head>
<body><div class="wrap"><header class="bar"><a class="brand" href="/">Lome<span>Search</span></a></header>
<main><h1>${status}</h1><p>${escapeHtml(message)}</p></main></div></body></html>`;
}

function formatNumber(value: number): string {
  return value.toLocaleString('it-IT');
}
