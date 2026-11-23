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
const domainsCard = card('Most blocked domains', 'Aggregate counts, without a log of individual requests.');
const exceptionsCard = card('Site exceptions', 'Turn blocking off for one domain.');
const settingsCard = card('Protections', null);
const dataCard = card('Local data', null);

main.append(
  heading(
    'Privacy',
    'LomeSearch has no account, syncs nothing and logs no query. This page shows what is blocked and where the data lives.',
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
  toast('Protection updated');
  await refresh();
}

function renderStats(summary: PrivacySummary): void {
  clear(statsGrid);
  const values: Array<[string, string]> = [
    [summary.blockedSession.toLocaleString('en-US'), 'blocked this session'],
    [summary.blockedTotal.toLocaleString('en-US'), 'blocked in total'],
    [summary.blocklistSize.toLocaleString('en-US'), 'rules in the list'],
    [String(summary.topDomains.length), 'domains observed'],
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
    el('h2', {}, 'Most blocked domains'),
    el('p', { class: 'hint' }, 'Aggregate counts, without a log of individual requests.'),
  );
  if (summary.topDomains.length === 0) {
    domainsCard.append(
      el('div', { class: 'empty' }, el('strong', {}, 'No tracker blocked yet'), 'Browse for a while and come back.'),
    );
    return;
  }
  const table = el('table', {});
  table.append(
    el('thead', {}, el('tr', {}, el('th', {}, 'Domain'), el('th', { class: 'num' }, 'Requests'))),
  );
  const tbody = el('tbody', {});
  for (const entry of summary.topDomains) {
    tbody.append(
      el('tr', {}, el('td', {}, entry.domain), el('td', { class: 'num' }, entry.count.toLocaleString('en-US'))),
    );
  }
  table.append(tbody);
  domainsCard.append(table);
}

function renderExceptions(): void {
  clear(exceptionsCard);
  exceptionsCard.append(
    el('h2', {}, 'Site exceptions'),
    el('p', { class: 'hint' }, 'Turn blocking off for one domain.'),
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
            exception.blockTrackers ? 'Blocking on' : 'Blocking off for this site',
          ),
        ),
        el(
          'div',
          { class: 'actions' },
          button('Remove', async () => {
            await lome.privacy.removeException(exception.domain);
            await refresh();
          }, 'small'),
        ),
      ),
    );
  }
  if (exceptions.length === 0) {
    list.append(el('li', { class: 'empty' }, 'No exception configured.'));
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
          toast('Exception added');
        });
      },
    },
    el('input', { type: 'text', placeholder: 'example.com', 'aria-label': 'Domain without blocking' }),
    el('button', { class: 'btn', type: 'submit' }, 'Turn blocking off'),
  );
  exceptionsCard.append(form);
}

function networkRow(label: string, detail: string): HTMLElement {
  return el(
    'div',
    { class: 'row' },
    el('div', { class: 'label' }, el('strong', {}, label), el('small', {}, detail)),
  );
}

function renderSettings(): void {
  clear(settingsCard);
  settingsCard.append(
    el('h2', {}, 'Protections'),
    toggleRow(
      'Block trackers',
      'Built-in list plus the optional remote list.',
      current.privacy.blockTrackers,
      (value) => patchPrivacy({ blockTrackers: value }),
    ),
    toggleRow(
      'Block ads',
      'Ad networks, separate from the tracker list.',
      current.privacy.blockAds,
      (value) => patchPrivacy({ blockAds: value }),
    ),
    toggleRow(
      'Hide ad slots',
      'CSS list that removes common ad containers before they render.',
      current.privacy.cosmeticFiltering,
      (value) => patchPrivacy({ cosmeticFiltering: value }),
    ),
    toggleRow(
      'Block third-party cookies',
      'Cookie and Set-Cookie removed for third-party domains.',
      current.privacy.blockThirdPartyCookies,
      (value) => patchPrivacy({ blockThirdPartyCookies: value }),
    ),
    toggleRow(
      'HTTPS first',
      'Always try the encrypted version first.',
      current.privacy.httpsFirst,
      (value) => patchPrivacy({ httpsFirst: value }),
    ),
    toggleRow(
      'Do Not Track and GPC',
      'Sends DNT: 1 and Sec-GPC: 1 on every request.',
      current.privacy.sendDoNotTrack,
      (value) => patchPrivacy({ sendDoNotTrack: value }),
    ),
    toggleRow(
      'Fingerprint protection',
      'Stable per-site noise on canvas, WebGL and audio.',
      current.privacy.fingerprintProtection,
      (value) => patchPrivacy({ fingerprintProtection: value }),
    ),
    networkRow(
      'WebRTC',
      current.privacy.webrtcPolicy === 'disable'
        ? 'Blocked: no direct UDP, no local IP towards sites.'
        : current.privacy.webrtcPolicy === 'public-interface'
          ? 'Public interface only: local IPs do not leave.'
          : 'Chromium default: may expose local IPs.',
    ),
    networkRow(
      'Referer',
      current.privacy.referrerPolicy === 'none'
        ? 'Never sent.'
        : current.privacy.referrerPolicy === 'origin'
          ? 'Always reduced to the origin.'
          : 'Origin across sites, full URL only within the same site.',
    ),
    networkRow('Timezone', current.privacy.spoofTimezone ? 'UTC' : 'System timezone.'),
    networkRow(
      'DNS',
      current.privacy.dnsOverHttps ? 'Cloudflare DoH (needs a restart).' : 'Operating system resolver.',
    ),
    networkRow(
      'Spellchecker',
      current.privacy.spellchecker ? 'On: downloads dictionaries from a Google CDN.' : 'Off.',
    ),
    networkRow(
      'Fake IP headers',
      current.privacy.fakeIpEnabled
        ? `Decoy headers with ${current.privacy.fakeIpAddress.trim() || 'a random reserved address'}. The real IP is still visible to servers.`
        : 'Off. Decoy forwarding headers, not a proxy.',
    ),
  );
}

function renderData(): void {
  clear(dataCard);
  dataCard.append(
    el('h2', {}, 'Local data'),
    el(
      'p',
      { class: 'hint' },
      'The index, history, bookmarks and settings live in the browser data folder. Nothing is sent to external servers.',
    ),
    el(
      'div',
      { class: 'row' },
      el('div', { class: 'label' }, el('strong', {}, 'Data folder'), el('small', {}, 'Open the path on this computer.')),
      button('Open', () => lome.app.openDataDir(), 'small'),
    ),
    el(
      'div',
      { class: 'row' },
      el(
        'div',
        { class: 'label' },
        el('strong', {}, 'Cookies, cache and storage'),
        el('small', {}, 'Delete everything sites stored.'),
      ),
      button('Clear', async () => {
        await lome.app.clearData({ cookies: true, cache: true, localStorage: true });
        toast('Site data cleared');
        await refresh();
      }, 'danger'),
    ),
    el(
      'div',
      { class: 'row' },
      el(
        'div',
        { class: 'label' },
        el('strong', {}, 'History'),
        el('small', {}, 'Removes the pages you visited.'),
      ),
      button('Clear', async () => {
        await lome.history.clear();
        toast('History cleared');
      }, 'danger'),
    ),
    el(
      'div',
      { class: 'row' },
      el(
        'div',
        { class: 'label' },
        el('strong', {}, 'All browsing data'),
        el('small', {}, 'Cookies, cache, local storage, history and downloads.'),
      ),
      button('Clear all', async () => {
        if (!window.confirm('Clear all browsing data?')) return;
        await lome.app.clearData({ cookies: true, cache: true, localStorage: true, history: true, downloads: true });
        toast('Data cleared');
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
