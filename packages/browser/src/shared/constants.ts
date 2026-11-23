import type { ExternalEngineId, PrivacySettings, SearchEngineId, Settings } from './types.js';

export const INTERNAL_SCHEME = 'lomesearch';

export const INTERNAL_PAGES = [
  'newtab',
  'settings',
  'history',
  'bookmarks',
  'downloads',
  'extensions',
  'privacy',
  'legal',
  'about',
  'error',
] as const;

export type InternalPage = (typeof INTERNAL_PAGES)[number];

export const PAGE_TITLES: Record<InternalPage, string> = {
  newtab: 'New tab',
  settings: 'Settings',
  history: 'History',
  bookmarks: 'Bookmarks',
  downloads: 'Downloads',
  extensions: 'Extensions',
  privacy: 'Privacy',
  legal: 'Legal',
  about: 'About',
  error: 'Page unavailable',
};

export const TOOLBAR_HEIGHT = 48;
export const SIDEBAR_WIDTH = 268;
export const SIDEBAR_COMPACT_WIDTH = 0;
/** Vertical space the page leaves free at the top (the toolbar only). */
export const CHROME_HEIGHT = TOOLBAR_HEIGHT;
export const FIND_BAR_HEIGHT = 44;
export const MAX_HISTORY_ENTRIES = 10_000;
export const MAX_DOWNLOADS = 200;

export const EXTERNAL_ENGINES: Record<ExternalEngineId, { name: string; url: string }> = {
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=%s' },
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
  brave: { name: 'Brave Search', url: 'https://search.brave.com/search?q=%s' },
  startpage: { name: 'Startpage', url: 'https://www.startpage.com/sp/search?query=%s' },
  mojeek: { name: 'Mojeek', url: 'https://www.mojeek.com/search?q=%s' },
  google: { name: 'Google', url: 'https://www.google.com/search?q=%s' },
};

/** Engines that can be the default one in the address bar. */
export const SEARCH_ENGINES: Record<
  Exclude<SearchEngineId, 'local' | 'custom' | 'hybrid'>,
  { name: string; url: string }
> = {
  google: EXTERNAL_ENGINES.google,
  bing: EXTERNAL_ENGINES.bing,
  duckduckgo: EXTERNAL_ENGINES.duckduckgo,
  brave: EXTERNAL_ENGINES.brave,
  startpage: EXTERNAL_ENGINES.startpage,
};

export const DEFAULT_PRIVACY: PrivacySettings = {
  blockTrackers: true,
  blockAds: true,
  cosmeticFiltering: true,
  blockThirdPartyCookies: true,
  httpsFirst: true,
  sendDoNotTrack: true,
  fingerprintProtection: true,
  dnsOverHttps: true,
  webrtcPolicy: 'disable',
  referrerPolicy: 'strict',
  spoofTimezone: true,
  spellchecker: false,
  clearOnExit: false,
  remoteBlocklist: '',
  fakeIpEnabled: false,
  fakeIpAddress: '',
};

export function defaultSettings(paths: { dataDir: string; downloadDir: string }): Settings {
  return {
    version: 1,
    searchEngine: 'local',
    fallbackEngine: 'bing',
    customSearchUrl: 'https://duckduckgo.com/?q=%s',
    homepage: 'lomesearch://newtab',
    startup: 'newtab',
    theme: 'system',
    language: 'en',
    privacy: { ...DEFAULT_PRIVACY },
    appearance: { tabPreviews: true },
    performance: { freezeAfterMinutes: 20 },
    engine: {
      autoStart: true,
      port: 7717,
      host: '127.0.0.1',
      dataDir: paths.dataDir,
      executable: '',
    },
    downloads: {
      askWhereToSave: false,
      directory: paths.downloadDir,
    },
    history: {
      enabled: true,
      retentionDays: 90,
    },
    extensions: {
      enabled: true,
      paths: [],
    },
    restoreSession: true,
    suggestFromHistory: true,
    suggestFromEngine: true,
  };
}
