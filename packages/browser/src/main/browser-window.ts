import { join } from 'node:path';
import { BaseWindow, WebContentsView, app, dialog, type ContextMenuParams, type FoundInPageResult, type Session } from 'electron';
import type { ChromeState } from '../shared/types.js';
import { CHROME_HEIGHT } from '../shared/constants.js';
import { internalUrl, isInternalPage } from './internal-pages.js';
import { resolveInput } from './search.js';
import type { AppStore } from './store.js';
import type { EngineManager } from './engine.js';
import type { PrivacyManager } from './privacy.js';
import type { DownloadManager } from './downloads.js';
import type { ExtensionManager } from './extensions.js';
import { TabManager, type Tab } from './tabs.js';

/**
 * One browser window: a frameless BaseWindow, a chrome view with the tab strip
 * and toolbar, and the WebContentsView of the active tab.
 *
 * The chrome view normally occupies only the top strip. When a dropdown, menu
 * or the find bar opens, it is expanded over the page with a transparent
 * background, which keeps overlays inside one renderer and avoids a second
 * window per menu.
 */

export interface WindowContext {
  store: AppStore;
  engine: EngineManager;
  privacy: PrivacyManager;
  downloads: DownloadManager;
  extensions: ExtensionManager;
  pagePreload: string;
  chromePreload: string;
  isDev: boolean;
  openUrlInNewWindow(url: string, isPrivate: boolean): void;
  onClosed(window: BrowserWindowController): void;
  onContextMenu(window: BrowserWindowController, tab: Tab, params: ContextMenuParams): void;
}

export interface WindowOptions {
  isPrivate: boolean;
  session: Session;
  urls?: string[];
  activeIndex?: number;
  width?: number;
  height?: number;
}

export class BrowserWindowController {
  readonly window: BaseWindow;
  readonly chromeView: WebContentsView;
  readonly tabs: TabManager;
  readonly isPrivate: boolean;

  private readonly attached = new Set<number>();
  private overlay = false;
  private contentFullscreen = false;
  private stateTimer: NodeJS.Timeout | null = null;
  private closed = false;
  private lastFind = '';

  constructor(
    private readonly ctx: WindowContext,
    options: WindowOptions,
  ) {
    this.isPrivate = options.isPrivate;
    this.window = new BaseWindow({
      width: options.width ?? 1240,
      height: options.height ?? 820,
      minWidth: 560,
      minHeight: 420,
      frame: false,
      show: false,
      title: 'LomeSearch',
      backgroundColor: '#fbfbf9',
      titleBarStyle: process.platform === 'darwin' ? 'hidden' : 'default',
      trafficLightPosition: { x: 12, y: 12 },
    });

    this.chromeView = new WebContentsView({
      webPreferences: {
        preload: ctx.chromePreload,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    this.chromeView.setBackgroundColor('#00000000');
    this.chromeView.webContents.on('will-navigate', (event) => event.preventDefault());
    this.window.contentView.addChildView(this.chromeView);
    void this.chromeView.webContents.loadFile(join(app.getAppPath(), 'dist', 'renderer', 'chrome.html'));

    this.tabs = new TabManager(options.session, ctx.pagePreload, options.isPrivate, {
      onChanged: (tab) => this.onTabChanged(tab),
      onNavigate: (tab, url) => this.onNavigate(tab, url),
      onContextMenu: (tab, params) => this.ctx.onContextMenu(this, tab, params),
      onWindowOpen: (tab, url) => this.onWindowOpen(tab, url),
      onFindResult: (tab, result) => this.onFindResult(tab, result),
      onFailLoad: (tab, code, description, url, isMainFrame) =>
        this.onFailLoad(tab, code, description, url, isMainFrame),
      onRenderGone: (tab) => this.onRenderGone(tab),
      onFullscreen: (tab, entering) => this.onContentFullscreen(tab, entering),
      onFocusOmnibox: () => this.focusOmnibox(),
    });

    const urls = options.urls && options.urls.length > 0 ? options.urls : [internalUrl('newtab')];
    const activeIndex = Math.max(0, Math.min(options.activeIndex ?? 0, urls.length - 1));
    urls.forEach((url, index) => {
      this.tabs.create(url, { background: index !== activeIndex });
    });

    this.window.on('resize', () => this.layout());
    this.window.on('maximize', () => {
      this.layout();
      this.scheduleState();
    });
    this.window.on('unmaximize', () => {
      this.layout();
      this.scheduleState();
    });
    this.window.on('enter-full-screen', () => this.scheduleState());
    this.window.on('leave-full-screen', () => this.scheduleState());
    this.window.on('closed', () => {
      this.closed = true;
      if (this.stateTimer) clearTimeout(this.stateTimer);
      this.tabs.destroyAll();
      this.ctx.onClosed(this);
    });

    this.chromeView.webContents.once('did-finish-load', () => {
      this.window.show();
      this.pushState();
    });

    this.syncViews();
    this.layout();
  }

  // ------------------------------------------------------------------ layout

  layout(): void {
    if (this.closed || this.window.isDestroyed()) return;
    const size = this.window.getContentSize();
    const width = size[0] ?? 800;
    const height = size[1] ?? 600;
    const chromeHeight = this.contentFullscreen ? 0 : this.overlay ? height : CHROME_HEIGHT;
    this.chromeView.setBounds({ x: 0, y: 0, width, height: chromeHeight });
    const active = this.tabs.active();
    if (active) {
      active.view.setBounds({
        x: 0,
        y: this.contentFullscreen ? 0 : CHROME_HEIGHT,
        width,
        height: this.contentFullscreen ? height : Math.max(0, height - CHROME_HEIGHT),
      });
    }
  }

  private syncViews(): void {
    const active = this.tabs.active();
    for (const tab of this.tabs.all()) {
      if (tab === active) {
        if (!this.attached.has(tab.id)) {
          this.window.contentView.addChildView(tab.view, 0);
          this.attached.add(tab.id);
        }
      } else if (this.attached.has(tab.id)) {
        this.window.contentView.removeChildView(tab.view);
        this.attached.delete(tab.id);
      }
    }
  }

  setOverlay(open: boolean): void {
    if (this.overlay === open) return;
    this.overlay = open;
    this.layout();
  }

  private onContentFullscreen(_tab: Tab, entering: boolean): void {
    this.contentFullscreen = entering;
    this.window.setFullScreen(entering);
    this.layout();
    this.scheduleState();
  }

  // ------------------------------------------------------------------- state

  scheduleState(): void {
    if (this.stateTimer || this.closed) return;
    this.stateTimer = setTimeout(() => {
      this.stateTimer = null;
      this.pushState();
    }, 20);
  }

  buildState(): ChromeState {
    const active = this.tabs.active();
    return {
      tabs: this.tabs.all().map((tab) => {
        tab.blocked = this.ctx.privacy.tabBlocked(tab.webContents.id);
        return tab.state();
      }),
      activeTabId: this.tabs.activeIdValue(),
      window: {
        maximized: this.window.isMaximized(),
        fullScreen: this.window.isFullScreen(),
        isPrivate: this.isPrivate,
      },
      engine: this.ctx.engine.getStatus(),
      privacy: this.ctx.privacy.summary(),
      downloads: this.ctx.downloads.list(),
      canReopen: this.tabs.canReopen(),
      bookmarked: active ? this.ctx.store.isBookmarked(active.url) : false,
    };
  }

  pushState(): void {
    if (this.closed || this.chromeView.webContents.isDestroyed()) return;
    this.chromeView.webContents.send('chrome:state', this.buildState());
  }

  // ---------------------------------------------------------------- commands

  createTab(url = internalUrl('newtab'), options: { background?: boolean } = {}): Tab {
    const tab = this.tabs.create(url, options);
    this.syncViews();
    this.layout();
    this.scheduleState();
    return tab;
  }

  closeTab(id: number): void {
    this.tabs.close(id);
    this.ctx.privacy.resetTab(id);
    this.syncViews();
    this.layout();
    this.scheduleState();
    if (this.tabs.all().length === 0) this.window.close();
  }

  selectTab(id: number): void {
    this.tabs.select(id);
    this.syncViews();
    this.layout();
    this.scheduleState();
    const tab = this.tabs.get(id);
    tab?.webContents.focus();
  }

  moveTab(id: number, index: number): void {
    this.tabs.move(id, index);
    this.scheduleState();
  }

  reopenClosedTab(): void {
    const tab = this.tabs.reopenClosed();
    if (!tab) return;
    this.syncViews();
    this.layout();
    this.scheduleState();
  }

  navigate(input: string): void {
    const tab = this.tabs.active();
    if (!tab) return;
    const resolution = resolveInput(input, this.ctx.store.settings.value, this.ctx.engine.getStatus());
    tab.load(resolution.url);
    tab.webContents.focus();
  }

  loadUrl(url: string): void {
    this.tabs.active()?.load(url);
  }

  back(): void {
    const tab = this.tabs.active();
    if (tab?.webContents.navigationHistory.canGoBack()) tab.webContents.navigationHistory.goBack();
  }

  forward(): void {
    const tab = this.tabs.active();
    if (tab?.webContents.navigationHistory.canGoForward()) tab.webContents.navigationHistory.goForward();
  }

  reload(ignoreCache = false): void {
    const tab = this.tabs.active();
    if (!tab) return;
    if (ignoreCache) tab.webContents.reloadIgnoringCache();
    else tab.webContents.reload();
  }

  stop(): void {
    this.tabs.active()?.webContents.stop();
  }

  zoom(direction: 1 | -1 | 0): void {
    const tab = this.tabs.active();
    if (!tab) return;
    const current = tab.webContents.getZoomLevel();
    const next = direction === 0 ? 0 : Math.max(-3, Math.min(5, current + direction * 0.5));
    tab.webContents.setZoomLevel(next);
  }

  toggleMute(): void {
    const tab = this.tabs.active();
    if (!tab) return;
    tab.webContents.setAudioMuted(!tab.webContents.isAudioMuted());
    this.scheduleState();
  }

  find(text: string, forward = true, findNext = false): void {
    const tab = this.tabs.active();
    if (!tab) return;
    this.lastFind = text;
    if (!text) {
      tab.webContents.stopFindInPage('clearSelection');
      return;
    }
    tab.webContents.findInPage(text, { forward, findNext });
  }

  findNext(): void {
    if (this.lastFind) this.find(this.lastFind, true, true);
    else this.focusFindBar();
  }

  findPrevious(): void {
    if (this.lastFind) this.find(this.lastFind, false, true);
    else this.focusFindBar();
  }

  focusFindBar(): void {
    this.chromeView.webContents.focus();
    this.chromeView.webContents.send('chrome:focus-find');
  }

  stopFind(): void {
    this.tabs.active()?.webContents.stopFindInPage('clearSelection');
  }

  toggleDevTools(): void {
    const tab = this.tabs.active();
    if (!tab) return;
    const contents = tab.webContents;
    if (contents.isDevToolsOpened()) contents.closeDevTools();
    else contents.openDevTools({ mode: 'detach' });
  }

  printPage(): void {
    const tab = this.tabs.active();
    if (tab) void tab.webContents.print({});
  }

  async savePage(): Promise<void> {
    const tab = this.tabs.active();
    if (!tab) return;
    const suggested = `${(tab.title || 'pagina').replace(/[^\w\- ]+/g, '').trim() || 'pagina'}.html`;
    const result = await dialog.showSaveDialog(this.window, {
      title: 'Salva pagina',
      defaultPath: join(this.ctx.store.settings.value.downloads.directory, suggested),
      filters: [
        { name: 'Pagina web completa', extensions: ['html'] },
        { name: 'Solo HTML', extensions: ['html'] },
      ],
    });
    if (result.canceled || !result.filePath) return;
    await tab.webContents.savePage(result.filePath, 'HTMLComplete');
  }

  toggleFullScreen(): void {
    this.window.setFullScreen(!this.window.isFullScreen());
  }

  goHome(): void {
    this.navigate(this.ctx.store.settings.value.homepage || internalUrl('newtab'));
  }

  focusOmnibox(): void {
    this.chromeView.webContents.focus();
    this.chromeView.webContents.send('chrome:focus-omnibox');
  }

  toggleBookmark(): boolean {
    const tab = this.tabs.active();
    if (!tab) return false;
    const bookmarked = this.ctx.store.isBookmarked(tab.url);
    if (bookmarked) this.ctx.store.removeBookmark(tab.url);
    else this.ctx.store.addBookmark(tab.url, tab.title);
    this.scheduleState();
    return !bookmarked;
  }

  minimize(): void {
    this.window.minimize();
  }

  toggleMaximize(): void {
    if (this.window.isMaximized()) this.window.unmaximize();
    else this.window.maximize();
  }

  closeWindow(): void {
    this.window.close();
  }

  sessionSnapshot(): { isPrivate: boolean; urls: string[]; activeIndex: number } {
    const tabs = this.tabs.all();
    const active = this.tabs.activeIdValue();
    const urls = tabs.map((tab) => tab.url || internalUrl('newtab')).filter((url) => !url.startsWith('data:'));
    const activeIndex = Math.max(0, tabs.findIndex((tab) => tab.id === active));
    return { isPrivate: this.isPrivate, urls, activeIndex };
  }

  // ------------------------------------------------------------ tab events

  private onTabChanged(tab: Tab): void {
    if (!this.isPrivate && /^https?:/i.test(tab.url) && tab.title && tab.title !== tab.url) {
      this.ctx.store.updateHistoryTitle(tab.url, tab.title);
    }
    if (tab === this.tabs.active()) {
      this.syncViews();
      this.layout();
      if (!this.overlay) this.scheduleState();
    }
    this.scheduleState();
  }

  private onNavigate(tab: Tab, url: string): void {
    if (this.isPrivate) return;
    if (!/^https?:/i.test(url)) return;
    this.ctx.store.recordVisit(url, tab.title);
    if (tab === this.tabs.active()) this.scheduleState();
  }

  private onWindowOpen(source: Tab, url: string): void {
    if (!url) return;
    if (/^https?:|^lomesearch:/i.test(url)) {
      this.createTab(url);
      return;
    }
    if (url.startsWith('blob:') || url.startsWith('data:')) {
      // Blob and data URLs only make sense in the opener's context.
      source.load(url);
    }
  }

  private onFindResult(tab: Tab, result: FoundInPageResult): void {
    if (tab !== this.tabs.active()) return;
    this.chromeView.webContents.send('chrome:find-result', {
      matches: result.matches,
      activeMatch: result.activeMatchOrdinal,
    });
  }

  private onFailLoad(tab: Tab, code: number, description: string, url: string, isMainFrame: boolean): void {
    if (!isMainFrame) return;
    const settings = this.ctx.store.settings.value;
    if (
      settings.privacy.httpsFirst &&
      url.startsWith('https://') &&
      (code === -202 || code === -101 || code === -501)
    ) {
      this.ctx.privacy.allowHttpFallback(url);
      tab.load(url.replace(/^https:\/\//, 'http://'));
      return;
    }
    if (code === -3) return;
    this.showErrorPage(tab, code, description, url);
  }

  private showErrorPage(tab: Tab, code: number, description: string, url: string): void {
    const params = new URLSearchParams({ code: String(code), description, url });
    tab.load(`lomesearch://error?${params.toString()}`);
  }

  private onRenderGone(tab: Tab): void {
    if (tab === this.tabs.active()) this.scheduleState();
  }
}

export function isInternalNavigation(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'lomesearch:' && isInternalPage(parsed.hostname);
  } catch {
    return false;
  }
}
