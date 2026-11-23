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

const { main } = await initPage('downloads', 'Download');

const listCard = card(null, null);

main.append(
  heading('Download', 'I file restano sul computer; nessun servizio esterno li riceve.'),
  el(
    'div',
    { style: 'display:flex;gap:10px;margin-bottom:18px' },
    button('Cancella completati', async () => {
      await lome.downloads.clear();
      toast('Elenco ripulito');
    }, 'small'),
    button('Apri cartella download', () => lome.app.openDownloadsDir(), 'small'),
  ),
  listCard,
);

function label(item: DownloadState): string {
  if (item.state === 'progressing') {
    return item.total > 0
      ? `${Math.round((item.received / item.total) * 100)}% di ${formatBytes(item.total)}`
      : `${formatBytes(item.received)} scaricati`;
  }
  if (item.state === 'completed') return `completato · ${formatBytes(item.total || item.received)}`;
  if (item.state === 'cancelled') return 'Annullato';
  return 'Interrotto';
}

function render(items: DownloadState[]): void {
  clear(listCard);
  if (items.length === 0) {
    listCard.append(
      el(
        'div',
        { class: 'empty' },
        el('strong', {}, 'Nessun download'),
        'I file scaricati compariranno qui.',
      ),
    );
    return;
  }

  const list = el('ul', { class: 'list' });
  for (const item of items) {
    const actions = el('div', { class: 'actions' });
    if (item.state === 'progressing') {
      actions.append(
        button('Pausa', async () => {
          await lome.downloads.pause(item.id);
        }, 'small'),
        button('Annulla', async () => {
          await lome.downloads.cancel(item.id);
        }, 'small'),
      );
    }
    if (item.state === 'completed') {
      actions.append(
        button('Apri', () => lome.downloads.open(item.id), 'small'),
        button('Mostra', () => lome.downloads.show(item.id), 'small'),
      );
    }
    if (item.state === 'interrupted') {
      actions.append(button('Mostra', () => lome.downloads.show(item.id), 'small'));
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
