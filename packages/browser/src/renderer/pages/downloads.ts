import type { DownloadState } from '../../shared/types.js';
import {
  button,
  card,
  clear,
  el,
  formatBytes,
  heading,
  initPage,
  lome,
  shorten,
  toast,
} from './common.js';

const { main } = await initPage('downloads', 'Downloads');

const listCard = card(null, null);

main.append(
  heading('Downloads', 'Files stay on this computer; no external service receives them.'),
  el(
    'div',
    { style: 'display:flex;gap:10px;margin-bottom:18px' },
    button('Clear completed', async () => {
      await lome.downloads.clear();
      toast('List cleared');
    }, 'small'),
    button('Open downloads folder', () => lome.app.openDownloadsDir(), 'small'),
  ),
  listCard,
);

function label(item: DownloadState): string {
  if (item.state === 'progressing') {
    return item.total > 0
      ? `${Math.round((item.received / item.total) * 100)}% of ${formatBytes(item.total)}`
      : `${formatBytes(item.received)} downloaded`;
  }
  if (item.state === 'completed') return `completed · ${formatBytes(item.total || item.received)}`;
  if (item.state === 'cancelled') return 'Cancelled';
  return 'Interrupted';
}

function render(items: DownloadState[]): void {
  clear(listCard);
  if (items.length === 0) {
    listCard.append(
      el(
        'div',
        { class: 'empty' },
        el('strong', {}, 'No downloads'),
        'Downloaded files will appear here.',
      ),
    );
    return;
  }

  const list = el('ul', { class: 'list' });
  for (const item of items) {
    const actions = el('div', { class: 'actions' });
    if (item.state === 'progressing') {
      actions.append(
        button('Pause', async () => {
          await lome.downloads.pause(item.id);
        }, 'small'),
        button('Cancel', async () => {
          await lome.downloads.cancel(item.id);
        }, 'small'),
      );
    }
    if (item.state === 'completed') {
      actions.append(
        button('Open', () => lome.downloads.open(item.id), 'small'),
        button('Show', () => lome.downloads.show(item.id), 'small'),
      );
    }
    if (item.state === 'interrupted') {
      actions.append(button('Show', () => lome.downloads.show(item.id), 'small'));
    }

    const progress = el('div', { class: 'progress' });
    const ratio =
      item.total > 0 ? Math.min(1, item.received / item.total) : item.state === 'completed' ? 1 : 0.1;
    const bar = el('span', { style: `width:${Math.round(ratio * 100)}%` });
    progress.append(bar);

    list.append(
      el(
        'li',
        { class: 'item', style: 'align-items:flex-start' },
        el(
          'div',
          { class: 'main' },
          el('div', { class: 'title' }, item.filename),
          el('div', { class: 'url' }, shorten(item.savePath || item.url, 100)),
          el('div', { style: 'display:flex;align-items:center;gap:10px;margin-top:6px' }, progress),
          el('div', { class: 'url' }, label(item)),
        ),
        actions,
      ),
    );
  }
  listCard.append(list);
}

lome.onDownloads((items) => render(items));
render(await lome.downloads.list());
