import { button, card, el, initPage, lome, shorten, timeAgo, toast } from './common.js';

const { main, settings } = await initPage('newtab', 'New tab');

const searchInput = el('input', {
  type: 'search',
  placeholder: 'Search the web or the local index',
  'aria-label': 'Search',
  autofocus: true,
});

const form = el(
  'form',
  {
    onsubmit: (event: Event) => {
      event.preventDefault();
      const query = searchInput.value.trim();
      if (query) void lome.search(query);
    },
  },
  searchInput,
  el('button', { class: 'btn primary', type: 'submit' }, 'Search'),
);

const localLink = el(
  'button',
  {
    type: 'button',
    onclick: () => {
      const query = searchInput.value.trim();
      if (query) void lome.search(query, true);
    },
  },
  'Search the local index only',
);

main.append(
  el(
    'section',
    { class: 'hero' },
    el('div', { class: 'mark' }, 'Lome', el('span', {}, 'Search')),
    form,
    el(
      'div',
      { class: 'alt' },
      settings.searchEngine === 'hybrid'
        ? 'Local results first, the fallback engine is one click away. '
        : 'Queries stay on this machine. ',
      localLink,
    ),
  ),
);

const statsGrid = el('div', { class: 'stats-grid' });
const privacyCard = card(null, null);
const indexCard = card(
  'Empty index',
  'The local engine is running but has no documents yet. Index a site to start.',
);
indexCard.append(
  el(
    'pre',
    {},
    'npm run cli -- crawl https://example.com --max-depth 2\nnpm run cli -- search "parola chiave"',
  ),
  el(
    'div',
    { style: 'display:flex;gap:8px;flex-wrap:wrap' },
    button('Copy commands', async () => {
      await lome.copy('npm run cli -- crawl https://example.com --max-depth 2');
      toast('Command copied');
    }, 'small'),
    el('a', { class: 'btn small', href: 'lomesearch://search' }, 'Open search'),
    el('a', { class: 'btn small', href: 'lomesearch://settings' }, 'Engine settings'),
  ),
);
const shortcutsCard = card('Shortcuts', 'The pages you saved, ready to open.');
const recentCard = card('Recently visited', 'History stays in the local profile.');

main.append(
  statsGrid,
  el('div', { style: 'height:18px' }),
  indexCard,
  privacyCard,
  shortcutsCard,
  recentCard,
);

async function renderStats(): Promise<void> {
  const [engine, report] = await Promise.all([lome.engine.status(), lome.privacy.report()]);
  statsGrid.textContent = '';
  const items: Array<[string, string]> = [
    [engine.documents.toLocaleString('en-US'), 'documents indexed'],
    [engine.indexedTerms.toLocaleString('en-US'), 'terms in the index'],
    [report.summary.blockedSession.toLocaleString('en-US'), 'requests blocked now'],
    [report.summary.blocklistSize.toLocaleString('en-US'), 'rules in the list'],
  ];
  for (const [value, name] of items) {
    statsGrid.append(el('div', { class: 'stat' }, el('div', { class: 'value' }, value), el('div', { class: 'name' }, name)));
  }
  indexCard.hidden = engine.documents > 0;

  privacyCard.textContent = '';
  privacyCard.append(
    el(
      'div',
      { class: 'row' },
      el(
        'div',
        { class: 'label' },
        el('strong', {}, engine.running ? 'Local engine running' : 'Local engine stopped'),
        el(
          'small',
          {},
          engine.running
            ? `${engine.origin} · ${engine.documents.toLocaleString('en-US')} documents · version ${engine.version || '1.1.0'}`
            : engine.error ?? 'Start the engine from settings.',
        ),
      ),
      el(
        'span',
        { class: `pill ${engine.running ? '' : 'warn'}` },
        el('span', { class: `dot ${engine.running ? 'on' : 'off'}` }),
        engine.running ? 'running' : 'stopped',
      ),
    ),
    el(
      'div',
      { class: 'row' },
      el(
        'div',
        { class: 'label' },
        el('strong', {}, 'Tracking'),
        el(
          'small',
          {},
          `Blocked ${report.summary.blockedTotal.toLocaleString('en-US')} requests in total. No query is logged.`,
        ),
      ),
      el(
        'a',
        { class: 'btn small', href: 'lomesearch://privacy' },
        'Privacy report',
      ),
    ),
  );
}

async function renderShortcuts(): Promise<void> {
  const bookmarks = (await lome.bookmarks.list()).slice(0, 8);
  shortcutsCard.textContent = '';
  if (bookmarks.length === 0) {
    shortcutsCard.append(
      el(
        'div',
        { class: 'shortcuts' },
        ...[
          ['History', 'lomesearch://history'],
          ['Bookmarks', 'lomesearch://bookmarks'],
          ['Downloads', 'lomesearch://downloads'],
          ['Extensions', 'lomesearch://extensions'],
          ['Privacy', 'lomesearch://privacy'],
          ['Settings', 'lomesearch://settings'],
        ].map(([label, href]) =>
          el(
            'a',
            { class: 'shortcut', href: href ?? '#' },
            el('span', { class: 'letter' }, (label ?? '?').slice(0, 1)),
            el('span', { class: 'name' }, label ?? ''),
          ),
        ),
      ),
    );
    return;
  }
  shortcutsCard.append(
    el(
      'div',
      { class: 'shortcuts' },
      ...bookmarks.map((bookmark) =>
        el(
          'a',
          { class: 'shortcut', href: bookmark.url, title: bookmark.url },
          el('span', { class: 'letter' }, (bookmark.title || bookmark.url).trim().slice(0, 1).toUpperCase()),
          el('span', { class: 'name' }, bookmark.title || shorten(bookmark.url, 30)),
        ),
      ),
    ),
  );
}

async function renderRecent(): Promise<void> {
  const entries = (await lome.history.list('', 6)).filter((entry) => !entry.url.startsWith('lomesearch://'));
  recentCard.textContent = '';
  if (entries.length === 0) {
    recentCard.append(el('div', { class: 'empty' }, el('strong', {}, 'No pages visited'), 'History is empty.'));
    return;
  }
  const list = el('ul', { class: 'list' });
  for (const entry of entries) {
    list.append(
      el(
        'li',
        { class: 'item' },
        el(
          'a',
          { class: 'main', href: entry.url },
          el('div', { class: 'title' }, entry.title || entry.url),
          el('div', { class: 'url' }, shorten(entry.url)),
        ),
        el('span', { class: 'when' }, timeAgo(entry.visitedAt)),
      ),
    );
  }
  recentCard.append(list);
}

await Promise.all([renderStats(), renderShortcuts(), renderRecent()]);
lome.onEngine(() => void renderStats());
lome.onPrivacy(() => {
  void renderStats();
});
