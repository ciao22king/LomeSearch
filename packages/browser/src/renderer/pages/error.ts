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
  [-105]: 'The site name could not be resolved. Check the address or the connection.',
  [-106]: 'The Internet connection is not available.',
  [-102]: 'The server refused the connection.',
  [-7]: 'The server did not answer in time.',
  [-202]: 'The site certificate is not valid or not trusted.',
  [-21]: 'The network changed while the page was loading.',
  [-324]: 'The server closed the connection without sending data.',
};

const message = MESSAGES[code] ?? 'The page could not be loaded.';

document.title = 'Page unavailable · LomeSearch';
document.documentElement.dataset.theme = 'system';

const shell = el(
  'div',
  { class: 'shell' },
  el(
    'div',
    { class: 'error-page' },
    el('img', { class: 'mascot', src: '/pages/mascotte.svg', alt: '', width: 88, height: 88 }),
    el('h1', {}, 'This site cannot be reached'),
    el('p', { class: 'muted' }, message),
    el('p', { class: 'url' }, url || description),
    el(
      'div',
      { style: 'display:flex;gap:10px' },
      button('Try again', () => {
        if (url) void lome.navigate(url);
        else void lome.openPage('newtab');
      }, 'primary'),
      button('New tab', () => lome.openPage('newtab')),
      button('Search the local index', () => {
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
      code ? `Error code ${code}${description ? ` · ${description}` : ''}` : description,
    ),
  ),
);

document.body.append(shell);
