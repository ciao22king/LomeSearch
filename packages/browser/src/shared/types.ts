/**
 * Types shared by the main process, the preloads and the renderers.
 * They are bundled into every context, so this file must stay free of runtime
 * dependencies.
 */

export type ThemeMode = 'system' | 'light' | 'dark';
export type SearchEngineId = 'local' | 'duckduckgo' | 'brave' | 'startpage' | 'custom';
export type StartupMode = 'newtab' | 'restore' | 'homepage';

export interface PrivacySettings {
  blockTrackers: boolean;
  blockThirdPartyCookies: boolean;
  httpsFirst: boolean;
  sendDoNotTrack: boolean;
  fingerprintProtection: boolean;
  dnsOverHttps: boolean;
  clearOnExit: boolean;
  remoteBlocklist: string;
}

export interface EngineSettings {
  autoStart: boolean;
  port: number;
  host: string;
  dataDir: string;
  executable: string;
}

export interface DownloadSettings {
  askWhereToSave: boolean;
  directory: string;
}

export interface HistorySettings {
  enabled: boolean;
  retentionDays: number;
}

export interface ExtensionSettings {
  enabled: boolean;
  paths: string[];
}

export interface Settings {
  version: number;
  searchEngine: SearchEngineId;
  customSearchUrl: string;
  homepage: string;
  startup: StartupMode;
  theme: ThemeMode;
  language: string;
  privacy: PrivacySettings;
  engine: EngineSettings;
  downloads: DownloadSettings;
  history: HistorySettings;
  extensions: ExtensionSettings;
  restoreSession: boolean;
  suggestFromHistory: boolean;
  suggestFromEngine: boolean;
}

export interface TabState {
  id: number;
  url: string;
  title: string;
  favicon: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  isPrivate: boolean;
  blocked: number;
  audible: boolean;
  muted: boolean;
  crashed: boolean;
}

export interface WindowState {
  maximized: boolean;
  fullScreen: boolean;
  isPrivate: boolean;
}

export interface DownloadState {
  id: string;
  filename: string;
  url: string;
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted';
  received: number;
  total: number;
  savePath: string;
  startedAt: number;
}

export interface ExtensionInfo {
  id: string;
  name: string;
  version: string;
  path: string;
  enabled: boolean;
  error?: string;
}

export interface HistoryEntry {
  id: string;
  url: string;
  title: string;
  visitedAt: number;
  visitCount: number;
}

export interface Bookmark {
  id: string;
  url: string;
  title: string;
  createdAt: number;
}

export interface PrivacyDomainCount {
  domain: string;
  count: number;
}

export interface PrivacySummary {
  blockedSession: number;
  blockedTotal: number;
  blocklistSize: number;
  topDomains: PrivacyDomainCount[];
}

export interface EngineStatus {
  running: boolean;
  port: number;
  origin: string;
  documents: number;
  indexedTerms: number;
  error: string | null;
  version: string;
}

export interface ChromeState {
  tabs: TabState[];
  activeTabId: number | null;
  window: WindowState;
  engine: EngineStatus;
  privacy: PrivacySummary;
  downloads: DownloadState[];
  canReopen: boolean;
  bookmarked: boolean;
}

export interface Suggestion {
  type: 'search' | 'history' | 'bookmark' | 'url';
  title: string;
  subtitle: string;
  url: string;
}

export interface FindResult {
  matches: number;
  activeMatch: number;
}

export interface SearchResult {
  url: string;
  title: string;
  description: string;
  snippet: string;
  site: string;
  lang: string;
  fetchedAt: number;
}

export interface SearchResponse {
  query: string;
  total: number;
  tookMs: number;
  results: SearchResult[];
  suggestion?: string | null;
}

export interface EngineSearchOptions {
  limit?: number;
  offset?: number;
}

export interface ClearDataOptions {
  history?: boolean;
  cookies?: boolean;
  cache?: boolean;
  localStorage?: boolean;
  downloads?: boolean;
}

export interface SiteException {
  domain: string;
  blockTrackers: boolean;
  createdAt: number;
}

export interface PrivacyReport {
  summary: PrivacySummary;
  exceptions: SiteException[];
  settings: PrivacySettings;
}

export interface AppInfo {
  appVersion: string;
  electron: string;
  chrome: string;
  node: string;
  v8: string;
  platform: string;
  arch: string;
  engineVersion: string;
  userData: string;
}

export interface LomeApi {
  version: string;
  settings: {
    get(): Promise<Settings>;
    update(patch: Partial<Settings>): Promise<Settings>;
  };
  history: {
    list(query?: string, limit?: number): Promise<HistoryEntry[]>;
    remove(id: string): Promise<HistoryEntry[]>;
    clear(): Promise<HistoryEntry[]>;
  };
  bookmarks: {
    list(): Promise<Bookmark[]>;
    add(url: string, title: string): Promise<Bookmark>;
    remove(url: string): Promise<Bookmark[]>;
  };
  downloads: {
    list(): Promise<DownloadState[]>;
    cancel(id: string): Promise<boolean>;
    pause(id: string): Promise<boolean>;
    resume(id: string): Promise<boolean>;
    open(id: string): Promise<void>;
    show(id: string): Promise<void>;
    clear(): Promise<DownloadState[]>;
  };
  extensions: {
    list(): Promise<ExtensionInfo[]>;
    load(): Promise<ExtensionInfo[]>;
    remove(path: string): Promise<ExtensionInfo[]>;
    toggle(path: string, enabled: boolean): Promise<ExtensionInfo[]>;
    reveal(path: string): Promise<void>;
  };
  engine: {
    status(): Promise<EngineStatus>;
    restart(): Promise<EngineStatus>;
    search(query: string, limit?: number, offset?: number): Promise<SearchResponse | null>;
    suggest(query: string): Promise<string[]>;
  };
  privacy: {
    report(): Promise<PrivacyReport>;
    setException(domain: string, blockTrackers: boolean): Promise<SiteException[]>;
    removeException(domain: string): Promise<SiteException[]>;
    clearData(options: ClearDataOptions): Promise<PrivacySummary>;
  };
  app: {
    info(): Promise<AppInfo>;
    state(): Promise<ChromeState>;
    clearData(options: ClearDataOptions): Promise<{ ok: boolean }>;
    openDataDir(): Promise<void>;
    openDownloadsDir(): Promise<void>;
  };
  navigate(url: string): Promise<void>;
  openPage(page: string): Promise<void>;
  openNewTab(url: string): Promise<void>;
  search(query: string, local?: boolean): Promise<void>;
  copy(text: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  onSettingsChanged(callback: (settings: Settings) => void): () => void;
  onDownloads(callback: (items: DownloadState[]) => void): () => void;
  onExtensions(callback: (items: ExtensionInfo[]) => void): () => void;
  onEngine(callback: (status: EngineStatus) => void): () => void;
  onPrivacy(callback: (summary: PrivacySummary) => void): () => void;
  onHistory(callback: (entries: HistoryEntry[]) => void): () => void;
}

export interface ChromeApi {
  getState(): Promise<ChromeState>;
  getSettings(): Promise<Settings>;
  suggest(input: string): Promise<Suggestion[]>;
  navigate(input: string, url?: string): Promise<void>;
  back(): Promise<void>;
  forward(): Promise<void>;
  reload(ignoreCache?: boolean): Promise<void>;
  stop(): Promise<void>;
  home(): Promise<void>;
  zoom(direction: 1 | -1 | 0): Promise<void>;
  createTab(url?: string, background?: boolean): Promise<void>;
  closeTab(id: number): Promise<void>;
  selectTab(id: number): Promise<void>;
  moveTab(id: number, index: number): Promise<void>;
  reopenTab(): Promise<void>;
  muteTab(): Promise<void>;
  toggleBookmark(): Promise<boolean>;
  find(text: string, forward?: boolean, findNext?: boolean): Promise<void>;
  stopFind(): Promise<void>;
  setOverlay(open: boolean): Promise<void>;
  minimize(): Promise<void>;
  maximize(): Promise<void>;
  close(): Promise<void>;
  newWindow(privateMode?: boolean): Promise<void>;
  command(action: string): Promise<void>;
  openPage(page: string): Promise<void>;
  onState(callback: (state: ChromeState) => void): () => void;
  onFindResult(callback: (result: FindResult) => void): () => void;
  onFocusOmnibox(callback: () => void): () => void;
  onFocusFind(callback: () => void): () => void;
  onSettingsChanged(callback: (settings: Settings) => void): () => void;
  onDownloads(callback: (items: DownloadState[]) => void): () => void;
}
