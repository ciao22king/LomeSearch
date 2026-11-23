import { MemoryIndex } from './engine.js';

/**
 * Web edition of LomeSearch.
 *
 * The engine bundle in ./engine.js is the same analysis, BM25F scoring and
 * query executor the desktop app runs; here the corpus is a bundled JSON file
 * and the index lives in memory. Everything below is the browser UI: tabs, an
 * address bar, the internal pages and the result list.
 */

const SETTINGS_KEY = 'lomesearch.web.settings';
const HISTORY_KEY = 'lomesearch.web.history';

const ENGINES = {
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=%s' },
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
  brave: { name: 'Brave Search', url: 'https://search.brave.com/search?q=%s' },
  mojeek: { name: 'Mojeek', url: 'https://www.mojeek.com/search?q=%s' },
  startpage: { name: 'Startpage', url: 'https://www.startpage.com/sp/search?query=%s' },
};

const PAGES = {
  history: { title: 'Cronologia', icon: 'clock' },
  settings: { title: 'Impostazioni', icon: 'gear' },
  privacy: { title: 'Privacy', icon: 'shield' },
  about: { title: 'Informazioni', icon: 'globe' },
};

const DEFAULTS = { theme: 'auto', perPage: 10, handoff: 'bing', remember: true };

const state = {
  index: null,
  corpus: null,
  indexMs: 0,
  settings: loadSettings(),
  history: loadHistory(),
  tabs: [],
  active: 0,
  nextId: 1,
};

// ------------------------------------------------------------------ helpers

const $ = (selector, root = document) => root.querySelector(selector);

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2), value);
    } else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
}

/** The engine marks matches with <mark>; allow that tag and nothing else. */
function markedText(html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  const walk = (node, target) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) {
        target.append(document.createTextNode(child.textContent));
      } else if (child.nodeName === 'MARK') {
        target.append(el('mark', {}, child.textContent));
      } else {
        walk(child, target);
      }
    }
  };
  const fragment = document.createDocumentFragment();
  walk(template.content, fragment);
  return fragment;
}

function number(value) {
  return new Intl.NumberFormat('it-IT').format(value);
}

function timeAgo(timestamp) {
  const minutes = Math.round((Date.now() - timestamp) / 60_000);
  if (minutes < 1) return 'adesso';
  if (minutes < 60) return `${minutes} min fa`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h fa`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'ieri' : `${days} giorni fa`;
}

// ------------------------------------------------------------------- storage

function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  applyTheme();
}

function loadHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.slice(0, 200) : [];
  } catch {
    return [];
  }
}

function saveHistory() {
  if (state.settings.remember) {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history.slice(0, 200)));
  } else {
    localStorage.removeItem(HISTORY_KEY);
  }
}

function applyTheme() {
  document.documentElement.dataset.theme = state.settings.theme;
}

function remember(query) {
  const clean = query.trim();
  if (!clean || !state.settings.remember) return;
  state.history = [{ q: clean, at: Date.now() }, ...state.history.filter((item) => item.q !== clean)];
  state.history = state.history.slice(0, 200);
  saveHistory();
}

// ------------------------------------------------------------------ the tabs

function newEntry(kind, data = {}) {
  return { kind, ...data };
}

function currentTab() {
  return state.tabs[state.active];
}

function currentEntry() {
  return currentTab()?.entries[currentTab().pos] ?? newEntry('newtab');
}

function openTab(entry) {
  const tab = { id: state.nextId++, entries: [entry], pos: 0 };
  state.tabs.push(tab);
  state.active = state.tabs.length - 1;
  renderTabs();
  render();
  return tab;
}

function closeTab(id) {
  const index = state.tabs.findIndex((tab) => tab.id === id);
  if (index === -1) return;
  state.tabs.splice(index, 1);
  if (state.tabs.length === 0) {
    openTab(newEntry('newtab'));
    return;
  }
  state.active = Math.min(state.active, state.tabs.length - 1);
  renderTabs();
  render();
}

function activate(id) {
  const index = state.tabs.findIndex((tab) => tab.id === id);
  if (index === -1) return;
  state.active = index;
  renderTabs();
  render();
}

function navigate(entry, { replace = false } = {}) {
  const tab = currentTab();
  if (!tab) {
    openTab(entry);
    return;
  }
  if (replace) tab.entries[tab.pos] = entry;
  else {
    tab.entries = tab.entries.slice(0, tab.pos + 1);
    tab.entries.push(entry);
    tab.pos = tab.entries.length - 1;
  }
  renderTabs();
  render();
}

function goBack() {
  const tab = currentTab();
  if (!tab || tab.pos === 0) return;
  tab.pos -= 1;
  render();
}

function goForward() {
  const tab = currentTab();
  if (!tab || tab.pos === tab.entries.length - 1) return;
  tab.pos += 1;
  render();
}

function tabTitle(tab) {
  const entry = tab.entries[tab.pos] ?? tab.entries[0];
  if (!entry) return 'Nuova scheda';
  if (entry.kind === 'newtab') return 'Nuova scheda';
  if (entry.kind === 'search') return `${entry.query} — LomeSearch`;
  if (entry.kind === 'page') return `${PAGES[entry.name]?.title ?? 'Pagina'} — LomeSearch`;
  if (entry.kind === 'external') return entry.url;
  return 'LomeSearch';
}

function tabEntry(entry) {
  if (entry.kind === 'search') return 'search';
  if (entry.kind === 'page') return PAGES[entry.name]?.icon ?? 'gear';
  if (entry.kind === 'external') return 'globe';
  return 'search';
}

function renderTabs() {
  const list = $('#tabs');
  list.replaceChildren(
    ...state.tabs.map((tab, index) =>
      el(
        'li',
        {
          class: 'tab',
          role: 'tab',
          tabindex: index === state.active ? '0' : '-1',
          'aria-selected': index === state.active ? 'true' : 'false',
          onclick: () => activate(tab.id),
          onauxclick: (event) => {
            if (event.button === 1) closeTab(tab.id);
          },
          onkeydown: (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              activate(tab.id);
            }
          },
        },
        el('span', { class: 'tab__icon' }, icon(tabEntry(tab.entries[tab.pos] ?? tab.entries[0]))),
        el('span', { class: 'tab__label', title: tabTitle(tab) }, tabTitle(tab)),
        el(
          'button',
          {
            type: 'button',
            class: 'tab__close',
            'aria-label': 'Chiudi scheda',
            title: 'Chiudi scheda (Ctrl+W)',
            onclick: (event) => {
              event.stopPropagation();
              closeTab(tab.id);
            },
          },
          icon('x'),
        ),
      ),
    ),
  );
}

// -------------------------------------------------------------- address bar

function addressFor(entry) {
  if (entry.kind === 'search') return entry.query;
  if (entry.kind === 'page') return `lome:${entry.name}`;
  if (entry.kind === 'external') return entry.url;
  return '';
}

function parseAddress(input) {
  const value = input.trim();
  if (!value) return newEntry('newtab');
  if (/^lome:/i.test(value)) {
    const name = value.slice(5).replace(/\/+$/, '').trim().toLowerCase();
    if (name === '' || name === 'newtab') return newEntry('newtab');
    if (PAGES[name]) return newEntry('page', { name });
    return newEntry('page', { name: 'missing', target: value });
  }
  if (/^(https?:)?\/\//i.test(value) || /^[\w-]+(\.[\w-]+)+(\/|$|\?)/.test(value)) {
    return newEntry('external', { url: /^https?:/i.test(value) ? value : `https://${value}` });
  }
  return newEntry('search', { query: value, page: 1 });
}

function startSearch(query) {
  remember(query);
  navigate(newEntry('search', { query, page: 1 }));
}

function submitAddress(input) {
  hideSuggestions();
  const entry = parseAddress(input);
  if (entry.kind === 'search') {
    startSearch(entry.query);
  } else {
    navigate(entry);
  }
  $('#omni').value = '';
}

// ------------------------------------------------------------- suggestions

let suggestionItems = [];
let suggestionIndex = -1;

function hideSuggestions() {
  const list = $('#suggestions');
  list.hidden = true;
  list.replaceChildren();
  $('#omni').setAttribute('aria-expanded', 'false');
  suggestionItems = [];
  suggestionIndex = -1;
}

function showSuggestions(prefix) {
  const list = $('#suggestions');
  if (!state.index || prefix.trim().length < 2 || /^lome:/i.test(prefix) || /\./.test(prefix)) {
    hideSuggestions();
    return;
  }
  if (typeof state.index.suggest !== 'function') {
    hideSuggestions();
    return;
  }
  const terms = state.index.suggest(prefix.trim().toLowerCase(), 6);
  if (terms.length === 0) {
    hideSuggestions();
    return;
  }
  suggestionItems = terms;
  suggestionIndex = -1;
  list.replaceChildren(
    ...terms.map((term, index) =>
      el(
        'li',
        {
          role: 'option',
          id: `suggestion-${index}`,
          onclick: () => submitAddress(term),
        },
        icon('search'),
        el('span', { html: highlight(term, prefix.trim()) }),
      ),
    ),
  );
  list.hidden = false;
  $('#omni').setAttribute('aria-expanded', 'true');
}

function highlight(term, prefix) {
  if (!term.toLowerCase().startsWith(prefix.toLowerCase())) return escapeHtml(term);
  return `<mark>${escapeHtml(term.slice(0, prefix.length))}</mark>${escapeHtml(term.slice(prefix.length))}`;
}

function moveSuggestion(delta) {
  if (suggestionItems.length === 0) return;
  suggestionIndex = (suggestionIndex + delta + suggestionItems.length) % suggestionItems.length;
  for (const [index, node] of [...$('#suggestions').children].entries()) {
    node.setAttribute('aria-selected', index === suggestionIndex ? 'true' : 'false');
  }
  $('#omni').setAttribute('aria-activedescendant', `suggestion-${suggestionIndex}`);
}

// ------------------------------------------------------------------- render

function syncHash(entry) {
  const hash =
    entry.kind === 'search' && entry.page === 1
      ? `#q=${encodeURIComponent(entry.query)}`
      : entry.kind === 'page'
        ? `#lome:${entry.name}`
        : '';
  const target = hash || location.pathname + location.search;
  if (hash && location.hash === hash) return;
  history.replaceState(null, '', target);
}

function entryFromHash() {
  let hash = '';
  try {
    hash = decodeURIComponent(location.hash.replace(/^#/, '').replace(/\+/g, ' ')).trim();
  } catch {
    return null;
  }
  if (!hash) return null;
  if (hash.startsWith('q=')) {
    const query = hash.slice(2).trim();
    return query ? newEntry('search', { query, page: 1 }) : null;
  }
  if (hash.startsWith('lome:')) {
    const name = hash.slice(5).toLowerCase();
    return PAGES[name] ? newEntry('page', { name }) : null;
  }
  return null;
}

function render() {
  const tab = currentTab();
  const entry = currentEntry();
  syncHash(entry);
  const viewport = $('#viewport');
  viewport.replaceChildren(renderEntry(entry));
  viewport.scrollTop = 0;

  const omni = $('#omni');
  if (document.activeElement !== omni) omni.value = addressFor(entry);
  $('#go-back').disabled = !tab || tab.pos === 0;
  $('#go-forward').disabled = !tab || tab.pos === tab.entries.length - 1;
  document.title = `${tabTitle(tab ?? { entries: [entry], pos: 0 })}`;
}

function loadingScreen() {
  return el(
    'div',
    { class: 'boot' },
    el('img', { class: 'boot__mascot', src: '../assets/mascot/mascotte.svg', alt: '', width: '72', height: '72' }),
    el('p', { class: 'boot__title' }, 'Sto costruendo l\'indice nel tuo browser'),
    el('p', { class: 'boot__hint' }, 'Analisi, postings e ranking di 137 documenti, in memoria. Nessun dato lascia la pagina.'),
    el('div', { class: 'boot__bar', role: 'progressbar', 'aria-label': 'Avanzamento' }, el('span')),
  );
}

function renderEntry(entry) {
  if (entry.kind === 'search' && !state.index) return loadingScreen();
  if (entry.kind === 'search') return renderResults(entry);
  if (entry.kind === 'page') return renderPage(entry);
  if (entry.kind === 'external') return renderExternal(entry);
  return renderNewTab();
}

// ---------------------------------------------------------------- new tab

const EXAMPLES = ['privacy', 'cookie', 'lang:it crittografia', 'site:wikipedia.org http', '"inverted index"'];

function renderNewTab() {
  const input = el('input', {
    type: 'search',
    placeholder: 'Cerca nell\'indice locale',
    'aria-label': 'Cerca nell\'indice locale',
    autocomplete: 'off',
  });
  const stats = state.index?.stats();

  return el(
    'div',
    {},
    el(
      'section',
      { class: 'hero' },
      el('p', { class: 'hero__mark' }, 'Lome', el('span', {}, 'Search')),
      el(
        'p',
        { class: 'hero__sub' },
        `Edizione web · ${number(stats?.documents ?? 0)} documenti indicizzati in questa pagina`,
      ),
      el(
        'form',
        {
          class: 'search-big',
          onsubmit: (event) => {
            event.preventDefault();
            if (input.value.trim()) startSearch(input.value.trim());
          },
        },
        input,
        el('button', { type: 'submit' }, 'Cerca'),
      ),
      el('p', { class: 'hero__note' }, 'Nessuna richiesta esce da questa pagina: l\'indice è già qui.'),
    ),
    el(
      'div',
      { class: 'stats' },
      stat(number(stats?.documents ?? 0), 'documenti'),
      stat(number(stats?.terms ?? 0), 'termini nell\'indice'),
      stat(`${state.indexMs.toFixed(0)} ms`, 'per costruire l\'indice'),
    ),
    el(
      'ul',
      { class: 'shortcuts' },
      el('li', {}, shortcut('clock', 'Cronologia', () => navigate(newEntry('page', { name: 'history' })))),
      el('li', {}, shortcut('gear', 'Impostazioni', () => navigate(newEntry('page', { name: 'settings' })))),
      el('li', {}, shortcut('shield', 'Privacy', () => navigate(newEntry('page', { name: 'privacy' })))),
      el('li', {}, shortcut('globe', 'Informazioni', () => navigate(newEntry('page', { name: 'about' })))),
    ),
    el(
      'div',
      { class: 'examples' },
      el(
        'div',
        { class: 'card' },
        el('h2', {}, 'Prova una di queste'),
        el(
          'p',
          {},
          'Sono query vere sull\'indice: puoi usare le virgolette per le frasi, ',
          el('code', {}, 'site:'),
          ', ',
          el('code', {}, 'lang:'),
          ', ',
          el('code', {}, 'intitle:'),
          ' e ',
          el('code', {}, '-escludi'),
          '.',
        ),
        el(
          'ul',
          { class: 'shortcuts' },
          EXAMPLES.map((query) =>
            el(
              'li',
              {},
              el(
                'button',
                {
                  type: 'button',
                  onclick: () => startSearch(query),
                },
                el('span', { class: 'key' }, icon('search')),
                query,
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

function stat(value, label) {
  return el('div', { class: 'stat' }, el('span', { class: 'stat__value' }, value), el('span', { class: 'stat__label' }, label));
}

function shortcut(name, label, onclick) {
  return el(
    'button',
    { type: 'button', onclick },
    el('span', { class: 'key' }, icon(name)),
    label,
  );
}

// ----------------------------------------------------------------- results

function perPage() {
  return state.settings.perPage ?? DEFAULTS.perPage;
}

function renderResults(entry) {
  const response = state.index.search(entry.query, {
    limit: perPage(),
    offset: (entry.page - 1) * perPage(),
  });
  const totalPages = Math.max(1, Math.ceil(Math.min(response.total, 500) / perPage()));

  const head = el(
    'div',
    { class: 'results-head' },
    el('strong', {}, `${number(response.total)} ${response.total === 1 ? 'risultato' : 'risultati'}`),
    el('span', { class: 'sep' }),
    el('span', {}, `${response.tookMs.toFixed(1)} ms`),
    el('span', { class: 'sep' }),
    el('span', {}, `${number(state.index.size)} documenti`),
    el('span', { class: 'sep' }),
    el('span', {}, 'nessuna richiesta inviata'),
  );

  const children = [
    el('p', { class: 'eyebrow' }, 'risultati'),
    el('h1', {}, `“${entry.query}”`),
    head,
  ];

  if (response.relaxed) {
    children.push(
      el(
        'p',
        { class: 'hint' },
        'Nessun documento conteneva tutte le parole: ho cercato quelle presenti, in ordine di rilevanza.',
      ),
    );
  }
  if (response.suggestion) {
    children.push(
      el(
        'p',
        { class: 'hint' },
        'Forse cercavi ',
        el(
          'a',
          {
            href: '#',
            onclick: (event) => {
              event.preventDefault();
              navigate(newEntry('search', { query: response.suggestion, page: 1 }));
            },
          },
          response.suggestion,
        ),
        '.',
      ),
    );
  }

  if (response.results.length === 0) {
    children.push(
      el(
        'div',
        { class: 'empty' },
        el('img', {
          class: 'empty__mascot',
          src: '../assets/mascot/mascotte.svg',
          alt: '',
          width: '64',
          height: '64',
        }),
        el('h2', {}, 'Nessun documento corrisponde alla query'),
        el(
          'p',
          {},
          'Prova meno parole, senza virgolette, oppure restringi con ',
          el('code', {}, 'site:'),
          ' o ',
          el('code', {}, 'lang:'),
          '.',
        ),
      ),
    );
  } else {
    children.push(
      el(
        'ol',
        { class: 'results' },
        response.results.map((result) =>
          el(
            'li',
            {},
            el(
              'div',
              { class: 'result-site' },
              el('span', {}, result.site || result.host),
              el('span', { class: 'dot' }),
              el('span', {}, result.url),
            ),
            el(
              'h2',
              { class: 'result-title' },
              el(
                'a',
                {
                  href: '#',
                  title: result.url,
                  onclick: (event) => {
                    event.preventDefault();
                    navigate(newEntry('external', { url: result.url }));
                  },
                },
                result.title,
              ),
            ),
            el('p', { class: 'snippet' }, markedText(result.snippet)),
            el(
              'p',
              { class: 'result-url' },
              `${new Date(result.fetchedAt).toLocaleDateString('it-IT', { year: 'numeric', month: 'short', day: 'numeric' })}${result.lang ? ` · ${result.lang}` : ''}`,
            ),
          ),
        ),
      ),
    );

    if (totalPages > 1) {
      children.push(
        el(
          'div',
          { class: 'pager' },
          el(
            'button',
            {
              type: 'button',
              disabled: entry.page <= 1,
              onclick: () => navigate(newEntry('search', { query: entry.query, page: entry.page - 1 })),
            },
            'Precedente',
          ),
          el(
            'button',
            {
              type: 'button',
              disabled: entry.page >= totalPages,
              onclick: () => navigate(newEntry('search', { query: entry.query, page: entry.page + 1 })),
            },
            'Successiva',
          ),
          el('span', {}, `pagina ${entry.page} di ${totalPages}`),
        ),
      );
    }
  }

  children.push(handoff(entry.query, response.total));
  return el('div', { class: 'page page--wide' }, children);
}

function handoff(query, localResults) {
  const engine = ENGINES[state.settings.handoff];
  if (!engine) return null;
  const href = engine.url.replace('%s', encodeURIComponent(query));
  const heading =
    localResults === 0 ? 'Cerca sul web invece' : 'Cerchi qualcosa d\'altro?';
  return el(
    'div',
    { class: 'handoff' },
    el('h2', {}, `${heading} — ${engine.name}`),
    el(
      'p',
      {},
      localResults === 0
        ? `L'indice locale non ha nulla per questa query. ${engine.name} è un servizio esterno: la query esce da questa macchina solo se apri il link.`
        : `Il link manda la query a ${engine.name}, che ha un indice suo. Nulla esce da questa pagina finché non lo apri.`,
    ),
    el(
      'a',
      { href, target: '_blank', rel: 'noreferrer noopener' },
      `Cerca “${query}” su ${engine.name}`,
    ),
  );
}

// ------------------------------------------------------------ internal pages

function renderPage(entry) {
  if (entry.name === 'history') return renderHistory();
  if (entry.name === 'settings') return renderSettings();
  if (entry.name === 'privacy') return renderPrivacy();
  if (entry.name === 'about') return renderAbout();
  return renderMissing(entry.target);
}

function pageHeader(title, lede) {
  return [el('p', { class: 'eyebrow' }, 'lome:' + title.toLowerCase()), el('h1', {}, title), lede ? el('p', {}, lede) : null];
}

function renderHistory() {
  const rows = state.history;
  const children = [
    ...pageHeader(
      'Cronologia',
      rows.length === 0
        ? 'Vuota: qui finiscono le query che cerchi, mai le pagine che visiti.'
        : `${number(rows.length)} ${rows.length === 1 ? 'query' : 'query'} salvate in questo browser. Nessun titolo, nessun URL.`,
    ),
  ];

  if (rows.length > 0) {
    children.push(
      el(
        'ul',
        { class: 'rows rows--spaced' },
        rows.map((item) =>
          el(
            'li',
            { class: 'row' },
            el('span', { class: 'row__main' }, el('span', { class: 'row__title' }, item.q), el('span', { class: 'row__meta' }, timeAgo(item.at))),
            el(
              'button',
              {
                type: 'button',
                class: 'link',
                onclick: () => navigate(newEntry('search', { query: item.q, page: 1 })),
              },
              'Ripeti',
            ),
          ),
        ),
      ),
      el(
        'div',
        { class: 'pager' },
        el(
          'button',
          {
            type: 'button',
            id: 'clear-history',
            onclick: () => {
              state.history = [];
              saveHistory();
              render();
            },
          },
          'Cancella la cronologia',
        ),
      ),
    );
  } else {
    children.push(
      el(
        'div',
        { class: 'empty' },
        el('img', { class: 'empty__mascot', src: '../assets/mascot/mascotte.svg', alt: '', width: '64', height: '64' }),
        el('h2', {}, 'Niente da mostrare'),
        el('p', {}, 'Le ricerche che fai compaiono qui, se la cronologia è attiva nelle impostazioni.'),
      ),
    );
  }
  return el('div', { class: 'page' }, children);
}

function renderSettings() {
  const themeSelect = el(
    'select',
    {
      id: 'theme',
      onchange: (event) => {
        state.settings.theme = event.target.value;
        saveSettings();
      },
    },
    ...[
      ['auto', 'Come il sistema'],
      ['light', 'Chiaro'],
      ['dark', 'Scuro'],
    ].map(([value, label]) => el('option', { value, selected: state.settings.theme === value }, label)),
  );

  const perPageSelect = el(
    'select',
    {
      id: 'per-page',
      onchange: (event) => {
        state.settings.perPage = Number(event.target.value);
        saveSettings();
      },
    },
    ...[10, 20, 50].map((value) =>
      el('option', { value: String(value), selected: state.settings.perPage === value }, `${value} risultati`),
    ),
  );

  const handoffSelect = el(
    'select',
    {
      id: 'handoff',
      onchange: (event) => {
        state.settings.handoff = event.target.value;
        saveSettings();
      },
    },
    el('option', { value: 'none', selected: state.settings.handoff === 'none' }, 'Nessuno: solo indice locale'),
    ...Object.entries(ENGINES).map(([value, engine]) =>
      el('option', { value, selected: state.settings.handoff === value }, engine.name),
    ),
  );

  const rememberToggle = el('input', {
    type: 'checkbox',
    id: 'remember',
    checked: state.settings.remember,
    onchange: (event) => {
      state.settings.remember = event.target.checked;
      saveSettings();
      saveHistory();
    },
  });

  return el(
    'div',
    { class: 'page' },
    ...pageHeader('Impostazioni', 'Tutto quello che c\'è qui resta in questo browser: quattro chiavi in localStorage e nient\'altro.'),
    el(
      'div',
      { class: 'card card--spaced' },
      field('Tema', 'La finestra segue il sistema, oppure la forzi.', themeSelect, 'theme'),
      field('Risultati per pagina', 'Quanti risultati mostrare in una pagina di risultati.', perPageSelect, 'per-page'),
      field(
        'Motore di riserva',
        'Il riquadro in fondo ai risultati. Il link non parte da solo: la query esce solo se lo apri.',
        handoffSelect,
        'handoff',
      ),
      el(
        'div',
        { class: 'field' },
        el(
          'label',
          { class: 'field__label', for: 'remember' },
          'Cronologia delle query',
          el('small', {}, 'Salva le ricerche in questo browser. Nessun URL, nessun titolo, niente altro.'),
        ),
        el('span', { class: 'switch' }, rememberToggle, el('label', { for: 'remember' }, 'attiva')),
      ),
    ),
    el(
      'div',
      { class: 'card' },
      el('h2', {}, 'Dati locali'),
      el(
        'p',
        {},
        'Cancella impostazioni, cronologia e tema come farebbe il pulsante del browser desktop. L\'indice non è un dato tuo: si ricostruisce ricaricando la pagina.',
      ),
      el(
        'button',
        {
          type: 'button',
          class: 'button button--danger',
          onclick: () => {
            localStorage.removeItem(SETTINGS_KEY);
            localStorage.removeItem(HISTORY_KEY);
            state.settings = { ...DEFAULTS };
            state.history = [];
            applyTheme();
            render();
          },
        },
        'Cancella i dati locali',
      ),
    ),
  );
}

function field(label, hint, control, id) {
  const caption = id
    ? el('label', { class: 'field__label', for: id }, label, el('small', {}, hint))
    : el('div', { class: 'field__label' }, label, el('small', {}, hint));
  return el('div', { class: 'field' }, caption, control);
}

function renderPrivacy() {
  const resources = performance.getEntriesByType('resource').filter((entry) => entry.name.startsWith(location.origin));
  const foreign = performance.getEntriesByType('resource').filter((entry) => !entry.name.startsWith(location.origin));
  const origins = [...new Set(resources.map((entry) => new URL(entry.name).pathname))];

  return el(
    'div',
    { class: 'page' },
    ...pageHeader(
      'Privacy',
      'Questa pagina è la dimostrazione di quello che il browser fa di default: niente telemetria, niente account, niente query a terzi.',
    ),
    el(
      'ul',
      { class: 'facts facts--spaced' },
      el('li', {}, el('strong', {}, '0'), el('span', {}, 'cookie scritti')),
      el('li', {}, el('strong', {}, String(foreign.length)), el('span', {}, 'richieste a domini esterni')),
      el('li', {}, el('strong', {}, String(resources.length)), el('span', {}, 'file caricati da questo sito')),
      el('li', {}, el('strong', {}, String(state.history.length)), el('span', {}, 'query in cronologia (solo se attiva)')),
    ),
    el(
      'div',
      { class: 'card' },
      el('h2', {}, 'Cosa carica questa pagina'),
      el(
        'p',
        {},
        'Il browser riporta questi file: sono tutti su questo sito, nessuno su una CDN.',
      ),
      el('ul', { class: 'rows' }, origins.map((path) => el('li', { class: 'row' }, el('span', { class: 'row__title mono' }, path)))),
    ),
    el(
      'div',
      { class: 'card' },
      el('h2', {}, 'Cosa fa l\'app desktop, e qui non serve'),
      el(
        'ul',
        { class: 'rows' },
        ...[
          'Blocca tracker e annunci prima che parta la connessione: 214 regole nella lista inclusa.',
          'Toglie i cookie di terze parti, isola lo storage per sito e manda DNT e Sec-GPC.',
          'Forza HTTPS, riduce i client hint, disabilita WebRTC e falsifica il fuso orario.',
          'Gira su un motore di ricerca locale completo: crawler, IndexNow, ranking BM25F, server su 127.0.0.1.',
        ].map((line) => el('li', { class: 'row' }, el('span', { class: 'row__main' }, line))),
      ),
      el(
        'p',
        { class: 'small small--spaced' },
        'Il dettaglio completo, con la tabella delle chiamate di rete, è in ',
        el('a', { href: 'https://github.com/ciao22king/LomeSearch/blob/main/docs/privacy.md' }, 'docs/privacy.md'),
        '.',
      ),
    ),
  );
}

function renderAbout() {
  const source = state.corpus?.source;
  return el(
    'div',
    { class: 'page' },
    ...pageHeader(
      'Informazioni',
      'LomeSearch è un browser desktop con il suo motore di ricerca. Questa è l\'edizione web: stesso motore, indice in memoria.',
    ),
    el(
      'div',
      { class: 'card card--spaced' },
      el('h2', {}, 'Cosa gira in questa pagina'),
      el(
        'p',
        {},
        'Il bundle in ',
        el('code', {}, 'engine.js'),
        ' contiene l\'analisi dei testi, il ranking BM25F, il parser delle query e il generatore di snippet del motore, compilati da TypeScript. L\'indice viene costruito all\'apertura: ',
        number(state.index?.size ?? 0),
        ' documenti, ',
        number(state.index?.stats().terms ?? 0),
        ' termini, ',
        `${state.indexMs.toFixed(0)} ms`,
        '.',
      ),
      el(
        'p',
        {},
        'Il browser desktop aggiunge ciò che una pagina non può fare: crawler, IndexNow, blocco delle richieste, estensioni Chrome, schede con processi separati, finestre private.',
      ),
    ),
    el(
      'div',
      { class: 'card' },
      el('h2', {}, 'Il corpus di questa demo'),
      el(
        'p',
        {},
        `${number(state.corpus?.documents.length ?? 0)} estratti da ${source?.name ?? 'Wikipedia'} (${source?.license ?? 'CC BY-SA 4.0'}), aggiornati il ${state.corpus?.generatedAt ? new Date(state.corpus.generatedAt).toLocaleDateString('it-IT') : '—'}. Ogni risultato linka l'articolo da cui viene: la licenza chiede questo, e fa comodo anche a te.`,
      ),
      el(
        'p',
        { class: 'small' },
        'Nessun testo è stato riscritto: gli estratti sono tagliati a fine frase.',
      ),
    ),
    el(
      'div',
      { class: 'card' },
      el('h2', {}, 'Codice e licenza'),
      el(
        'p',
        {},
        'Apache-2.0. Sorgente su ',
        el('a', { href: 'https://github.com/ciao22king/LomeSearch' }, 'GitHub'),
        ', con i pacchetti per Linux, Windows e Android nella pagina delle release.',
      ),
        el(
          'ul',
          { class: 'rows' },
          el('li', { class: 'row' }, el('span', { class: 'row__main' }, el('span', { class: 'row__title' }, 'Versione 1.0.0')), el('span', { class: 'mono small' }, 'web edition')),
          el('li', { class: 'row' }, el('span', { class: 'row__main' }, el('span', { class: 'row__title' }, 'Motore')), el('span', { class: 'mono small' }, '@lomesearch/engine')),
        ),
    ),
  );
}

function renderMissing(target) {
  return el(
    'div',
    { class: 'page' },
    ...pageHeader('Pagina non trovata', `Non c'è una pagina interna chiamata ${target ?? 'questa'}.`),
    el(
      'p',
      {},
      'Le pagine disponibili sono ',
      el('code', {}, 'lome:history'),
      ', ',
      el('code', {}, 'lome:settings'),
      ', ',
      el('code', {}, 'lome:privacy'),
      ' e ',
      el('code', {}, 'lome:about'),
      '.',
    ),
  );
}

// ---------------------------------------------------------------- external

function renderExternal(entry) {
  let host = entry.url;
  try {
    host = new URL(entry.url).host;
  } catch {
    host = entry.url;
  }
  return el(
    'div',
    { class: 'page' },
    ...pageHeader(
      'Questo sito non si può mostrare qui',
      'Una pagina web non può aprire un\'altra pagina al posto tuo: lo impedisce il browser stesso, e lo stesso vale per qualunque "browser online".',
    ),
    el(
      'div',
      { class: 'card card--spaced' },
      el('p', { class: 'mono' }, entry.url),
      el(
        'p',
        {},
        'Apri ',
        el('strong', {}, host),
        ' in una scheda vera, oppure cerca lo stesso argomento nell\'indice locale.',
      ),
      el(
        'div',
        { class: 'actions' },
        el(
          'a',
          {
            class: 'button',
            href: entry.url,
            target: '_blank',
            rel: 'noreferrer noopener',
          },
          `Apri ${host}`,
        ),
        el(
          'button',
          {
            type: 'button',
            class: 'button',
            onclick: () => navigate(newEntry('search', { query: host, page: 1 })),
          },
          `Cerca “${host}” nell'indice`,
        ),
      ),
    ),
  );
}

// ------------------------------------------------------------------- wiring

function focusOmni() {
  const omni = $('#omni');
  omni.focus();
  omni.select();
}

function wire() {
  $('#new-tab').addEventListener('click', () => openTab(newEntry('newtab')));
  $('#go-back').addEventListener('click', goBack);
  $('#go-forward').addEventListener('click', goForward);
  $('#reload').addEventListener('click', () => render());
  $('#open-settings').addEventListener('click', () => navigate(newEntry('page', { name: 'settings' })));
  $('#theme-toggle').addEventListener('click', () => {
    const order = ['auto', 'light', 'dark'];
    state.settings.theme = order[(order.indexOf(state.settings.theme) + 1) % order.length];
    saveSettings();
    toast(`Tema: ${state.settings.theme === 'auto' ? 'sistema' : state.settings.theme}`);
  });

  const form = $('#omni-form');
  const omni = $('#omni');

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submitAddress(omni.value);
    omni.blur();
  });

  omni.addEventListener('input', () => showSuggestions(omni.value));
  omni.addEventListener('focus', () => omni.select());
  omni.addEventListener('blur', () => setTimeout(hideSuggestions, 120));
  omni.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveSuggestion(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveSuggestion(-1);
    } else if (event.key === 'Escape') {
      hideSuggestions();
    } else if (event.key === 'Enter' && suggestionIndex >= 0) {
      event.preventDefault();
      submitAddress(suggestionItems[suggestionIndex]);
    }
  });

  document.addEventListener('keydown', (event) => {
    const meta = event.ctrlKey || event.metaKey;
    if (!meta) return;
    if (event.key === 'l' || event.key === 'k') {
      event.preventDefault();
      focusOmni();
    } else if (event.key === 't') {
      event.preventDefault();
      openTab(newEntry('newtab'));
      focusOmni();
    } else if (event.key === 'w') {
      event.preventDefault();
      closeTab(currentTab()?.id);
    }
  });
}

function toast(message) {
  const node = el('div', { role: 'status', class: 'toast', text: message });
  document.body.append(node);
  setTimeout(() => node.remove(), 1600);
}

// -------------------------------------------------------------------- start

async function boot() {
  applyTheme();
  wire();
  openTab(entryFromHash() ?? newEntry('newtab'));
  window.addEventListener('hashchange', () => {
    const entry = entryFromHash();
    if (entry) navigate(entry, { replace: true });
  });

  const started = performance.now();
  try {
    const response = await fetch('./data/corpus.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const corpus = await response.json();
    state.corpus = corpus;
    state.index = new MemoryIndex(corpus.documents, {});
    state.indexMs = performance.now() - started;
    const status = $('#index-status');
    status.className = 'status';
    $('#index-status-text').textContent = `indice pronto · ${number(state.index.size)} documenti`;
    renderTabs();
    render();
  } catch (error) {
    const status = $('#index-status');
    status.className = 'status status--error';
    $('#index-status-text').textContent = 'indice non disponibile';
    $('#viewport').replaceChildren(
      el(
        'div',
        { class: 'page' },
        el('h1', {}, 'Non riesco a caricare il corpus'),
        el('p', {}, `Il file data/corpus.json non è raggiungibile (${error.message}).`),
        el('p', { class: 'small' }, 'Senza indice la pagina non può cercare: ricarica, oppure apri l\'app desktop.'),
      ),
    );
  }
}

void boot();
