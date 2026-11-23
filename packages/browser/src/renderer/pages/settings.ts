import type { EngineStatus, Settings } from '../../shared/types.js';
import { EXTERNAL_ENGINES } from '../../shared/constants.js';
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

const { main, settings: initial } = await initPage('settings', 'Settings');
let current: Settings = initial;

main.append(heading('Settings', 'Everything is stored locally, in the browser data folder.'));

async function patch(update: Partial<Settings>): Promise<void> {
  current = await lome.settings.update(update);
  toast('Settings saved');
}

function privacyPatch(update: Partial<Settings['privacy']>): Promise<void> {
  return patch({ privacy: { ...current.privacy, ...update } });
}

// ------------------------------------------------------------------- search

main.append(
  card(
    'Search',
    'The local index is the default engine: queries never leave the computer. Hybrid keeps that promise and only offers an external engine as a link.',
    selectRow(
      'Default engine',
      'Used by the address bar and the new tab page.',
      [
        { value: 'local', label: 'LomeSearch (local index)' },
        { value: 'hybrid', label: 'LomeSearch, then an external engine' },
        { value: 'bing', label: 'Bing' },
        { value: 'duckduckgo', label: 'DuckDuckGo' },
        { value: 'brave', label: 'Brave Search' },
        { value: 'startpage', label: 'Startpage' },
        { value: 'custom', label: 'Custom' },
      ],
      current.searchEngine,
      (value) => patch({ searchEngine: value as Settings['searchEngine'] }),
    ),
    selectRow(
      'Fallback engine',
      'Offered by the hybrid mode, and used when the local engine is not running. The query only leaves when you follow the link.',
      (Object.keys(EXTERNAL_ENGINES) as Settings['fallbackEngine'][]).map((id) => ({
        value: id,
        label: EXTERNAL_ENGINES[id].name,
      })),
      current.fallbackEngine,
      (value) => patch({ fallbackEngine: value as Settings['fallbackEngine'] }),
    ),
    inputRow(
      'Custom engine URL',
      'Use %s for the query. Example: https://example.com/search?q=%s',
      current.customSearchUrl,
      'https://example.com/search?q=%s',
      (value) => patch({ customSearchUrl: value }),
      'url',
    ),
    inputRow(
      'Home page',
      'Opened by the Home button and at startup when selected.',
      current.homepage,
      'lomesearch://newtab',
      (value) => patch({ homepage: value }),
      'url',
    ),
    selectRow(
      'On startup',
      'What LomeSearch shows when it starts.',
      [
        { value: 'newtab', label: 'New tab' },
        { value: 'restore', label: 'Restore previous tabs' },
        { value: 'homepage', label: 'Home page' },
      ],
      current.startup,
      (value) => patch({ startup: value as Settings['startup'] }),
    ),
    toggleRow(
      'History suggestions',
      'Complete the address bar with pages you already visited.',
      current.suggestFromHistory,
      (value) => patch({ suggestFromHistory: value }),
    ),
    toggleRow(
      'Engine suggestions',
      'Ask the local index for completions while you type.',
      current.suggestFromEngine,
      (value) => patch({ suggestFromEngine: value }),
    ),
  ),
);

// --------------------------------------------------------------- appearance

main.append(
  card(
    'Appearance',
    'Tabs live in the left sidebar with a preview of each page.',
    selectRow(
      'Theme',
      'Follow the system or force light or dark.',
      [
        { value: 'system', label: 'System' },
        { value: 'light', label: 'Light' },
        { value: 'dark', label: 'Dark' },
      ],
      current.theme,
      async (value) => {
        document.documentElement.dataset.theme = value;
        await patch({ theme: value as Settings['theme'] });
      },
    ),
    toggleRow(
      'Tab previews',
      'Capture a thumbnail when a tab loads and when you switch away from it.',
      current.appearance.tabPreviews,
      (value) => patch({ appearance: { ...current.appearance, tabPreviews: value } }),
    ),
    selectRow(
      'Freeze idle tabs after',
      'A frozen tab releases its renderer and reloads when you select it again.',
      [
        { value: '5', label: '5 minutes' },
        { value: '15', label: '15 minutes' },
        { value: '30', label: '30 minutes' },
        { value: '60', label: '1 hour' },
        { value: '0', label: 'Never' },
      ],
      String(current.performance.freezeAfterMinutes),
      (value) => patch({ performance: { ...current.performance, freezeAfterMinutes: Number(value) } }),
    ),
  ),
);

// ------------------------------------------------------------------ privacy

main.append(
  card(
    'Privacy',
    'These protections apply to every tab, extensions included.',
    toggleRow(
      'Block trackers',
      'Built-in list of analytics, session replay and fingerprinting domains.',
      current.privacy.blockTrackers,
      (value) => privacyPatch({ blockTrackers: value }),
    ),
    toggleRow(
      'Block ads',
      'Built-in list of ad networks, separate from the tracker list.',
      current.privacy.blockAds,
      (value) => privacyPatch({ blockAds: value }),
    ),
    toggleRow(
      'Hide ad slots',
      'Injects a small CSS list that removes common ad containers before they render.',
      current.privacy.cosmeticFiltering,
      (value) => privacyPatch({ cosmeticFiltering: value }),
    ),
    toggleRow(
      'Block third-party cookies',
      'Removes Cookie and Set-Cookie headers for domains other than the page you visit.',
      current.privacy.blockThirdPartyCookies,
      (value) => privacyPatch({ blockThirdPartyCookies: value }),
    ),
    toggleRow(
      'HTTPS first',
      'Try the encrypted version and fall back to HTTP only when the site cannot serve it.',
      current.privacy.httpsFirst,
      (value) => privacyPatch({ httpsFirst: value }),
    ),
    toggleRow(
      'Send Do Not Track and Global Privacy Control',
      'Tells sites not to track the visit.',
      current.privacy.sendDoNotTrack,
      (value) => privacyPatch({ sendDoNotTrack: value }),
    ),
    toggleRow(
      'Fingerprint protection',
      'Deterministic noise on canvas, WebGL, audio, devices and hardware counts.',
      current.privacy.fingerprintProtection,
      (value) => privacyPatch({ fingerprintProtection: value }),
    ),
    selectRow(
      'WebRTC',
      'Blocking stops ICE candidates from carrying local or public addresses. Restart required.',
      [
        { value: 'disable', label: 'Block (recommended)' },
        { value: 'public-interface', label: 'Public interface only' },
        { value: 'default', label: 'Chromium default' },
      ],
      current.privacy.webrtcPolicy,
      (value) =>
        privacyPatch({ webrtcPolicy: value as Settings['privacy']['webrtcPolicy'] }),
    ),
    selectRow(
      'Referer',
      'How much of the previous URL is sent to the destination.',
      [
        { value: 'strict', label: 'Origin only across sites (recommended)' },
        { value: 'origin', label: 'Origin only, always' },
        { value: 'none', label: 'Never' },
      ],
      current.privacy.referrerPolicy,
      (value) =>
        privacyPatch({ referrerPolicy: value as Settings['privacy']['referrerPolicy'] }),
    ),
    toggleRow(
      'UTC timezone',
      'Expose UTC instead of the local zone, which is an identifier. Restart required.',
      current.privacy.spoofTimezone,
      (value) => privacyPatch({ spoofTimezone: value }),
    ),
    toggleRow(
      'DNS over HTTPS',
      'Cloudflare DoH. Restart the browser to apply.',
      current.privacy.dnsOverHttps,
      (value) => privacyPatch({ dnsOverHttps: value }),
    ),
    toggleRow(
      'Spellchecker',
      'Electron downloads dictionaries from a Google CDN, so this is off by default.',
      current.privacy.spellchecker,
      (value) => privacyPatch({ spellchecker: value }),
    ),
    toggleRow(
      'Clear data on exit',
      'Cookies, cache and local storage are removed when you quit.',
      current.privacy.clearOnExit,
      (value) => privacyPatch({ clearOnExit: value }),
    ),
    inputRow(
      'Remote blocklist',
      'Optional URL, one domain per line. Added to the built-in list.',
      current.privacy.remoteBlocklist,
      'https://example.com/trackers.txt',
      (value) => privacyPatch({ remoteBlocklist: value }),
      'url',
    ),
    toggleRow(
      'Fake IP headers',
      'Sends decoy X-Forwarded-For / Forwarded headers with a reserved address. It does not hide your real IP: servers still see the connection source. Off by default.',
      current.privacy.fakeIpEnabled,
      (value) => privacyPatch({ fakeIpEnabled: value }),
    ),
    inputRow(
      'Fake address',
      'Leave empty for a new reserved address per request. This is a decoy, not a proxy; some sites may reject or log it.',
      current.privacy.fakeIpAddress,
      '203.0.113.10',
      (value) => privacyPatch({ fakeIpAddress: value }),
    ),
    el(
      'div',
      { class: 'row' },
      el(
        'div',
        { class: 'label' },
        el('strong', {}, 'How far these protections go'),
        el('small', {}, 'The legal page lists what is guaranteed and what is not.'),
      ),
      el('a', { class: 'btn', href: 'lomesearch://legal' }, 'Legal'),
    ),
  ),
);

// ------------------------------------------------------------------- engine

const engineCard = card('Local search engine', 'The process that indexes and answers queries.');
main.append(engineCard);

let engineStatus: EngineStatus | null = null;

function renderEngine(): void {
  engineCard.textContent = '';
  engineCard.append(
    el('h2', {}, 'Local search engine'),
    el('p', { class: 'hint' }, 'The process that indexes and answers queries.'),
    el(
      'div',
      { class: 'row' },
      el(
        'div',
        { class: 'label' },
        el('strong', {}, engineStatus?.running ? 'Running' : 'Stopped'),
        el(
          'small',
          {},
          engineStatus?.running
            ? `${engineStatus.origin} · ${engineStatus.documents.toLocaleString('en-US')} documents · ${engineStatus.indexedTerms.toLocaleString('en-US')} terms`
            : engineStatus?.error ?? 'Start the engine to use the local index.',
        ),
      ),
      el(
        'span',
        { class: `pill ${engineStatus?.running ? '' : 'warn'}` },
        el('span', { class: `dot ${engineStatus?.running ? 'on' : 'off'}` }),
        engineStatus?.running ? 'active' : 'stopped',
      ),
    ),
    toggleRow(
      'Start with the browser',
      'When off, LomeSearch connects to an engine that is already running.',
      current.engine.autoStart,
      (value) => patch({ engine: { ...current.engine, autoStart: value } }),
    ),
    inputRow(
      'Port',
      'Local port of the search server (default 7717).',
      String(current.engine.port),
      '7717',
      async (value) => {
        const port = Number.parseInt(value, 10);
        if (!Number.isFinite(port) || port < 1 || port > 65535) {
          toast('Invalid port');
          return;
        }
        await patch({ engine: { ...current.engine, port } });
        engineStatus = await lome.engine.restart();
        renderEngine();
      },
      'number',
    ),
    inputRow(
      'Data folder',
      'Where the index, documents and IndexNow key live.',
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
        el('strong', {}, 'Actions'),
        el('small', {}, 'Restart the engine or open the data folder.'),
      ),
      el(
        'div',
        { style: 'display:flex;gap:8px' },
        button('Restart', async () => {
          engineStatus = await lome.engine.restart();
          renderEngine();
          toast('Engine restarted');
        }),
        button('Open folder', () => lome.app.openDataDir(), 'small'),
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

// ------------------------------------------------------------------ history

main.append(
  card(
    'History',
    'Stored locally, never sent anywhere.',
    toggleRow(
      'Record history',
      'When off, new visits are not saved.',
      current.history.enabled,
      (value) => patch({ history: { ...current.history, enabled: value } }),
    ),
    selectRow(
      'Retention',
      'Older entries are removed automatically.',
      [
        { value: '7', label: '7 days' },
        { value: '30', label: '30 days' },
        { value: '90', label: '90 days' },
        { value: '365', label: '1 year' },
        { value: '0', label: 'Forever' },
      ],
      String(current.history.retentionDays),
      (value) => patch({ history: { ...current.history, retentionDays: Number(value) } }),
    ),
  ),
);

// ----------------------------------------------------------------- download

main.append(
  card(
    'Downloads',
    null,
    toggleRow(
      'Ask where to save',
      'When off, files go to the folder below.',
      current.downloads.askWhereToSave,
      (value) => patch({ downloads: { ...current.downloads, askWhereToSave: value } }),
    ),
    inputRow(
      'Download folder',
      'Absolute path on this computer.',
      current.downloads.directory,
      '',
      (value) => patch({ downloads: { ...current.downloads, directory: value } }),
    ),
  ),
);

// --------------------------------------------------------------- extensions

main.append(
  card(
    'Extensions',
    'Supported Chrome extensions are loaded from a local folder.',
    toggleRow(
      'Enable extensions',
      'The change takes effect on the next start.',
      current.extensions.enabled,
      (value) => patch({ extensions: { ...current.extensions, enabled: value } }),
    ),
    el(
      'div',
      { class: 'row' },
      el(
        'div',
        { class: 'label' },
        el('strong', {}, 'Manage extensions'),
        el('small', {}, 'Load an unpacked folder or remove the ones already loaded.'),
      ),
      el('a', { class: 'btn', href: 'lomesearch://extensions' }, 'Open'),
    ),
  ),
);

// -------------------------------------------------------------- local data

main.append(
  card(
    'Local data',
    'Nothing is synchronised or sent to external servers.',
    el(
      'div',
      { class: 'row' },
      el(
        'div',
        { class: 'label' },
        el('strong', {}, 'Clear cookies and cache'),
        el('small', {}, 'Closes every site session.'),
      ),
      button('Clear', async () => {
        await lome.app.clearData({ cookies: true, cache: true, localStorage: true });
        toast('Cookies and cache cleared');
      }, 'danger'),
    ),
    el(
      'div',
      { class: 'row' },
      el(
        'div',
        { class: 'label' },
        el('strong', {}, 'Clear history'),
        el('small', {}, 'Removes every saved entry.'),
      ),
      button('Clear', async () => {
        await lome.history.clear();
        toast('History cleared');
      }, 'danger'),
    ),
  ),
);
