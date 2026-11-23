import type { HistoryEntry } from '../../shared/types.js';
import {
  button,
  card,
  clear,
  dayLabel,
  el,
  heading,
  initPage,
  lome,
  shorten,
  timeAgo,
  toast,
} from './common.js';

const { main } = await initPage('history', 'History');

const search = el('input', {
  type: 'search',
  placeholder: 'Filter by title or address',
  'aria-label': 'Filter history',
});
const listCard = card(null, null);
const countEl = el('p', { class: 'lede' });

main.append(
  heading('History', 'Every page you visited, only on this computer.'),
  el(
    'div',
    { style: 'display:flex;gap:10px;align-items:center;margin-bottom:18px' },
    search,
    button('Clear all', async () => {
      if (!window.confirm('Clear the entire history?')) return;
      await lome.history.clear();
      toast('History cleared');
      await render();
    }, 'danger'),
  ),
  countEl,
  listCard,
);

let entries: HistoryEntry[] = [];

async function render(): Promise<void> {
  entries = await lome.history.list(search.value.trim(), 500);
  countEl.textContent =
    entries.length === 0
      ? ''
      : `${entries.length.toLocaleString('en-US')} ${entries.length === 1 ? 'entry' : 'entries'}${search.value.trim() ? ' matching' : ''}`;
  clear(listCard);

  if (entries.length === 0) {
    listCard.append(
      el(
        'div',
        { class: 'empty' },
        el('strong', {}, search.value.trim() ? 'No results' : 'History is empty'),
        search.value.trim()
          ? 'Try another term.'
          : 'Pages you visit will appear here.',
      ),
    );
    return;
  }

  let currentDay = '';
  const list = el('ul', { class: 'list' });
  for (const entry of entries) {
    const day = dayLabel(entry.visitedAt);
    if (day !== currentDay) {
      currentDay = day;
      list.append(
        el(
          'li',
          { style: 'padding:14px 0 6px;font-size:12px;color:var(--muted);font-weight:600;text-transform:capitalize' },
          day,
        ),
      );
    }
    list.append(
      el(
        'li',
        { class: 'item' },
        el(
          'a',
          { class: 'main', href: entry.url },
          el('div', { class: 'title' }, entry.title || entry.url),
          el('div', { class: 'url' }, shorten(entry.url, 90)),
        ),
        el('span', { class: 'when', title: new Date(entry.visitedAt).toLocaleString('en-US') }, timeAgo(entry.visitedAt)),
        el(
          'div',
          { class: 'actions' },
          button('Open', () => lome.navigate(entry.url), 'small'),
          button('Delete', async () => {
            await lome.history.remove(entry.id);
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

lome.onHistory(() => {
  void render();
});

await render();
