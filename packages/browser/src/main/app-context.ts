import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { app, nativeTheme, session, type ContextMenuParams, type Session } from 'electron';
import { BrowserWindowController, type WindowOptions } from './browser-window.js';
import { DownloadManager } from './downloads.js';
import { EngineManager } from './engine.js';
import { ExtensionManager } from './extensions.js';
import { PermissionManager } from './permissions.js';
import { PrivacyManager } from './privacy.js';
import { AppStore, type StoredWindowSession } from './store.js';
import { showContextMenu } from './context-menu.js';
import { installInternalProtocol } from './internal-pages.js';
import type { Tab } from './tabs.js';

/**
 * Application-level wiring: stores, the engine process, privacy, downloads,
 * extensions, permissions and the set of open windows. The window controller
 * stays free of app lifecycle concerns; everything shared lives here.
 */
export class AppContext {
  readonly store: AppStore;
  readonly engine: EngineManager;
  readonly privacy: PrivacyManager;
  readonly downloads: DownloadManager;
  readonly extensions: ExtensionManager;
  readonly permissions: PermissionManager;
  readonly windows = new Set<BrowserWindowController>();
  readonly isDev: boolean;
  readonly pagePreload: string;
  readonly chromePreload: string;
  private readonly rendererDir: string;
  quitting = false;

  private readonly configuredSessions = new Set<string>();
  private lastFocused: BrowserWindowController | null = null;

  constructor(
    userDataDir: string,
    downloadDir: string,
    preloadDir: string,
    rendererDir: string,
    isDev: boolean,
  ) {
    this.isDev = isDev;
    this.rendererDir = rendererDir;
    this.pagePreload = join(preloadDir, 'page.cjs');
    this.chromePreload = join(preloadDir, 'chrome.cjs');
    this.store = new AppStore(userDataDir, downloadDir);
    this.privacy = new PrivacyManager(this.store);
    this.permissions = new PermissionManager(this.store);
    this.downloads = new DownloadManager(this.store, (items) => {
      this.broadcast('downloads:update', items);
      this.scheduleAll();
    });
    this.extensions = new ExtensionManager(this.store, () => {
      this.broadcast('extensions:update', this.extensions.list());
    });
    this.engine = new EngineManager(
      this.store,
      (status) => {
        this.broadcast('engine:status', status);
        this.scheduleAll();
      },
      (line) => console.log(line),
    );
    nativeTheme.themeSource = this.store.settings.value.theme;
  }

  async initialise(): Promise<void> {
    this.configureSession(session.defaultSession, false);
    await this.extensions.loadAll(session.defaultSession);
    await this.privacy.loadRemoteBlocklist();
    await this.engine.start();
  }

  createWindow(options: Omit<WindowOptions, 'session'>): BrowserWindowController {
    const ses = options.isPrivate
      ? session.fromPartition(`private-${randomUUID()}`, { cache: false })
      : session.defaultSession;
    this.configureSession(ses, options.isPrivate);
    const controller = new BrowserWindowController(this, { ...options, session: ses });
    this.windows.add(controller);
    this.lastFocused = controller;
    controller.window.on('focus', () => {
      this.lastFocused = controller;
    });
    return controller;
  }

  openUrlInNewWindow(url: string, isPrivate: boolean): void {
    this.createWindow({ isPrivate, urls: [url] });
  }

  focused(): BrowserWindowController | null {
    if (this.lastFocused && !this.lastFocused.window.isDestroyed()) return this.lastFocused;
    const first = this.windows.values().next().value as BrowserWindowController | undefined;
    return first ?? null;
  }

  windowForWebContents(id: number): BrowserWindowController | null {
    for (const controller of this.windows) {
      if (controller.chromeView.webContents.id === id) return controller;
      if (controller.tabs.byWebContentsId(id)) return controller;
    }
    return null;
  }

  tabUrl(webContentsId: number): string | undefined {
    for (const controller of this.windows) {
      const tab = controller.tabs.byWebContentsId(webContentsId);
      if (tab) return tab.url;
    }
    return undefined;
  }

  onBlocked(webContentsId: number | undefined, _domain: string): void {
    if (webContentsId === undefined) return;
    const controller = this.windowForWebContents(webContentsId);
    controller?.scheduleState();
  }

  onClosed(controller: BrowserWindowController): void {
    this.windows.delete(controller);
    if (this.lastFocused === controller) this.lastFocused = null;
    this.saveSession();
    if (this.windows.size === 0 && !this.quitting && process.platform !== 'darwin') {
      app.quit();
    }
  }

  onContextMenu(controller: BrowserWindowController, tab: Tab, params: ContextMenuParams): void {
    showContextMenu(this, controller, tab, params);
  }

  broadcast(channel: string, payload: unknown): void {
    for (const controller of this.windows) {
      if (!controller.chromeView.webContents.isDestroyed()) {
        controller.chromeView.webContents.send(channel, payload);
      }
      for (const tab of controller.tabs.all()) {
        const contents = tab.contents;
        if (contents && !contents.isDestroyed() && tab.url.startsWith('lomesearch://')) {
          contents.send(channel, payload);
        }
      }
    }
  }

  scheduleAll(): void {
    for (const controller of this.windows) controller.scheduleState();
  }

  saveSession(): void {
    const snapshots: StoredWindowSession[] = [];
    for (const controller of this.windows) {
      if (controller.isPrivate) continue;
      const snapshot = controller.sessionSnapshot();
      if (snapshot.urls.length > 0) snapshots.push(snapshot);
    }
    this.store.saveSession(snapshots);
  }

  async shutdown(): Promise<void> {
    this.quitting = true;
    this.saveSession();
    if (this.store.settings.value.privacy.clearOnExit) {
      await this.privacy.clearData(session.defaultSession, {
        cookies: true,
        cache: true,
        localStorage: true,
      });
    }
    await this.engine.stop();
    this.store.flushAll();
  }

  private configureSession(ses: Session, isPrivate: boolean): void {
    const key = isPrivate ? `private:${ses.storagePath ?? randomUUID()}` : 'default';
    if (this.configuredSessions.has(key)) return;
    this.configuredSessions.add(key);
    installInternalProtocol(ses, this.rendererDir);
    this.privacy.configure(ses, {
      tabUrl: (id) => this.tabUrl(id),
      onBlocked: (id, domain) => this.onBlocked(id, domain),
    });
    this.permissions.configure(ses);
    this.downloads.attach(ses, { private: isPrivate });
    const spellchecker = this.store.settings.value.privacy.spellchecker;
    ses.setSpellCheckerEnabled(spellchecker);
    if (spellchecker) ses.setSpellCheckerLanguages(['it', 'en-US']);
  }
}
