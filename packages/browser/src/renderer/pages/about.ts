import {
  button,
  card,
  el,
  heading,
  initPage,
  lome,
} from './common.js';

const { main } = await initPage('about', 'Informazioni');

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
  heading('Informazioni', 'LomeSearch è un browser e un motore di ricerca che lavorano solo in locale.'),
  card(
    'Versione',
    null,
    infoRow('LomeSearch', info.appVersion),
    infoRow('Motore di ricerca', info.engineVersion || engine.version || '1.0.0'),
    infoRow('Electron', info.electron),
    infoRow('Chromium', info.chrome),
    infoRow('Node.js', info.node),
    infoRow('V8', info.v8),
    infoRow('Piattaforma', `${info.platform} ${info.arch}`),
    infoRow('Cartella dati', info.userData),
  ),
  card(
    'Motore di ricerca locale',
    null,
    el(
      'div',
      { class: 'row' },
      el(
        'div',
        { class: 'label' },
        el('strong', {}, engine.running ? 'In esecuzione' : 'Fermo'),
        el(
          'small',
          {},
          engine.running
            ? `${engine.origin} · ${engine.documents.toLocaleString('it-IT')} documenti · ${engine.indexedTerms.toLocaleString('it-IT')} termini`
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
        el('strong', {}, 'Indice e privacy'),
        el('small', {}, 'BM25 su segmenti immutabili, crawler con robots.txt, IndexNow lato server e client.'),
      ),
      el('a', { class: 'btn small', href: 'lomesearch://privacy' }, 'Report privacy'),
    ),
    el(
      'div',
      { class: 'row' },
      el(
        'div',
        { class: 'label' },
        el('strong', {}, 'Licenza'),
        el('small', {}, 'Apache License 2.0. Il codice è ispezionabile e modificabile.'),
      ),
      button('Apri il repository', () => lome.openExternal('https://github.com/ciao22king/LomeSearch'), 'small'),
    ),
  ),
  card(
    'Scorciatoie utili',
    null,
    el(
      'div',
      { class: 'rows' },
      infoRow('Nuova scheda', 'Ctrl+T'),
      infoRow('Finestra privata', 'Ctrl+Shift+N'),
      infoRow('Barra degli indirizzi', 'Ctrl+L'),
      infoRow('Trova nella pagina', 'Ctrl+F'),
      infoRow('Cronologia', 'Ctrl+H'),
      infoRow('Download', 'Ctrl+J'),
      infoRow('Preferiti', 'Ctrl+Shift+O'),
      infoRow('Impostazioni', 'Ctrl+, '),
      infoRow('Strumenti per sviluppatori', 'Ctrl+Shift+I'),
    ),
  ),
);
