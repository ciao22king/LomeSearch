import type { EngineStatus, Settings } from '../../shared/types.js';
import {
  button,
  card,
  el,
  heading,
  initPage,
  inputRow,
  lome,
  selectRow,
  toast,
  toggleRow,
} from './common.js';

const { main, settings: initial } = await initPage('settings', 'Impostazioni');
let current: Settings = initial;

main.append(
  heading('Impostazioni', 'Tutto viene salvato in locale, nella cartella dati del browser.'),
);

async function patch(update: Partial<Settings>): Promise<void> {
  current = await lome.settings.update(update);
  toast('Impostazioni salvate');
}

// ------------------------------------------------------------------ ricerca

main.append(
  card(
    'Ricerca',
    'L’indice locale è il motore predefinito: le query non lasciano il computer.',
    selectRow(
      'Motore predefinito',
      'Usato dalla barra degli indirizzi e dalla pagina iniziale.',
      [
        { value: 'local', label: 'LomeSearch (indice locale)' },
        { value: 'duckduckgo', label: 'DuckDuckGo' },
        { value: 'brave', label: 'Brave Search' },
        { value: 'startpage', label: 'Startpage' },
        { value: 'custom', label: 'Personalizzato' },
      ],
      current.searchEngine,
      (value) => patch({ searchEngine: value as Settings['searchEngine'] }),
    ),
    inputRow(
      'URL del motore personalizzato',
      'Usa %s al posto della query. Esempio: https://example.com/search?q=%s',
      current.customSearchUrl,
      'https://example.com/search?q=%s',
      (value) => patch({ customSearchUrl: value }),
      'url',
    ),
    inputRow(
      'Pagina iniziale',
      'Indirizzo aperto con il pulsante Home e all’avvio, se selezionato.',
      current.homepage,
      'lomesearch://newtab',
      (value) => patch({ homepage: value }),
      'url',
    ),
    selectRow(
      'All’avvio',
      'Cosa mostrare quando LomeSearch parte.',
      [
        { value: 'newtab', label: 'Nuova scheda' },
        { value: 'restore', label: 'Riprendi le schede precedenti' },
        { value: 'homepage', label: 'Pagina iniziale' },
      ],
      current.startup,
      (value) => patch({ startup: value as Settings['startup'] }),
    ),
    toggleRow(
      'Suggerimenti dalla cronologia',
      'Completa la barra degli indirizzi con le pagine già visitate.',
      current.suggestFromHistory,
      (value) => patch({ suggestFromHistory: value }),
    ),
    toggleRow(
      'Suggerimenti dal motore',
      'Chiede i completamenti all’indice locale mentre digiti.',
      current.suggestFromEngine,
      (value) => patch({ suggestFromEngine: value }),
    ),
  ),
);

// ------------------------------------------------------------------ aspetto

main.append(
  card(
    'Aspetto',
    null,
    selectRow(
      'Tema',
      'Segue il sistema oppure forza chiaro o scuro.',
      [
        { value: 'system', label: 'Sistema' },
        { value: 'light', label: 'Chiaro' },
        { value: 'dark', label: 'Scuro' },
      ],
      current.theme,
      async (value) => {
        document.documentElement.dataset.theme = value;
        await patch({ theme: value as Settings['theme'] });
      },
    ),
  ),
);

// ------------------------------------------------------------------ privacy

const privacy = current.privacy;
main.append(
  card(
    'Privacy',
    'Le protezioni si applicano a tutte le schede, comprese le estensioni.',
    toggleRow(
      'Blocca tracker e pubblicità',
      'Lista integrata di domini pubblicitari, analytics e fingerprinting.',
      privacy.blockTrackers,
      (value) => patch({ privacy: { ...current.privacy, blockTrackers: value } }),
    ),
    toggleRow(
      'Blocca cookie di terze parti',
      'Rimuove Cookie e Set-Cookie per domini diversi da quello visitato.',
      privacy.blockThirdPartyCookies,
      (value) => patch({ privacy: { ...current.privacy, blockThirdPartyCookies: value } }),
    ),
    toggleRow(
      'HTTPS prima',
      'Prova la versione cifrata e torna a HTTP solo se il sito non la supporta.',
      privacy.httpsFirst,
      (value) => patch({ privacy: { ...current.privacy, httpsFirst: value } }),
    ),
    toggleRow(
      'Invia Do Not Track e Global Privacy Control',
      'Segnala ai siti di non tracciare la navigazione.',
      privacy.sendDoNotTrack,
      (value) => patch({ privacy: { ...current.privacy, sendDoNotTrack: value } }),
    ),
    toggleRow(
      'Protezione dal fingerprinting',
      'Rumore deterministico su canvas, WebGL, audio e dispositivi multimediali.',
      privacy.fingerprintProtection,
      (value) => patch({ privacy: { ...current.privacy, fingerprintProtection: value } }),
    ),
    toggleRow(
      'DNS over HTTPS',
      'Cloudflare DoH. Richiede il riavvio del browser.',
      privacy.dnsOverHttps,
      (value) => patch({ privacy: { ...current.privacy, dnsOverHttps: value } }),
    ),
    toggleRow(
      'Cancella i dati alla chiusura',
      'Cookie, cache e archiviazione locale vengono eliminati quando esci.',
      privacy.clearOnExit,
      (value) => patch({ privacy: { ...current.privacy, clearOnExit: value } }),
    ),
    inputRow(
      'Lista di blocco remota',
      'URL opzionale, un dominio per riga. Si somma alla lista integrata.',
      privacy.remoteBlocklist,
      'https://example.com/trackers.txt',
      (value) => patch({ privacy: { ...current.privacy, remoteBlocklist: value } }),
      'url',
    ),
  ),
);

// ------------------------------------------------------------------- motore

const engineCard = card('Motore di ricerca locale', 'Il processo che indicizza e risponde alle query.');
main.append(engineCard);

let engineStatus: EngineStatus | null = null;

function renderEngine(): void {
  engineCard.textContent = '';
  engineCard.append(
    el('h2', {}, 'Motore di ricerca locale'),
    el('p', { class: 'hint' }, 'Il processo che indicizza e risponde alle query.'),
    el(
      'div',
      { class: 'row' },
      el(
        'div',
        { class: 'label' },
        el('strong', {}, engineStatus?.running ? 'In esecuzione' : 'Fermo'),
        el(
          'small',
          {},
          engineStatus?.running
            ? `${engineStatus.origin} · ${engineStatus.documents.toLocaleString('it-IT')} documenti · ${engineStatus.indexedTerms.toLocaleString('it-IT')} termini`
            : engineStatus?.error ?? 'Avvia il motore per usare l’indice locale.',
        ),
      ),
      el(
        'span',
        { class: `pill ${engineStatus?.running ? '' : 'warn'}` },
        el('span', { class: `dot ${engineStatus?.running ? 'on' : 'off'}` }),
        engineStatus?.running ? 'attivo' : 'fermo',
      ),
    ),
    toggleRow(
      'Avvia con il browser',
      'Se disattivato, LomeSearch si collega a un motore già in esecuzione.',
      current.engine.autoStart,
      (value) => patch({ engine: { ...current.engine, autoStart: value } }),
    ),
    inputRow(
      'Porta',
      'Porta locale del server di ricerca (default 7717).',
      String(current.engine.port),
      '7717',
      async (value) => {
        const port = Number.parseInt(value, 10);
        if (!Number.isFinite(port) || port < 1 || port > 65535) {
          toast('Porta non valida');
          return;
        }
        await patch({ engine: { ...current.engine, port } });
        engineStatus = await lome.engine.restart();
        renderEngine();
      },
      'number',
    ),
    inputRow(
      'Cartella dati',
      'Dove vivono indice, documenti e chiave IndexNow.',
      current.engine.dataDir,
      '',
      (value) => patch({ engine: { ...current.engine, dataDir: value } }),
    ),
    el(
      'div',
      { class: 'row' },
      el(
        'div',
        { class: 'label' },
        el('strong', {}, 'Azioni'),
        el('small', {}, 'Riavvia il motore o apri la cartella dei dati.'),
      ),
      el(
        'div',
        { style: 'display:flex;gap:8px' },
        button('Riavvia', async () => {
          engineStatus = await lome.engine.restart();
          renderEngine();
          toast('Motore riavviato');
        }),
        button('Apri cartella', () => lome.app.openDataDir(), 'small'),
      ),
    ),
  );
}

void lome.engine.status().then((status) => {
  engineStatus = status;
  renderEngine();
});
lome.onEngine((status) => {
  engineStatus = status;
  renderEngine();
});

// ---------------------------------------------------------------- cronologia

main.append(
  card(
    'Cronologia',
    'Registrata solo in locale, mai inviata altrove.',
    toggleRow(
      'Registra la cronologia',
      'Se disattivato, le nuove visite non vengono salvate.',
      current.history.enabled,
      (value) => patch({ history: { ...current.history, enabled: value } }),
    ),
    selectRow(
      'Conservazione',
      'Le voci più vecchie vengono rimosse automaticamente.',
      [
        { value: '7', label: '7 giorni' },
        { value: '30', label: '30 giorni' },
        { value: '90', label: '90 giorni' },
        { value: '365', label: '1 anno' },
        { value: '0', label: 'Per sempre' },
      ],
      String(current.history.retentionDays),
      (value) => patch({ history: { ...current.history, retentionDays: Number(value) } }),
    ),
  ),
);

// ----------------------------------------------------------------- download

main.append(
  card(
    'Download',
    null,
    toggleRow(
      'Chiedi dove salvare',
      'Se disattivato, i file vanno nella cartella indicata.',
      current.downloads.askWhereToSave,
      (value) => patch({ downloads: { ...current.downloads, askWhereToSave: value } }),
    ),
    inputRow(
      'Cartella dei download',
      'Percorso assoluto sul computer.',
      current.downloads.directory,
      '',
      (value) => patch({ downloads: { ...current.downloads, directory: value } }),
    ),
  ),
);

// --------------------------------------------------------------- estensioni

main.append(
  card(
    'Estensioni',
    'Le estensioni Chrome supportate vengono caricate da una cartella locale.',
    toggleRow(
      'Abilita le estensioni',
      'La modifica ha effetto al prossimo avvio.',
      current.extensions.enabled,
      (value) => patch({ extensions: { ...current.extensions, enabled: value } }),
    ),
    el(
      'div',
      { class: 'row' },
      el(
        'div',
        { class: 'label' },
        el('strong', {}, 'Gestisci estensioni'),
        el('small', {}, 'Carica una cartella non pacchettizzata o rimuovi quelle esistenti.'),
      ),
      el('a', { class: 'btn', href: 'lomesearch://extensions' }, 'Apri'),
    ),
  ),
);

// --------------------------------------------------------------------- dati

main.append(
  card(
    'Dati locali',
    'Nessun dato viene sincronizzato o inviato a server esterni.',
    el(
      'div',
      { class: 'row' },
      el(
        'div',
        { class: 'label' },
        el('strong', {}, 'Cancella cookie e cache'),
        el('small', {}, 'Chiude tutte le sessioni dei siti.'),
      ),
      button('Cancella', async () => {
        await lome.app.clearData({ cookies: true, cache: true, localStorage: true });
        toast('Cookie e cache cancellati');
      }, 'danger'),
    ),
    el(
      'div',
      { class: 'row' },
      el(
        'div',
        { class: 'label' },
        el('strong', {}, 'Cancella la cronologia'),
        el('small', {}, 'Rimuove tutte le voci salvate.'),
      ),
      button('Cancella', async () => {
        await lome.history.clear();
        toast('Cronologia cancellata');
      }, 'danger'),
    ),
  ),
);
