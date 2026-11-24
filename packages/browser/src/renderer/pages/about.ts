import { button, card, el, heading, initPage, lome } from './common.js';

const { main } = await initPage('about', 'About');

const [info, engine] = await Promise.all([lome.app.info(), lome.engine.status()]);

function infoRow(label: string, value: string): HTMLElement {
  return el(
    'div',
    { class: 'row' },
    el('div', { class: 'label' }, el('strong', {}, label)),
    el('span', { class: 'small muted' }, value),
  );
}

main.append(
  heading('About', 'LomeSearch is a browser and a search engine that run only on your machine.'),
  card(
    'Version',
    null,
    infoRow('LomeSearch', info.appVersion),
    infoRow('Search engine', info.engineVersion || engine.version || '1.1.0'),
    infoRow('Electron', info.electron),
    infoRow('Chromium', info.chrome),
    infoRow('Node.js', info.node),
    infoRow('V8', info.v8),
    infoRow('Platform', `${info.platform} ${info.arch}`),
    infoRow('Data folder', info.userData),
  ),
  card(
    'Local search engine',
    null,
    el(
      'div',
      { class: 'row' },
      el(
        'div',
        { class: 'label' },
        el('strong', {}, engine.running ? 'Running' : 'Stopped'),
        el(
          'small',
          {},
          engine.running
            ? `${engine.origin} · ${engine.documents.toLocaleString('en-US')} documents · ${engine.indexedTerms.toLocaleString('en-US')} terms`
            : engine.error ?? 'Start the engine from the settings page.',
        ),
      ),
      el(
        'span',
        { class: `pill ${engine.running ? '' : 'warn'}` },
        el('span', { class: `dot ${engine.running ? 'on' : 'off'}` }),
        engine.running ? 'active' : 'stopped',
      ),
    ),
    el(
      'div',
      { class: 'row' },
      el(
        'div',
        { class: 'label' },
        el('strong', {}, 'Index and privacy'),
        el('small', {}, 'BM25 over immutable segments, a robots.txt aware crawler, IndexNow on both sides.'),
      ),
      el('a', { class: 'btn small', href: 'lomesearch://privacy' }, 'Privacy report'),
    ),
    el(
      'div',
      { class: 'row' },
      el(
        'div',
        { class: 'label' },
        el('strong', {}, 'Licence'),
        el('small', {}, 'Apache License 2.0. The code can be inspected and changed.'),
      ),
      el(
        'div',
        { style: 'display:flex;gap:8px' },
        button('Open repository', () => lome.openExternal('https://github.com/ciao22king/LomeSearch'), 'small'),
        el('a', { class: 'btn small', href: 'lomesearch://legal' }, 'Legal'),
      ),
    ),
    el(
      'div',
      { class: 'row' },
      el(
        'div',
        { class: 'label' },
        el('strong', {}, 'Personal project'),
        el('small', {}, 'Made by one person for personal use, not a company or office product.'),
      ),
    ),
  ),
  card(
    'Useful shortcuts',
    null,
    el(
      'div',
      { class: 'rows' },
      infoRow('New tab', 'Ctrl+T'),
      infoRow('Private window', 'Ctrl+Shift+N'),
      infoRow('Address bar', 'Ctrl+L'),
      infoRow('Find in page', 'Ctrl+F'),
      infoRow('History', 'Ctrl+H'),
      infoRow('Downloads', 'Ctrl+J'),
      infoRow('Bookmarks', 'Ctrl+Shift+O'),
      infoRow('Settings', 'Ctrl+,'),
      infoRow('Developer tools', 'Ctrl+Shift+I'),
    ),
  ),
);
