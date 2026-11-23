import { WebContentsView, type ContextMenuParams, type FoundInPageResult, type Session, type WebContents } from 'electron';
import type { TabState } from '../shared/types.js';

/**
 * Tabs.
 *
 * Each tab is a WebContentsView with its own renderer process. The chrome UI
 * lives in a separate view owned by the window, so a crashed or hung page never
 * takes the browser interface down with it.
 *
 * A tab can be frozen: its view is destroyed, URL and title stay, and the page
 * is reloaded when the tab is selected again. That is what makes idle tabs
 * cheap: no renderer, no timers, no document in memory. The scroll offset
 * survives a freeze and is restored after the reload.
 */

export interface TabEvents {
  onChanged(tab: Tab): void;
  onNavigate(tab: Tab, url: string): void;
  onContextMenu(tab: Tab, params: ContextMenuParams): void;
  onWindowOpen(tab: Tab, url: string): void;
  onFindResult(tab: Tab, result: FoundInPageResult): void;
  onFailLoad(tab: Tab, errorCode: number, errorDescription: string, url: string, isMainFrame: boolean): void;
  onRenderGone(tab: Tab): void;
  onFullscreen(tab: Tab, entering: boolean): void;
  onFocusOmnibox(): void;
}

export class Tab {
  readonly id: number;
  readonly isPrivate: boolean;
  view: WebContentsView | null = null;
  title = '';
  url = '';
  favicon = '';
  loading = false;
  crashed = false;
  blocked = 0;
  frozen = false;
  hasPreview = false;
  lastActive = Date.now();

  private scroll: { x: number; y: number } | null = null;

  constructor(
    id: number,
    private readonly session: Session,
    private readonly preloadPath: string,
    isPrivate: boolean,
    private readonly events: TabEvents,
  ) {
    this.id = id;
    this.isPrivate = isPrivate;
    this.ensureView();
  }

  get webContents(): WebContents {
    if (!this.view) throw new Error('tab is frozen');
    return this.view.webContents;
  }

  get contents(): WebContents | null {
    return this.view ? this.view.webContents : null;
  }

  get live(): boolean {
    return this.view !== null;
  }

  load(url: string): void {
    this.url = url;
    this.ensureView();
    void this.webContents.loadURL(url).catch(() => {
      // Failures surface through did-fail-load; this catch only silences the
      // rejected promise that Electron returns for aborted navigations.
    });
  }

  state(): TabState {
    const contents = this.contents;
    const alive = contents !== null && !contents.isDestroyed();
    return {
      id: this.id,
      url: this.url,
      title: this.title,
      favicon: this.favicon,
      loading: this.loading,
      canGoBack: alive ? contents.navigationHistory.canGoBack() : false,
      canGoForward: alive ? contents.navigationHistory.canGoForward() : false,
      isPrivate: this.isPrivate,
      blocked: this.blocked,
      audible: alive ? contents.isCurrentlyAudible() : false,
      muted: alive ? contents.isAudioMuted() : false,
      crashed: this.crashed,
      frozen: this.frozen,
      hasPreview: this.hasPreview,
      lastActive: this.lastActive,
    };
  }

  /** Reads the scroll offset so a thaw can put the page back where it was. */
  async rememberScroll(): Promise<void> {
    if (!this.view || this.view.webContents.isDestroyed()) return;
    try {
      const position = (await this.webContents.executeJavaScript('({ x: scrollX, y: scrollY })', true)) as {
        x?: number;
        y?: number;
      };
      if (typeof position?.x === 'number' && typeof position?.y === 'number') {
        this.scroll = { x: position.x, y: position.y };
      }
    } catch {
      // Pages that refuse script injection simply lose the offset.
    }
  }

  freeze(): void {
    if (!this.view) return;
    try {
      this.webContents.close();
    } catch {
      // Already gone.
    }
    this.view = null;
    this.frozen = true;
    this.loading = false;
    this.events.onChanged(this);
  }

  thaw(): void {
    if (this.view) return;
    this.frozen = false;
    this.ensureView();
    if (this.scroll) {
      const { x, y } = this.scroll;
      this.scroll = null;
      this.webContents.once('did-finish-load', () => {
        void this.webContents.executeJavaScript(`scrollTo(${x}, ${y})`, true).catch(() => {});
      });
    }
    if (this.url) this.load(this.url);
    this.events.onChanged(this);
  }

  destroy(): void {
    try {
      this.view?.webContents.close();
    } catch {
      // Already destroyed.
    }
    this.view = null;
  }

  private ensureView(): WebContentsView {
    if (this.view) return this.view;
    this.view = new WebContentsView({
      webPreferences: {
        preload: this.preloadPath,
        session: this.session,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        safeDialogs: true,
        spellcheck: true,
        backgroundThrottling: true,
        autoplayPolicy: 'document-user-activation-required',
      },
    });
    this.view.setBackgroundColor('#ffffff');
    this.wire();
    return this.view;
  }

  private wire(): void {
    const contents = this.webContents;

    contents.on('did-start-loading', () => {
      this.loading = true;
      this.crashed = false;
      this.events.onChanged(this);
    });
    contents.on('did-stop-loading', () => {
      this.loading = false;
      this.events.onChanged(this);
    });
    contents.on('page-title-updated', (_event, title) => {
      this.title = title || this.url;
      this.events.onChanged(this);
    });
    contents.on('page-favicon-updated', (_event, favicons) => {
      this.favicon = favicons[0] ?? '';
      this.events.onChanged(this);
    });
    contents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      if (input.key === 'F5') {
        event.preventDefault();
        if (input.control || input.shift) contents.reloadIgnoringCache();
        else contents.reload();
      } else if (input.key === 'F6') {
        event.preventDefault();
        this.events.onFocusOmnibox();
      }
    });
    contents.on('did-navigate', (_event, url) => {
      this.url = url;
      this.events.onNavigate(this, url);
      this.events.onChanged(this);
    });
    contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (!isMainFrame) return;
      this.url = url;
      this.events.onNavigate(this, url);
      this.events.onChanged(this);
    });
    contents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (errorCode === -3) return; // ERR_ABORTED, usually a superseded navigation
      this.events.onFailLoad(this, errorCode, errorDescription, validatedURL, isMainFrame);
    });
    contents.on('render-process-gone', () => {
      this.crashed = true;
      this.events.onRenderGone(this);
      this.events.onChanged(this);
    });
    contents.on('context-menu', (_event, params) => this.events.onContextMenu(this, params));
    contents.on('found-in-page', (_event, result) => this.events.onFindResult(this, result));
    contents.on('enter-html-full-screen', () => this.events.onFullscreen(this, true));
    contents.on('leave-html-full-screen', () => this.events.onFullscreen(this, false));
    contents.on('audio-state-changed', () => this.events.onChanged(this));
    contents.on('media-started-playing', () => this.events.onChanged(this));
    contents.on('media-paused', () => this.events.onChanged(this));
    contents.setWindowOpenHandler(({ url }) => {
      this.events.onWindowOpen(this, url);
      return { action: 'deny' };
    });
    contents.on('will-navigate', (event, url) => {
      if (!/^(https?:|lomesearch:)/i.test(url)) event.preventDefault();
    });
  }
}

export interface ClosedTab {
  url: string;
  title: string;
}

export interface CreateTabOptions {
  background?: boolean;
  index?: number;
  /** Create the tab without a renderer; the page loads when it is selected. */
  lazy?: boolean;
}

export class TabManager {
  private tabs: Tab[] = [];
  private activeId: number | null = null;
  private readonly closed: ClosedTab[] = [];
  private nextId = 1;

  constructor(
    private readonly session: Session,
    private readonly preloadPath: string,
    private readonly isPrivate: boolean,
    private readonly events: TabEvents,
  ) {}

  all(): Tab[] {
    return this.tabs;
  }

  active(): Tab | null {
    return this.tabs.find((tab) => tab.id === this.activeId) ?? null;
  }

  get(id: number): Tab | undefined {
    return this.tabs.find((tab) => tab.id === id);
  }

  byWebContentsId(id: number): Tab | undefined {
    return this.tabs.find((tab) => tab.contents !== null && !tab.contents.isDestroyed() && tab.contents.id === id);
  }

  activeIdValue(): number | null {
    return this.activeId;
  }

  create(url: string, options: CreateTabOptions = {}): Tab {
    const tab = new Tab(this.nextId++, this.session, this.preloadPath, this.isPrivate, this.events);
    const index = options.index ?? this.tabs.length;
    this.tabs.splice(index, 0, tab);
    if (options.lazy) {
      tab.url = url;
      tab.frozen = true;
      tab.destroy();
    } else {
      tab.load(url);
    }
    if (!options.background) {
      this.activeId = tab.id;
      tab.lastActive = Date.now();
    }
    this.events.onChanged(tab);
    return tab;
  }

  close(id: number): void {
    const index = this.tabs.findIndex((tab) => tab.id === id);
    if (index === -1) return;
    const tab = this.tabs[index]!;
    if (tab.url && !tab.url.startsWith('lomesearch://newtab')) {
      this.closed.push({ url: tab.url, title: tab.title });
      if (this.closed.length > 25) this.closed.shift();
    }
    this.tabs.splice(index, 1);
    tab.destroy();
    if (this.activeId === id) {
      const next = this.tabs[Math.min(index, this.tabs.length - 1)];
      this.activeId = next?.id ?? null;
      if (next) this.events.onChanged(next);
    }
    this.events.onChanged(tab);
  }

  select(id: number): void {
    const tab = this.get(id);
    if (!tab || this.activeId === id) return;
    this.activeId = id;
    tab.lastActive = Date.now();
    this.events.onChanged(tab);
  }

  move(id: number, index: number): void {
    const current = this.tabs.findIndex((tab) => tab.id === id);
    if (current === -1) return;
    const [tab] = this.tabs.splice(current, 1);
    if (!tab) return;
    const target = Math.max(0, Math.min(index, this.tabs.length));
    this.tabs.splice(target, 0, tab);
    this.events.onChanged(tab);
  }

  selectIndex(index: number): void {
    const tab = this.tabs[index];
    if (tab) this.select(tab.id);
  }

  cycle(direction: 1 | -1): void {
    if (this.tabs.length < 2) return;
    const current = this.tabs.findIndex((tab) => tab.id === this.activeId);
    const next = (current + direction + this.tabs.length) % this.tabs.length;
    this.select(this.tabs[next]!.id);
  }

  reopenClosed(): Tab | null {
    const entry = this.closed.pop();
    if (!entry) return null;
    return this.create(entry.url);
  }

  canReopen(): boolean {
    return this.closed.length > 0;
  }

  destroyAll(): void {
    for (const tab of this.tabs) tab.destroy();
    this.tabs = [];
    this.activeId = null;
  }
}
