import { contextBridge, ipcRenderer, webFrame, type IpcRendererEvent } from 'electron';
import type {
  AppInfo,
  Bookmark,
  ChromeState,
  ClearDataOptions,
  DownloadState,
  EngineStatus,
  ExtensionInfo,
  HistoryEntry,
  LomeApi,
  PrivacyReport,
  PrivacySummary,
  SearchResponse,
  Settings,
  SiteException,
} from '../shared/types.js';

/**
 * Preload shared by every tab.
 *
 * Two jobs:
 *  - on web pages, apply fingerprint noise when the user enabled it;
 *  - on internal pages, expose the privileged `window.lome` API.
 *
 * The API is only created for `lomesearch://` documents, and the main process
 * re-checks the frame URL for every privileged call.
 */

interface PageConfig {
  fingerprintProtection: boolean;
  fingerprintSeed: string;
  theme: 'system' | 'light' | 'dark';
  isPrivate: boolean;
  version: string;
}

const config = ipcRenderer.sendSync('page:config') as PageConfig;

if (config.fingerprintProtection && location.protocol !== 'lomesearch:') {
  const script = buildNoiseScript(config.fingerprintSeed, location.hostname);
  const frame = webFrame as unknown as {
    executeJavaScript?: (code: string, userGesture?: boolean) => Promise<unknown>;
  };
  if (typeof frame.executeJavaScript === 'function') {
    void frame.executeJavaScript(script, true).catch(() => {
      // Some pages replace globals early; noise is best effort.
    });
  }
}

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T): void => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

if (location.protocol === 'lomesearch:') {
  const api: LomeApi = {
    version: config.version,
    settings: {
      get: () => ipcRenderer.invoke('settings:get') as Promise<Settings>,
      update: (patch) => ipcRenderer.invoke('settings:update', patch) as Promise<Settings>,
    },
    history: {
      list: (query = '', limit = 300) =>
        ipcRenderer.invoke('history:list', { query, limit }) as Promise<HistoryEntry[]>,
      remove: (id) => ipcRenderer.invoke('history:remove', { id }) as Promise<HistoryEntry[]>,
      clear: () => ipcRenderer.invoke('history:clear') as Promise<HistoryEntry[]>,
    },
    bookmarks: {
      list: () => ipcRenderer.invoke('bookmarks:list') as Promise<Bookmark[]>,
      add: (url, title) => ipcRenderer.invoke('bookmarks:add', { url, title }) as Promise<Bookmark>,
      remove: (url) => ipcRenderer.invoke('bookmarks:remove', { url }) as Promise<Bookmark[]>,
    },
    downloads: {
      list: () => ipcRenderer.invoke('downloads:list') as Promise<DownloadState[]>,
      cancel: (id) => ipcRenderer.invoke('downloads:cancel', { id }) as Promise<boolean>,
      pause: (id) => ipcRenderer.invoke('downloads:pause', { id }) as Promise<boolean>,
      resume: (id) => ipcRenderer.invoke('downloads:resume', { id }) as Promise<boolean>,
      open: (id) => ipcRenderer.invoke('downloads:open', { id }) as Promise<void>,
      show: (id) => ipcRenderer.invoke('downloads:show', { id }) as Promise<void>,
      clear: () => ipcRenderer.invoke('downloads:clear') as Promise<DownloadState[]>,
    },
    extensions: {
      list: () => ipcRenderer.invoke('extensions:list') as Promise<ExtensionInfo[]>,
      load: () => ipcRenderer.invoke('extensions:load') as Promise<ExtensionInfo[]>,
      remove: (path) => ipcRenderer.invoke('extensions:remove', { path }) as Promise<ExtensionInfo[]>,
      toggle: (path, enabled) =>
        ipcRenderer.invoke('extensions:toggle', { path, enabled }) as Promise<ExtensionInfo[]>,
      reveal: (path) => ipcRenderer.invoke('extensions:reveal', { path }) as Promise<void>,
    },
    engine: {
      status: () => ipcRenderer.invoke('engine:status') as Promise<EngineStatus>,
      restart: () => ipcRenderer.invoke('engine:restart') as Promise<EngineStatus>,
      search: (query, limit, offset) =>
        ipcRenderer.invoke('engine:search', { query, limit, offset }) as Promise<SearchResponse | null>,
      suggest: (query) => ipcRenderer.invoke('engine:suggest', { query }) as Promise<string[]>,
    },
    privacy: {
      report: () => ipcRenderer.invoke('privacy:report') as Promise<PrivacyReport>,
      setException: (domain, blockTrackers) =>
        ipcRenderer.invoke('privacy:set-exception', { domain, blockTrackers }) as Promise<SiteException[]>,
      removeException: (domain) =>
        ipcRenderer.invoke('privacy:remove-exception', { domain }) as Promise<SiteException[]>,
      clearData: (options) =>
        ipcRenderer.invoke('privacy:clear-data', options) as Promise<PrivacySummary>,
    },
    app: {
      info: () => ipcRenderer.invoke('app:info') as Promise<AppInfo>,
      state: () => ipcRenderer.invoke('app:state') as Promise<ChromeState>,
      clearData: (options: ClearDataOptions) =>
        ipcRenderer.invoke('app:clear-data', options) as Promise<{ ok: boolean }>,
      openDataDir: () => ipcRenderer.invoke('app:open-data-dir') as Promise<void>,
      openDownloadsDir: () => ipcRenderer.invoke('app:open-downloads-dir') as Promise<void>,
    },
    navigate: (url) => ipcRenderer.invoke('page:navigate', { url }) as Promise<void>,
    openPage: (page) => ipcRenderer.invoke('page:open-page', { page }) as Promise<void>,
    openNewTab: (url) => ipcRenderer.invoke('page:open-new-tab', { url }) as Promise<void>,
    search: (query, local = false) =>
      ipcRenderer.invoke('page:search', { query, local }) as Promise<void>,
    copy: (text) => ipcRenderer.invoke('page:copy', { text }) as Promise<void>,
    openExternal: (url) => ipcRenderer.invoke('shell:open-external', { url }) as Promise<void>,
    onSettingsChanged: (callback) => subscribe<Settings>('settings:changed', callback),
    onDownloads: (callback) => subscribe<DownloadState[]>('downloads:update', callback),
    onExtensions: (callback) => subscribe<ExtensionInfo[]>('extensions:update', callback),
    onEngine: (callback) => subscribe<EngineStatus>('engine:status', callback),
    onPrivacy: (callback) => subscribe<PrivacySummary>('privacy:update', callback),
    onHistory: (callback) => subscribe<HistoryEntry[]>('history:update', callback),
  };
  contextBridge.exposeInMainWorld('lome', api);
}

/**
 * Fingerprint noise, injected at document start.
 *
 * The noise is deterministic for the session and the site, so a page that reads
 * the same canvas twice gets the same answer, but it differs between sites and
 * between browser runs. Every patch is defensive: a broken API must never break
 * the page.
 */
function buildNoiseScript(seed: string, host: string): string {
  return `(() => {
  try {
    const seed = ${JSON.stringify(seed)} + '|' + ${JSON.stringify(host)};
    let h = 2166136261 >>> 0;
    for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
    const rand = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; };
    const jitter = (value, amplitude) => value + (rand() - 0.5) * amplitude;

    try {
      const original = CanvasRenderingContext2D.prototype.getImageData;
      CanvasRenderingContext2D.prototype.getImageData = function (x, y, w, h) {
        const data = original.call(this, x, y, w, h);
        for (let i = 0; i < data.data.length; i += 4 * 499) {
          data.data[i] = Math.max(0, Math.min(255, jitter(data.data[i], 2)));
        }
        return data;
      };
    } catch (error) {}

    try {
      const patch = (proto) => {
        if (!proto || !proto.getParameter) return;
        const original = proto.getParameter;
        proto.getParameter = function (parameter) {
          if (parameter === 37445) return 'LomeSearch';
          if (parameter === 37446) return 'LomeSearch Graphics';
          return original.call(this, parameter);
        };
      };
      patch(window.WebGLRenderingContext && WebGLRenderingContext.prototype);
      patch(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype);
    } catch (error) {}

    try {
      if (window.AudioBuffer) {
        const original = AudioBuffer.prototype.getChannelData;
        AudioBuffer.prototype.getChannelData = function (channel) {
          const data = original.call(this, channel);
          for (let i = 0; i < data.length; i += 1009) data[i] = jitter(data[i], 0.0000002);
          return data;
        };
      }
    } catch (error) {}

    try {
      Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { get: () => 4 + (h % 5), configurable: true });
    } catch (error) {}
    try {
      Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => [4, 8][h % 2], configurable: true });
    } catch (error) {}
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        const original = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
        navigator.mediaDevices.enumerateDevices = async () => {
          const devices = await original();
          return devices.map((device, index) => ({
            deviceId: 'lome-' + index + '-' + (h % 997),
            groupId: 'group-' + (h % 89),
            kind: device.kind,
            label: '',
          }));
        };
      }
    } catch (error) {}
  } catch (error) {}
})();`;
}
