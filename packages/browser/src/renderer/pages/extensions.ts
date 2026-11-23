import type { ExtensionInfo } from '../../shared/types.js';
import {
  button,
  card,
  clear,
  el,
  heading,
  initPage,
  lome,
  shorten,
  toast,
} from './common.js';

const { main } = await initPage('extensions', 'Extensions');

const listCard = card(null, null);

main.append(
  heading('Extensions', 'LomeSearch loads unpacked Chrome extensions from a local folder.'),
  card(
    'How it works',
    null,
    el(
      'p',
      { class: 'small muted', style: 'margin:0 0 10px' },
      'Electron implements a subset of the Chrome APIs: content scripts, ad blockers, readers, password managers and many interface extensions work. Chrome Web Store only APIs and some privileged APIs are not available.',
    ),
    el(
      'p',
      { class: 'small muted', style: 'margin:0' },
      'To install: download or clone the extension, pick its folder (the one with manifest.json) and load it here. Extensions stay disabled in private windows.',
    ),
  ),
  el(
    'div',
    { style: 'display:flex;gap:10px;margin-bottom:18px' },
    button('Load unpacked extension', async () => {
      const items = await lome.extensions.load();
      render(items);
      toast('Extension loaded');
    }, 'primary'),
  ),
  listCard,
);

function render(items: ExtensionInfo[]): void {
  clear(listCard);
  if (items.length === 0) {
    listCard.append(
      el(
        'div',
        { class: 'empty' },
        el('strong', {}, 'No extension loaded'),
        'Compatible extensions appear here.',
      ),
    );
    return;
  }

  const list = el('ul', { class: 'list' });
  for (const extension of items) {
    const status = extension.error
      ? el('span', { class: 'pill warn' }, extension.error)
      : el('span', { class: 'pill' }, 'active');

    const actions = el('div', { class: 'actions' });
    if (extension.enabled) {
      actions.append(
        button('Disable', async () => {
          render(await lome.extensions.toggle(extension.path, false));
        }, 'small'),
      );
    } else if (!extension.error?.includes('not found')) {
      actions.append(
        button('Enable', async () => {
          render(await lome.extensions.toggle(extension.path, true));
        }, 'small'),
      );
    }
    actions.append(
      button('Folder', () => lome.extensions.reveal(extension.path), 'small'),
      button('Remove', async () => {
        render(await lome.extensions.remove(extension.path));
        toast('Extension removed');
      }, 'small'),
    );

    list.append(
      el(
        'li',
        { class: 'item' },
        el(
          'div',
          { class: 'main' },
          el(
            'div',
            { style: 'display:flex;align-items:center;gap:10px' },
            el('div', { class: 'title' }, extension.name),
            extension.version ? el('span', { class: 'small muted' }, `v${extension.version}`) : null,
            status,
          ),
          el('div', { class: 'url', title: extension.path }, shorten(extension.path, 96)),
        ),
        actions,
      ),
    );
  }
  listCard.append(list);
}

lome.onExtensions((items) => render(items));
render(await lome.extensions.list());
