import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { ChromeApi, DownloadState, FindResult, Settings, Suggestion, ChromeState } from '../shared/types.js';

/**
 * Bridge for the chrome UI.
 *
 * The renderer gets a narrow, typed API: no Node, no arbitrary IPC. Every call
 * is validated again in the main process.
 */

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T): void => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: ChromeApi = {
  getState: () => ipcRenderer.invoke('app:state') as Promise<ChromeState>,
  getSettings: () => ipcRenderer.invoke('settings:get') as Promise<Settings>,
  suggest: (input: string) =>
    ipcRenderer.invoke('omnibox:suggest', { input }) as Promise<Suggestion[]>,
  navigate: (input: string, url?: string) =>
    ipcRenderer.invoke('nav:go', { input, url }) as Promise<void>,
  back: () => ipcRenderer.invoke('nav:back') as Promise<void>,
  forward: () => ipcRenderer.invoke('nav:forward') as Promise<void>,
  reload: (ignoreCache = false) =>
    ipcRenderer.invoke('nav:reload', { ignoreCache }) as Promise<void>,
  stop: () => ipcRenderer.invoke('nav:stop') as Promise<void>,
  home: () => ipcRenderer.invoke('nav:home') as Promise<void>,
  zoom: (direction) => ipcRenderer.invoke('zoom:set', { direction }) as Promise<void>,
  createTab: (url?: string, background?: boolean) =>
    ipcRenderer.invoke('tabs:create', { url, background }) as Promise<void>,
  closeTab: (id: number) => ipcRenderer.invoke('tabs:close', { id }) as Promise<void>,
  freezeTab: (id: number) => ipcRenderer.invoke('tabs:freeze', { id }) as Promise<void>,
  freezeInactive: () => ipcRenderer.invoke('tabs:freeze-inactive') as Promise<number>,
  selectTab: (id: number) => ipcRenderer.invoke('tabs:select', { id }) as Promise<void>,
  moveTab: (id: number, index: number) =>
    ipcRenderer.invoke('tabs:move', { id, index }) as Promise<void>,
  reopenTab: () => ipcRenderer.invoke('tabs:reopen') as Promise<void>,
  muteTab: () => ipcRenderer.invoke('tabs:mute') as Promise<void>,
  toggleBookmark: () => ipcRenderer.invoke('bookmark:toggle') as Promise<boolean>,
  find: (text: string, forward = true, findNext = false) =>
    ipcRenderer.invoke('find:start', { text, forward, findNext }) as Promise<void>,
  stopFind: () => ipcRenderer.invoke('find:stop') as Promise<void>,
  setOverlay: (open: boolean) => ipcRenderer.invoke('ui:overlay', { open }) as Promise<void>,
  minimize: () => ipcRenderer.invoke('window:minimize') as Promise<void>,
  maximize: () => ipcRenderer.invoke('window:maximize') as Promise<void>,
  close: () => ipcRenderer.invoke('window:close') as Promise<void>,
  newWindow: (privateMode = false) =>
    ipcRenderer.invoke('window:new', { private: privateMode }) as Promise<void>,
  command: (action: string) => ipcRenderer.invoke('ui:command', { command: action }) as Promise<void>,
  openPage: (page: string) =>
    ipcRenderer.invoke('tabs:create', { url: `lomesearch://${page}` }) as Promise<void>,
  onState: (callback) => subscribe<ChromeState>('chrome:state', callback),
  onPreview: (callback) => subscribe<{ id: number; data: string }>('chrome:preview', callback),
  onFindResult: (callback) => subscribe<FindResult>('chrome:find-result', callback),
  onFocusOmnibox: (callback) => subscribe<void>('chrome:focus-omnibox', callback),
  onFocusFind: (callback) => subscribe<void>('chrome:focus-find', callback),
  onSettingsChanged: (callback) => subscribe<Settings>('settings:changed', callback),
  onDownloads: (callback) => subscribe<DownloadState[]>('downloads:update', callback),
};

contextBridge.exposeInMainWorld('lome', api);
