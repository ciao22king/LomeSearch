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

const { main } = await initPage('extensions', 'Estensioni');

const listCard = card(null, null);

main.append(
  heading('Estensioni', 'LomeSearch carica estensioni Chrome non pacchettizzate da una cartella locale.'),
  card(
    'Come funziona',
    null,
    el(
      'p',
      { class: 'small muted', style: 'margin:0 0 10px' },
      'Electron implementa un sottoinsieme delle API di Chrome: content script, blocca-annunci, lettori, gestori di password e molte estensioni di interfaccia funzionano. Le API esclusive del Chrome Web Store e alcune API privileged non sono disponibili.',
    ),
    el(
      'p',
      { class: 'small muted', style: 'margin:0' },
      'Per installare: scarica o clona l’estensione, apri la sua cartella (quella con manifest.json) e caricala qui. Le estensioni restano disattivate nelle finestre private.',
    ),
  ),
  el(
    'div',
    { style: 'display:flex;gap:10px;margin-bottom:18px' },
    button('Carica estensione non pacchettizzata', async () => {
      const items = await lome.extensions.load();
      render(items);
      toast('Estensione caricata');
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
        el('strong', {}, 'Nessuna estensione caricata'),
        'Le estensioni compatibili compaiono qui.',
      ),
    );
    return;
  }

  const list = el('ul', { class: 'list' });
  for (const extension of items) {
    const status = extension.error
      ? el('span', { class: 'pill warn' }, extension.error)
      : el('span', { class: 'pill' }, 'attiva');

    const actions = el('div', { class: 'actions' });
    if (extension.enabled) {
      actions.append(
        button('Disattiva', async () => {
          render(await lome.extensions.toggle(extension.path, false));
        }, 'small'),
      );
    } else if (!extension.error?.includes('non trovata')) {
      actions.append(
        button('Attiva', async () => {
          render(await lome.extensions.toggle(extension.path, true));
        }, 'small'),
      );
    }
    actions.append(
      button('Cartella', () => lome.extensions.reveal(extension.path), 'small'),
      button('Rimuovi', async () => {
        render(await lome.extensions.remove(extension.path));
        toast('Estensione rimossa');
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
