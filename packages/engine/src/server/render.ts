import { escapeHtml } from '../query/snippet.js';
import type { SearchResponse, SearchResult } from '../index/index.js';
import type { WebResult } from '../web/provider.js';

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
.result-site { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--muted); min-width: 0; }
.result-site span:last-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.result-site .dot { flex: none; width: 4px; height: 4px; border-radius: 50%; background: var(--muted); display: inline-block; }
h2.result-title { margin: 4px 0 2px; font-size: 18px; line-height: 1.35; font-weight: 600; }
h2.result-title a { color: var(--accent); }
p.result-url { margin: 0 0 6px; font-size: 13px; color: var(--muted); word-break: break-all; }
p.snippet { margin: 0; font-size: 15px; color: var(--text); }
mark { background: var(--mark); color: var(--mark-text); padding: 0 1px; border-radius: 2px; }
.notice { background: var(--accent-soft); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; font-size: 14px; }
.empty { padding: 32px 0; }
.web { margin-top: 34px; padding-top: 18px; border-top: 1px solid var(--line); }
.web-head { margin: 0 0 4px; font-size: 13px; color: var(--muted); }
.web-head strong { color: var(--text); font-weight: 600; }
.web-warn { margin: 0 0 4px; font-size: 13px; color: var(--danger, var(--muted)); }
.ext {
  margin: 28px 0 0;
  padding: 16px 18px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--surface);
}
.ext h2 { margin: 0 0 6px; font-size: 15px; }
.ext p { margin: 0 0 14px; font-size: 13px; color: var(--muted); }
.ext a.go {
  display: inline-block;
  padding: 10px 16px;
  border-radius: 8px;
  background: var(--accent);
  color: var(--surface);
  font-size: 14px;
  font-weight: 600;
}
.ext a.go:hover { text-decoration: none; }
@media (prefers-color-scheme: dark) {
  .ext a.go { color: #10120f; }
}
.empty .mascot {
  display: block;
  width: 64px;
  height: 64px;
  padding: 7px;
  background: #ffffff;
  border-radius: 12px;
}
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

export interface ExternalOffer {
  /** Engine id, kept so paging links can carry the choice. */
  id: string;
  name: string;
  href: string;
}

export interface WebResultsBlock {
  name: string;
  host: string;
  items: WebResult[];
  error: string | null;
}

export interface RenderContext {
  origin: string;
  engineHost: string;
  indexStats: { documents: number; segments: number; indexedTerms: number };
  /** External engine offered as a link; nothing is sent until it is opened. */
  externalOffer?: ExternalOffer;
  /** Results fetched from the configured provider for this request. */
  webResults?: WebResultsBlock;
}

/** Extra `&…` pairs that keep the external-search state across links. */
function stateQuery(context: RenderContext): string {
  const parts: string[] = [];
  if (context.externalOffer) parts.push(`ext=${encodeURIComponent(context.externalOffer.id)}`);
  if (context.webResults) parts.push('web=1');
  return parts.length > 0 ? `&${parts.join('&')}` : '';
}

export function renderSearchPage(
  context: RenderContext,
  query: string,
  response: SearchResponse | null,
  page: number,
): string {
  const parts = [
    response ? renderResults(context, query, response, page) : renderHome(context),
    renderWebResults(context),
    renderExternalOffer(context, query, response?.results.length ?? 0),
  ].filter((part) => part.length > 0);
  return pageShell(context, query, `<main>${parts.join('\n')}</main>`);
}

function renderHome(context: RenderContext): string {
  return `
  <div class="notice">
    Local search engine: queries are not logged, there are no cookies, and no
    request leaves this machine.
  </div>
  <div class="stats">
    <div><strong>${formatNumber(context.indexStats.documents)}</strong>documents indexed</div>
    <div><strong>${formatNumber(context.indexStats.indexedTerms)}</strong>terms in the index</div>
    <div><strong>${formatNumber(context.indexStats.segments)}</strong>segments</div>
  </div>`;
}

function renderResults(
  context: RenderContext,
  query: string,
  response: SearchResponse,
  page: number,
): string {
  if (response.results.length === 0) {
    const suggestion = response.suggestion
      ? `<p class="notice">Did you mean <a href="/search?q=${encodeURIComponent(response.suggestion)}${stateQuery(context)}">${escapeHtml(response.suggestion)}</a>?</p>`
      : '';
    return `
  <p class="meta">No results for <strong>${escapeHtml(query)}</strong> in ${response.tookMs.toFixed(1)} ms.</p>
  ${suggestion}
  <div class="empty">
    <img class="mascot" src="/mascot.svg" width="64" height="64" alt="">
    <h2>No document matches the query</h2>
    <p>Try fewer words, without quotes, or add more pages to the index with <code>lomesearch crawl</code>.</p>
  </div>`;
  }

  const items = response.results.map((result) => renderResult(result)).join('\n');
  const total =
    response.totalRelation === 'gte' ? `more than ${formatNumber(response.total)}` : formatNumber(response.total);
  const relaxed = response.relaxed
    ? '<p class="meta">Few exact results: the query was widened to individual terms.</p>'
    : '';
  const suggestion =
    response.suggestion && response.results.length > 0
      ? `<p class="meta">Suggestion: <a href="/search?q=${encodeURIComponent(response.suggestion)}${stateQuery(context)}">${escapeHtml(response.suggestion)}</a></p>`
      : '';

  const perPage = 10;
  const pager: string[] = [];
  if (page > 1) {
    pager.push(
      `<a rel="prev" href="/search?q=${encodeURIComponent(query)}&page=${page - 1}${stateQuery(context)}">Previous page</a>`,
    );
  }
  if (response.results.length >= perPage) {
    pager.push(
      `<a rel="next" href="/search?q=${encodeURIComponent(query)}&page=${page + 1}${stateQuery(context)}">Next page</a>`,
    );
  }

  return `
  <p class="meta">${total} results in ${response.tookMs.toFixed(1)} ms &middot; no query logged</p>
  ${relaxed}
  ${suggestion}
  <ol class="results">
    ${items}
  </ol>
  ${pager.length > 0 ? `<nav class="pager">${pager.join('')}</nav>` : ''}`;
}

function renderWebResults(context: RenderContext): string {
  const block = context.webResults;
  if (!block) return '';
  if (block.error) {
    return `<section class="web">
  <p class="web-warn">${escapeHtml(block.name)} did not answer: ${escapeHtml(block.error)}. Local results above are unaffected.</p>
</section>`;
  }
  if (block.items.length === 0) {
    return `<section class="web">
  <p class="web-head">No web results from <strong>${escapeHtml(block.name)}</strong> either.</p>
</section>`;
  }
  const items = block.items
    .map(
      (item) => `<li>
    <div class="result-site"><span>${escapeHtml(item.site)}</span><span class="dot"></span><span>${escapeHtml(item.url)}</span></div>
    <h2 class="result-title"><a href="${escapeHtml(item.url)}" rel="noreferrer noopener">${escapeHtml(item.title)}</a></h2>
    ${item.snippet ? `<p class="snippet">${escapeHtml(item.snippet)}</p>` : ''}
  </li>`,
    )
    .join('\n');
  return `<section class="web">
  <p class="web-head">Web results from <strong>${escapeHtml(block.name)}</strong> &middot; this query was sent to ${escapeHtml(block.host)}</p>
  <ol class="results">
    ${items}
  </ol>
</section>`;
}

function renderExternalOffer(context: RenderContext, query: string, localResults: number): string {
  const offer = context.externalOffer;
  if (!offer || !query.trim()) return '';
  const inline = context.webResults !== undefined;
  const name = escapeHtml(offer.name);
  const heading = inline
    ? `Keep looking on ${name}`
    : localResults === 0
      ? 'Search the web instead'
      : 'Looking for something else?';
  const body = inline
    ? `The link below hands the query to ${name} and keeps the extra results there.`
    : localResults === 0
      ? `The local index has nothing for this query. ${name} is a third party: nothing leaves this machine until you click.`
      : `Searching ${name} sends the query to a third party. Nothing leaves this machine until you click.`;
  return `<div class="ext">
  <h2>${heading}</h2>
  <p>${body}</p>
  <a class="go" href="${escapeHtml(offer.href)}" rel="noreferrer noopener">Search &ldquo;${escapeHtml(query)}&rdquo; on ${escapeHtml(offer.name)}</a>
</div>`;
}

function renderResult(result: SearchResult): string {
  const date = result.fetchedAt
    ? new Date(result.fetchedAt).toLocaleDateString('en-US', {
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
<html lang="en">
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
    <label for="q" class="visually-hidden" hidden>Search the index</label>
    <input id="q" type="search" name="q" value="${escapeHtml(query)}" placeholder="Search the local index" autocomplete="off" autofocus>
    ${context.externalOffer ? `<input type="hidden" name="ext" value="${escapeHtml(context.externalOffer.id)}">` : ''}
    ${context.webResults ? '<input type="hidden" name="web" value="1">' : ''}
    <button type="submit">Search</button>
  </form>
  ${body}
  <footer>
    <span>Local index on ${escapeHtml(context.engineHost)}</span>
    <span>No cookies &middot; no tracking &middot; queries not logged</span>
    <a href="/stats">Stats</a>
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
  <Description>LomeSearch local search engine, no tracking</Description>
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
<html lang="en"><head><meta charset="utf-8"><title>${status} - LomeSearch</title>
<style>${STYLES}</style></head>
<body><div class="wrap"><header class="bar"><a class="brand" href="/">Lome<span>Search</span></a></header>
<main><h1>${status}</h1><p>${escapeHtml(message)}</p></main></div></body></html>`;
}

function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
}
