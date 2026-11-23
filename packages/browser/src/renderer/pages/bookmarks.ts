import type { Bookmark } from '../../shared/types.js';
import {
  button,
  card,
  clear,
  el,
  heading,
  initPage,
  lome,
  shorten,
  timeAgo,
  toast,
} from './common.js';

const { main } = await initPage('bookmarks', 'Preferiti');

const search = el('input', {
  type: 'search',
  placeholder: 'Filtra i preferiti',
  'aria-label': 'Filtra i preferiti',
});
const listCard = card(null, null);
const addButton = button('Aggiungi la pagina corrente', async () => {
  const state = await lome.app.state();
  const tab = state.tabs.find((item) => item.id === state.activeTabId);
  if (!tab || !/^https?:/i.test(tab.url)) {
    toast('Apri una pagina web per salvarla');
    return;
  }
  await lome.bookmarks.add(tab.url, tab.title);
  toast('Preferito aggiunto');
  await render();
}, 'primary');

main.append(
  heading('Preferiti', 'Pagine salvate nel profilo locale.'),
  el(
    'div',
    { style: 'display:flex;gap:10px;align-items:center;margin-bottom:18px' },
    search,
    addButton,
  ),
  listCard,
);

let bookmarks: Bookmark[] = [];

async function render(): Promise<void> {
  bookmarks = await lome.bookmarks.list();
  const needle = search.value.trim().toLowerCase();
  const filtered = needle
    ? bookmarks.filter(
        (bookmark) =>
          bookmark.title.toLowerCase().includes(needle) || bookmark.url.toLowerCase().includes(needle),
      )
    : bookmarks;

  clear(listCard);
  if (filtered.length === 0) {
    listCard.append(
      el(
        'div',
        { class: 'empty' },
        el('strong', {}, needle ? 'Nessun preferito corrisponde' : 'Nessun preferito'),
        needle ? 'Prova con un altro termine.' : 'Usa la stella nella barra degli indirizzi o Ctrl+D.',
      ),
    );
    return;
  }

  const list = el('ul', { class: 'list' });
  for (const bookmark of filtered) {
    list.append(
      el(
        'li',
        { class: 'item' },
        el(
          'a',
          { class: 'main', href: bookmark.url },
          el('div', { class: 'title' }, bookmark.title || bookmark.url),
          el('div', { class: 'url' }, shorten(bookmark.url, 90)),
        ),
        el('span', { class: 'when' }, timeAgo(bookmark.createdAt)),
        el(
          'div',
          { class: 'actions' },
          button('Apri', () => lome.navigate(bookmark.url), 'small'),
          button('Copia', async () => {
            await lome.copy(bookmark.url);
            toast('Indirizzo copiato');
          }, 'small'),
          button('Rimuovi', async () => {
            await lome.bookmarks.remove(bookmark.url);
            await render();
          }, 'small'),
        ),
      ),
    );
  }
  listCard.append(list);
}

search.addEventListener('input', () => {
  void render();
});

await render();
