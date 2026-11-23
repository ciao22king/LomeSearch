import type { PrivacyReport, PrivacySummary, Settings } from '../../shared/types.js';
import {
  button,
  card,
  clear,
  el,
  heading,
  initPage,
  lome,
  toast,
  toggleRow,
} from './common.js';

const { main, settings: initial } = await initPage('privacy', 'Privacy');
let current: Settings = initial;
let report: PrivacyReport | null = null;

const statsGrid = el('div', { class: 'stats-grid' });
const domainsCard = card('Domini più bloccati', 'Conteggi aggregati, senza cronologia delle singole richieste.');
const exceptionsCard = card('Eccezioni per sito', 'Disattiva il blocco dei tracker su un dominio specifico.');
const settingsCard = card('Protezioni', null);
const dataCard = card('Dati locali', null);

main.append(
  heading(
    'Privacy',
    'LomeSearch non ha account, non sincronizza nulla e non registra le query. Questa pagina mostra cosa viene bloccato e dove vivono i dati.',
  ),
  statsGrid,
  el('div', { style: 'height:18px' }),
  domainsCard,
  exceptionsCard,
  settingsCard,
  dataCard,
);

async function patchPrivacy(patch: Partial<Settings['privacy']>): Promise<void> {
  current = await lome.settings.update({ privacy: { ...current.privacy, ...patch } });
  toast('Protezione aggiornata');
  await refresh();
}

function renderStats(summary: PrivacySummary): void {
  clear(statsGrid);
  const values: Array<[string, string]> = [
    [summary.blockedSession.toLocaleString('it-IT'), 'bloccate in questa sessione'],
    [summary.blockedTotal.toLocaleString('it-IT'), 'bloccate in totale'],
    [summary.blocklistSize.toLocaleString('it-IT'), 'regole nella lista'],
    [String(summary.topDomains.length), 'domini osservati'],
  ];
  for (const [value, name] of values) {
    statsGrid.append(
      el('div', { class: 'stat' }, el('div', { class: 'value' }, value), el('div', { class: 'name' }, name)),
    );
  }
}

function renderDomains(summary: PrivacySummary): void {
  clear(domainsCard);
  domainsCard.append(
    el('h2', {}, 'Domini più bloccati'),
    el('p', { class: 'hint' }, 'Conteggi aggregati, senza cronologia delle singole richieste.'),
  );
  if (summary.topDomains.length === 0) {
    domainsCard.append(
      el('div', { class: 'empty' }, el('strong', {}, 'Nessun tracker bloccato finora'), 'Naviga un po’ e torna qui.'),
    );
    return;
  }
  const table = el('table', {});
  table.append(
    el('thead', {}, el('tr', {}, el('th', {}, 'Dominio'), el('th', { class: 'num' }, 'Richieste'))),
  );
  const tbody = el('tbody', {});
  for (const entry of summary.topDomains) {
    tbody.append(
      el('tr', {}, el('td', {}, entry.domain), el('td', { class: 'num' }, entry.count.toLocaleString('it-IT'))),
    );
  }
  table.append(tbody);
  domainsCard.append(table);
}

function renderExceptions(): void {
  clear(exceptionsCard);
  exceptionsCard.append(
    el('h2', {}, 'Eccezioni per sito'),
    el('p', { class: 'hint' }, 'Disattiva il blocco dei tracker su un dominio specifico.'),
  );
  const exceptions = report?.exceptions ?? [];
  const list = el('ul', { class: 'list' });
  for (const exception of exceptions) {
    list.append(
      el(
        'li',
        { class: 'item' },
        el(
          'div',
          { class: 'main' },
          el('div', { class: 'title' }, exception.domain),
          el(
            'div',
            { class: 'url' },
            exception.blockTrackers ? 'Blocco attivo' : 'Blocco disattivato per questo sito',
          ),
        ),
        el(
          'div',
          { class: 'actions' },
          button('Rimuovi', async () => {
            await lome.privacy.removeException(exception.domain);
            await refresh();
          }, 'small'),
        ),
      ),
    );
  }
  if (exceptions.length === 0) {
    list.append(el('li', { class: 'empty' }, 'Nessuna eccezione configurata.'));
  }
  exceptionsCard.append(list);

  const form = el(
    'form',
    {
      style: 'display:flex;gap:8px;margin-top:12px',
      onsubmit: (event: Event) => {
        event.preventDefault();
        const input = form.querySelector('input');
        const domain = input?.value.trim().toLowerCase() ?? '';
        if (!domain) return;
        void lome.privacy.setException(domain, false).then(async () => {
          input!.value = '';
          await refresh();
          toast('Eccezione aggiunta');
        });
      },
    },
    el('input', { type: 'text', placeholder: 'esempio.com', 'aria-label': 'Dominio senza blocco' }),
    el('button', { class: 'btn', type: 'submit' }, 'Disattiva blocco'),
  );
  exceptionsCard.append(form);
}

function renderSettings(): void {
  clear(settingsCard);
  settingsCard.append(
    el('h2', {}, 'Protezioni'),
    toggleRow(
      'Blocca tracker e pubblicità',
      'Lista integrata più eventuale lista remota.',
      current.privacy.blockTrackers,
      (value) => patchPrivacy({ blockTrackers: value }),
    ),
    toggleRow(
      'Blocca cookie di terze parti',
      'Cookie e Set-Cookie rimossi per domini terzi.',
      current.privacy.blockThirdPartyCookies,
      (value) => patchPrivacy({ blockThirdPartyCookies: value }),
    ),
    toggleRow(
      'HTTPS prima',
      'Tenta sempre la versione cifrata.',
      current.privacy.httpsFirst,
      (value) => patchPrivacy({ httpsFirst: value }),
    ),
    toggleRow(
      'Do Not Track e GPC',
      'Invia DNT: 1 e Sec-GPC: 1 a ogni richiesta.',
      current.privacy.sendDoNotTrack,
      (value) => patchPrivacy({ sendDoNotTrack: value }),
    ),
    toggleRow(
      'Protezione dal fingerprinting',
      'Rumore stabile per sito su canvas, WebGL e audio.',
      current.privacy.fingerprintProtection,
      (value) => patchPrivacy({ fingerprintProtection: value }),
    ),
  );
}

function renderData(): void {
  clear(dataCard);
  dataCard.append(
    el('h2', {}, 'Dati locali'),
    el(
      'p',
      { class: 'hint' },
      'Indice, cronologia, preferiti e impostazioni vivono nella cartella dati del browser. Nessun dato viene inviato a server esterni.',
    ),
    el(
      'div',
      { class: 'row' },
      el('div', { class: 'label' }, el('strong', {}, 'Cartella dati'), el('small', {}, 'Apri il percorso sul computer.')),
      button('Apri', () => lome.app.openDataDir(), 'small'),
    ),
    el(
      'div',
      { class: 'row' },
      el(
        'div',
        { class: 'label' },
        el('strong', {}, 'Cookie, cache e archiviazione'),
        el('small', {}, 'Cancella tutto ciò che i siti hanno salvato.'),
      ),
      button('Cancella', async () => {
        await lome.app.clearData({ cookies: true, cache: true, localStorage: true });
        toast('Dati dei siti cancellati');
        await refresh();
      }, 'danger'),
    ),
    el(
      'div',
      { class: 'row' },
      el(
        'div',
        { class: 'label' },
        el('strong', {}, 'Cronologia'),
        el('small', {}, 'Rimuove le pagine visitate.'),
      ),
      button('Cancella', async () => {
        await lome.history.clear();
        toast('Cronologia cancellata');
      }, 'danger'),
    ),
    el(
      'div',
      { class: 'row' },
      el(
        'div',
        { class: 'label' },
        el('strong', {}, 'Tutti i dati di navigazione'),
        el('small', {}, 'Cookie, cache, archiviazione locale, cronologia e download.'),
      ),
      button('Cancella tutto', async () => {
        if (!window.confirm('Cancellare tutti i dati di navigazione?')) return;
        await lome.app.clearData({ cookies: true, cache: true, localStorage: true, history: true, downloads: true });
        toast('Dati cancellati');
        await refresh();
      }, 'danger'),
    ),
  );
}

async function refresh(): Promise<void> {
  report = await lome.privacy.report();
  renderStats(report.summary);
  renderDomains(report.summary);
  renderExceptions();
  renderSettings();
  renderData();
}

lome.onPrivacy((summary) => renderStats(summary));
await refresh();
