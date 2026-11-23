import type { SearchEngineId, Settings } from './types.js';

export const INTERNAL_SCHEME = 'lomesearch';

export const INTERNAL_PAGES = [
  'newtab',
  'settings',
  'history',
  'bookmarks',
  'downloads',
  'extensions',
  'privacy',
  'about',
] as const;

export type InternalPage = (typeof INTERNAL_PAGES)[number];

export const PAGE_TITLES: Record<InternalPage, string> = {
  newtab: 'Nuova scheda',
  settings: 'Impostazioni',
  history: 'Cronologia',
  bookmarks: 'Preferiti',
  downloads: 'Download',
  extensions: 'Estensioni',
  privacy: 'Privacy',
  about: 'Informazioni',
};

export const TAB_STRIP_HEIGHT = 38;
export const TOOLBAR_HEIGHT = 48;
export const CHROME_HEIGHT = TAB_STRIP_HEIGHT + TOOLBAR_HEIGHT;
export const FIND_BAR_HEIGHT = 44;
export const MAX_HISTORY_ENTRIES = 10_000;
export const MAX_DOWNLOADS = 200;

export const SEARCH_ENGINES: Record<Exclude<SearchEngineId, 'local' | 'custom'>, { name: string; url: string }> = {
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
  brave: { name: 'Brave Search', url: 'https://search.brave.com/search?q=%s' },
  startpage: { name: 'Startpage', url: 'https://www.startpage.com/sp/search?query=%s' },
};

export function defaultSettings(paths: { dataDir: string; downloadDir: string }): Settings {
  return {
    version: 1,
    searchEngine: 'local',
    customSearchUrl: 'https://duckduckgo.com/?q=%s',
    homepage: 'lomesearch://newtab',
    startup: 'newtab',
    theme: 'system',
    language: 'it',
    privacy: {
      blockTrackers: true,
      blockThirdPartyCookies: true,
      httpsFirst: true,
      sendDoNotTrack: true,
      fingerprintProtection: true,
      dnsOverHttps: true,
      clearOnExit: false,
      remoteBlocklist: '',
    },
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
