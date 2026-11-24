import type { WebResultItem } from '../../shared/types.js';
import { EXTERNAL_ENGINES } from '../../shared/constants.js';
import { card, clear, el, heading, initPage, lome, toast } from './common.js';

/**
 * `lomesearch://search?q=…&page=n` — the results page.
 *
 * It is rendered here, in the browser, from the engine's JSON answer: nothing
 * is fetched from `http://127.0.0.1:<port>/search`, so the address bar never
 * shows a server page and the same markup serves the desktop and Android.
 */

const { main, settings } = await initPage('search', 'Results');

const params = new URLSearchParams(location.search);
const query = (params.get('q') ?? '').slice(0, 512);
const page = Math.max(1, Number(params.get('page') ?? '1') || 1);
const perPage = 10;
const wantsWeb = params.get('web') === '1';

function searchUrl(target: string, targetPage: number): string {
  const next = new URLSearchParams({ q: target });
  if (targetPage > 1) next.set('page', String(targetPage));
  if (wantsWeb) next.set('web', '1');
  return `lomesearch://search?${next.toString()}`;
}

function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** Snippets arrive as escaped HTML with <mark> around the matches. */
function plain(raw: string): string {
  return raw.replace(/<\/?mark>/gi, '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, name: string) => {
    if (name.startsWith('#')) {
      const code = name[1]?.toLowerCase() === 'x' ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

function highlight(raw: string, terms: string[]): Node[] {
  const text = plain(raw);
  if (terms.length === 0) return [document.createTextNode(text)];
  const pattern = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  const nodes: Node[] = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > last) nodes.push(document.createTextNode(text.slice(last, at)));
    nodes.push(el('mark', {}, match[0]));
    last = at + match[0].length;
  }
  if (last < text.length) nodes.push(document.createTextNode(text.slice(last)));
  return nodes;
}

function terms(): string[] {
  return query
    .split(/\s+/)
    .map((word) => word.replace(/^["']|["']$/g, ''))
    .filter((word) => word.length > 1 && !/^(site|lang|filetype):/i.test(word))
    .slice(0, 8);
}

interface ItemLike {
  url: string;
  title: string;
  site: string;
  snippet: string;
  description?: string;
}

function resultItem(result: ItemLike): HTMLElement {
  return el(
    'li',
    { class: 'result' },
    el(
      'p',
      { class: 'result__site' },
      el('span', {}, result.site || host(result.url)),
      el('span', { class: 'dot' }, '·'),
      el('span', { class: 'result__url' }, result.url),
    ),
    el(
      'h2',
      { class: 'result__title' },
      el('a', { href: result.url, rel: 'noreferrer noopener' }, ...highlight(result.title, terms())),
    ),
    el('p', { class: 'result__snippet' }, ...highlight(result.snippet || result.description || '', terms())),
  );
}

function searchBox(): HTMLElement {
  const input = el('input', {
    type: 'search',
    value: query,
    placeholder: 'Search the local index',
    'aria-label': 'Search',
    autocomplete: 'off',
  });
  return el(
    'form',
    {
      class: 'search-inline',
      onsubmit: (event: Event) => {
        event.preventDefault();
        const next = input.value.trim();
        if (next) location.href = searchUrl(next, 1);
      },
    },
    input,
    el('button', { class: 'btn primary', type: 'submit' }, 'Search'),
  );
}

function pager(total: number): HTMLElement | null {
  const pages = Math.max(1, Math.ceil(total / perPage));
  if (pages <= 1) return null;
  const nav = el('nav', { class: 'pager', 'aria-label': 'Pages' });
  if (page > 1) {
    nav.append(el('a', { class: 'btn', href: searchUrl(query, page - 1), rel: 'prev' }, 'Previous'));
  }
  nav.append(el('span', { class: 'pager__count' }, `Page ${page} of ${pages}`));
  if (page < pages) {
    nav.append(el('a', { class: 'btn', href: searchUrl(query, page + 1), rel: 'next' }, 'Next'));
  }
  return nav;
}

function handoff(total: number): HTMLElement | null {
  if (!query.trim()) return null;
  const engine = EXTERNAL_ENGINES[settings.fallbackEngine];
  if (!engine) return null;
  const href = engine.url.replace('%s', encodeURIComponent(query));
  const title = total === 0 ? `Search the web on ${engine.name}` : `Keep looking on ${engine.name}`;
  return card(
    title,
    `The link opens ${engine.name} in a new tab. The query leaves this computer only if you follow it.`,
    el(
      'p',
      {},
      el('a', { class: 'btn', href, target: '_blank', rel: 'noreferrer noopener' }, `Open ${engine.name}`),
    ),
  );
}

function webSection(name: string, host: string, items: WebResultItem[]): HTMLElement {
  return card(
    `Web results from ${name}`,
    `This query was sent to ${host}, because hybrid mode is on and a provider is configured.`,
    items.length === 0
      ? el('p', { class: 'lede' }, 'The provider returned nothing.')
      : el('ol', { class: 'list' }, ...items.map((item) => resultItem(item))),
  );
}

async function render(): Promise<void> {
  clear(main);
  main.append(
    heading(
      query ? `“${query}”` : 'Search',
      query ? '' : 'The query goes to the local index, not to a server.',
    ),
    searchBox(),
  );

  if (!query.trim()) return;

  const response = await lome.engine.search(query, perPage, (page - 1) * perPage, wantsWeb);
  if (!response) {
    main.append(
      card(
        'The local engine is not answering',
        'Start it from the menu (Engine → Start) and try again, or use the hand-off below.',
        el('p', {}, el('a', { class: 'btn', href: searchUrl(query, page) }, 'Try again')),
      ),
      handoff(0) as HTMLElement,
    );
    return;
  }

  const total = response.total;
  main.append(
    el(
      'p',
      { class: 'lede' },
      `${total.toLocaleString('en-US')} ${total === 1 ? 'result' : 'results'} in ${response.tookMs.toFixed(1)} ms · no query logged`,
    ),
  );

  if (response.suggestion && response.results.length > 0) {
    main.append(
      el('p', { class: 'lede' }, 'Suggestion: ', el('a', { href: searchUrl(response.suggestion, 1) }, response.suggestion)),
    );
  }

  if (response.results.length === 0) {
    main.append(
      card(
        'No document matches the query',
        'Try fewer words, drop the quotes, or crawl more pages with `lomesearch crawl`.',
      ),
    );
  } else {
    main.append(el('ol', { class: 'list results' }, ...response.results.map(resultItem)));
    const nav = pager(total);
    if (nav) main.append(nav);
  }

  if (response.web) {
    main.append(
      response.web.error
        ? card(
            `${response.web.name} did not answer`,
            `${response.web.error}. The local results above are unaffected.`,
          )
        : webSection(response.web.name, response.web.host, response.web.items),
    );
  }

  const offer = handoff(total);
  if (offer) main.append(offer);
}

await render();

window.addEventListener('lome:engine', () => void render());

document.addEventListener('keydown', (event) => {
  if (event.key === '/' && document.activeElement === document.body) {
    event.preventDefault();
    toast('Press Ctrl+L to edit the address bar');
  }
});
