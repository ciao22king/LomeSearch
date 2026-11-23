import { button, card, el, initPage, lome, shorten, timeAgo, toast } from './common.js';

const { main } = await initPage('newtab', 'Nuova scheda');

const searchInput = el('input', {
  type: 'search',
  placeholder: 'Cerca nel web o nell’indice locale',
  'aria-label': 'Cerca',
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
  el('button', { class: 'btn primary', type: 'submit' }, 'Cerca'),
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
  'Cerca solo nell’indice locale',
);

main.append(
  el(
    'section',
    { class: 'hero' },
    el('div', { class: 'mark' }, 'Lome', el('span', {}, 'Search')),
    form,
    el('div', { class: 'alt' }, 'Le query restano su questa macchina. ', localLink),
  ),
);

const statsGrid = el('div', { class: 'stats-grid' });
const privacyCard = card(null, null);
const indexCard = card(
  'Indice vuoto',
  'Il motore locale è attivo ma non ha ancora documenti. Indicizza un sito per iniziare.',
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
    button('Copia comandi', async () => {
      await lome.copy('npm run cli -- crawl https://example.com --max-depth 2');
      toast('Comando copiato');
    }, 'small'),
    el(
      'a',
      { class: 'btn small', href: 'http://127.0.0.1:7717/', target: '_self' },
      'Apri la pagina del motore',
    ),
    el('a', { class: 'btn small', href: 'lomesearch://settings' }, 'Impostazioni del motore'),
  ),
);
const shortcutsCard = card('Scorciatoie', 'Le pagine che hai salvato, pronte da aprire.');
const recentCard = card('Riprese di recente', 'La cronologia resta nel profilo locale.');

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
    [engine.documents.toLocaleString('it-IT'), 'documenti indicizzati'],
    [engine.indexedTerms.toLocaleString('it-IT'), 'termini nell’indice'],
    [report.summary.blockedSession.toLocaleString('it-IT'), 'richieste bloccate ora'],
    [report.summary.blocklistSize.toLocaleString('it-IT'), 'regole nella lista'],
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
        el('strong', {}, engine.running ? 'Motore locale attivo' : 'Motore locale non attivo'),
        el(
          'small',
          {},
          engine.running
            ? `${engine.origin} · ${engine.documents.toLocaleString('it-IT')} documenti · versione ${engine.version || '1.0.0'}`
            : engine.error ?? 'Avvia il motore dalle impostazioni.',
        ),
      ),
      el(
        'span',
        { class: `pill ${engine.running ? '' : 'warn'}` },
        el('span', { class: `dot ${engine.running ? 'on' : 'off'}` }),
        engine.running ? 'attivo' : 'fermo',
      ),
    ),
    el(
      'div',
      { class: 'row' },
      el(
        'div',
        { class: 'label' },
        el('strong', {}, 'Tracciamento'),
        el(
          'small',
          {},
          `Bloccate ${report.summary.blockedTotal.toLocaleString('it-IT')} richieste in totale. Nessuna query viene registrata.`,
        ),
      ),
      el(
        'a',
        { class: 'btn small', href: 'lomesearch://privacy' },
        'Report privacy',
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
          ['Cronologia', 'lomesearch://history'],
          ['Preferiti', 'lomesearch://bookmarks'],
          ['Download', 'lomesearch://downloads'],
          ['Estensioni', 'lomesearch://extensions'],
          ['Privacy', 'lomesearch://privacy'],
          ['Impostazioni', 'lomesearch://settings'],
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
    recentCard.append(el('div', { class: 'empty' }, el('strong', {}, 'Nessuna pagina visitata'), 'La cronologia è vuota.'));
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
