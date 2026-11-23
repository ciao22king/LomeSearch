import { WebContentsView, type ContextMenuParams, type FoundInPageResult, type Session, type WebContents } from 'electron';
import type { TabState } from '../shared/types.js';

/**
 * Tabs.
 *
 * Each tab is a WebContentsView with its own renderer process. The chrome UI
 * lives in a separate view owned by the window, so a crashed or hung page never
 * takes the browser interface down with it.
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
  readonly view: WebContentsView;
  readonly isPrivate: boolean;
  title = 'Nuova scheda';
  url = '';
  favicon = '';
  loading = false;
  crashed = false;
  blocked = 0;

  constructor(
    id: number,
    session: Session,
    preloadPath: string,
    isPrivate: boolean,
    private readonly events: TabEvents,
  ) {
    this.id = id;
    this.isPrivate = isPrivate;
    this.view = new WebContentsView({
      webPreferences: {
        preload: preloadPath,
        session,
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
  }

  get webContents(): WebContents {
    return this.view.webContents;
  }

  load(url: string): void {
    void this.webContents.loadURL(url).catch(() => {
      // Failures surface through did-fail-load; this catch only silences the
      // rejected promise that Electron returns for aborted navigations.
    });
  }

  state(): TabState {
    const history = this.webContents.navigationHistory;
    return {
      id: this.id,
      url: this.url,
      title: this.title,
      favicon: this.favicon,
      loading: this.loading,
      canGoBack: history.canGoBack(),
      canGoForward: history.canGoForward(),
      isPrivate: this.isPrivate,
      blocked: this.blocked,
      audible: this.webContents.isCurrentlyAudible(),
      muted: this.webContents.isAudioMuted(),
      crashed: this.crashed,
    };
  }

  destroy(): void {
    try {
      this.webContents.close();
    } catch {
      // Already destroyed.
    }
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
    return this.tabs.find((tab) => !tab.webContents.isDestroyed() && tab.webContents.id === id);
  }

  activeIdValue(): number | null {
    return this.activeId;
  }

  create(url: string, options: { background?: boolean; index?: number } = {}): Tab {
    const tab = new Tab(this.nextId++, this.session, this.preloadPath, this.isPrivate, this.events);
    const index = options.index ?? this.tabs.length;
    this.tabs.splice(index, 0, tab);
    tab.load(url);
    if (!options.background) this.activeId = tab.id;
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
