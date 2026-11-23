import { button, el, lome } from './common.js';

/**
 * Network error page. The URL and the Chromium error code arrive as query
 * parameters; retrying goes back to the original address, not to this page.
 */

const params = new URLSearchParams(location.search);
const url = params.get('url') ?? '';
const code = Number.parseInt(params.get('code') ?? '0', 10);
const description = params.get('description') ?? '';

const MESSAGES: Record<number, string> = {
  [-105]: 'Il nome del sito non è stato risolto. Controlla l’indirizzo o la connessione.',
  [-106]: 'La connessione a Internet non è disponibile.',
  [-102]: 'Il server ha rifiutato la connessione.',
  [-7]: 'Il server non ha risposto in tempo.',
  [-202]: 'Il certificato del sito non è valido o non è attendibile.',
  [-21]: 'La rete è cambiata durante il caricamento.',
  [-324]: 'Il server ha chiuso la connessione senza inviare dati.',
};

const message = MESSAGES[code] ?? 'Non è stato possibile caricare la pagina.';

document.title = 'Pagina non disponibile · LomeSearch';
document.documentElement.dataset.theme = 'system';

const shell = el(
  'div',
  { class: 'shell' },
  el(
    'div',
    { class: 'error-page' },
    el('h1', {}, 'Impossibile raggiungere il sito'),
    el('p', { class: 'muted' }, message),
    el('p', { class: 'url' }, url || description),
    el(
      'div',
      { style: 'display:flex;gap:10px' },
      button('Riprova', () => {
        if (url) void lome.navigate(url);
        else void lome.openPage('newtab');
      }, 'primary'),
      button('Nuova scheda', () => lome.openPage('newtab')),
      button('Cerca nell’indice locale', () => {
        let host = '';
        try {
          host = url ? new URL(url).hostname : '';
        } catch {
          host = '';
        }
        if (host) void lome.search(host, true);
      }),
    ),
    el(
      'p',
      { class: 'small muted', style: 'margin-top:26px' },
      code ? `Codice errore ${code}${description ? ` · ${description}` : ''}` : description,
    ),
  ),
);

document.body.append(shell);
