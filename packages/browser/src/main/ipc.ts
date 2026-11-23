import { randomBytes } from 'node:crypto';
import { app, clipboard, ipcMain, nativeTheme, session, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import type { AppContext } from './app-context.js';
import type { BrowserWindowController } from './browser-window.js';
import { internalUrl } from './internal-pages.js';
import { buildSearchUrl, displayUrl, searchSuggestions } from './search.js';
import { INTERNAL_PAGES, PAGE_TITLES, type InternalPage } from '../shared/constants.js';
import type {
  AppInfo,
  Bookmark,
  ChromeState,
  ClearDataOptions,
  DownloadState,
  EngineStatus,
  ExtensionInfo,
  PrivacyReport,
  Settings,
  Suggestion,
} from '../shared/types.js';

/**
 * IPC surface.
 *
 * Two kinds of callers exist: the chrome UI (tab strip and toolbar) and the
 * internal pages. Both are trusted, but only after their sender is matched to a
 * known window and the frame URL is verified. Web content has no access to any
 * of these channels: its preload only exposes a synchronous configuration read.
 */

const fingerprintSeed = randomBytes(16).toString('hex');

export function registerIpc(ctx: AppContext): void {
  const windowOf = (event: IpcMainInvokeEvent | IpcMainEvent): BrowserWindowController => {
    const controller = ctx.windowForWebContents(event.sender.id);
    if (!controller) throw new Error('finestra non riconosciuta');
    return controller;
  };
  const trusted = (event: IpcMainInvokeEvent | IpcMainEvent): BrowserWindowController => {
    const controller = windowOf(event);
    const isChrome = controller.chromeView.webContents.id === event.sender.id;
    const frameUrl = event.senderFrame?.url ?? '';
    if (!isChrome && !frameUrl.startsWith('lomesearch://')) {
      throw new Error('operazione non consentita da questa pagina');
    }
    return controller;
  };
  const handle = (
    channel: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    listener: (event: IpcMainInvokeEvent, payload?: any) => unknown,
  ): void => {
    ipcMain.handle(channel, (event, payload) => {
      trusted(event);
      return listener(event, payload);
    });
  };

  // ------------------------------------------------------------- application

  ipcMain.handle('app:info', (): AppInfo => ({
    appVersion: app.getVersion(),
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? '',
    node: process.versions.node,
    v8: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
    engineVersion: ctx.engine.getStatus().version,
    userData: app.getPath('userData'),
  }));

  handle('app:state', (event): ChromeState => windowOf(event).buildState());
  handle('app:quit', () => {
    app.quit();
  });
  handle('app:open-data-dir', () => shell.openPath(app.getPath('userData')));
  handle('app:open-downloads-dir', () =>
    shell.openPath(ctx.store.settings.value.downloads.directory || app.getPath('downloads')),
  );

  ipcMain.on('page:config', (event) => {
    event.returnValue = {
      fingerprintProtection: ctx.store.settings.value.privacy.fingerprintProtection,
      fingerprintSeed,
      theme: ctx.store.settings.value.theme,
      isPrivate: ctx.windowForWebContents(event.sender.id)?.isPrivate ?? false,
      version: app.getVersion(),
    };
  });

  // ------------------------------------------------------------------ window

  handle('window:minimize', (event) => windowOf(event).minimize());
  handle('window:maximize', (event) => windowOf(event).toggleMaximize());
  handle('window:close', (event) => windowOf(event).closeWindow());
  handle('window:new', (_event, options: { private?: boolean } | undefined) => {
    ctx.createWindow({ isPrivate: options?.private === true });
  });

  // -------------------------------------------------------------------- tabs

  handle('tabs:create', (event, options: { url?: string; background?: boolean } | undefined) => {
    const controller = windowOf(event);
    const url = options?.url && /^(https?|lomesearch):/i.test(options.url)
      ? options.url
      : internalUrl('newtab');
    controller.createTab(url, { background: options?.background });
  });
  handle('tabs:close', (event, payload: { id: number }) => windowOf(event).closeTab(payload.id));
  handle('tabs:select', (event, payload: { id: number }) => windowOf(event).selectTab(payload.id));
  handle('tabs:move', (event, payload: { id: number; index: number }) =>
    windowOf(event).moveTab(payload.id, payload.index),
  );
  handle('tabs:reopen', (event) => windowOf(event).reopenClosedTab());
  handle('tabs:mute', (event) => windowOf(event).toggleMute());

  // -------------------------------------------------------------- navigation

  handle('nav:go', (event, payload: { input: string; url?: string }) => {
    const controller = windowOf(event);
    if (payload.url) {
      if (!/^(https?|lomesearch):/i.test(payload.url)) throw new Error('schema non consentito');
      controller.loadUrl(payload.url);
    } else {
      controller.navigate(payload.input);
    }
  });
  handle('nav:back', (event) => windowOf(event).back());
  handle('nav:forward', (event) => windowOf(event).forward());
  handle('nav:reload', (event, payload: { ignoreCache?: boolean } | undefined) =>
    windowOf(event).reload(payload?.ignoreCache === true),
  );
  handle('nav:stop', (event) => windowOf(event).stop());
  handle('nav:home', (event) => windowOf(event).goHome());
  handle('zoom:set', (event, payload: { direction: 1 | -1 | 0 }) =>
    windowOf(event).zoom(payload.direction),
  );
  handle('find:start', (event, payload: { text: string; forward?: boolean; findNext?: boolean }) =>
    windowOf(event).find(payload.text, payload.forward ?? true, payload.findNext ?? false),
  );
  handle('find:stop', (event) => windowOf(event).stopFind());

  handle('bookmark:toggle', (event) => windowOf(event).toggleBookmark());

  // ---------------------------------------------------------------- overlays

  handle('ui:overlay', (event, payload: { open: boolean }) => {
    const controller = windowOf(event);
    controller.setOverlay(payload.open);
    if (!payload.open) controller.tabs.active()?.webContents.focus();
  });
  handle('ui:focus-omnibox', (event) => windowOf(event).focusOmnibox());
  handle('ui:find-focus', (event) => windowOf(event).focusFindBar());

  // ---------------------------------------------------------------- omnibox

  handle('omnibox:suggest', async (_event, payload: { input: string }): Promise<Suggestion[]> => {
    const settings = ctx.store.settings.value;
    const status = ctx.engine.getStatus();
    const input = payload.input;
    const base = searchSuggestions(input, settings, status);
    const seen = new Set(base.map((suggestion) => suggestion.url));
    const query = input.trim().toLowerCase();
    if (!query) return base;

    if (settings.suggestFromEngine && settings.searchEngine === 'local' && status.running) {
      const terms = await ctx.engine.suggest(input);
      for (const term of terms) {
        const url = buildSearchUrl(settings, status, term);
        if (seen.has(url)) continue;
        seen.add(url);
        base.push({ type: 'search', title: term, subtitle: 'Ricerca nell’indice locale', url });
      }
    }
    if (settings.suggestFromHistory) {
      for (const entry of ctx.store.searchHistory(query, 5)) {
        if (seen.has(entry.url)) continue;
        seen.add(entry.url);
        base.push({
          type: 'history',
          title: entry.title,
          subtitle: displayUrl(entry.url),
          url: entry.url,
        });
      }
    }
    for (const bookmark of ctx.store.listBookmarks()) {
      if (base.length >= 8) break;
      if (seen.has(bookmark.url)) continue;
      if (!bookmark.title.toLowerCase().includes(query) && !bookmark.url.toLowerCase().includes(query)) continue;
      seen.add(bookmark.url);
      base.push({
        type: 'bookmark',
        title: bookmark.title,
        subtitle: displayUrl(bookmark.url),
        url: bookmark.url,
      });
    }
    return base.slice(0, 8);
  });

  // ------------------------------------------------------------------ search

  handle('engine:status', (): EngineStatus => ctx.engine.getStatus());
  handle('engine:restart', async () => {
    await ctx.engine.restart();
    return ctx.engine.getStatus();
  });
  handle('engine:search', async (_event, payload: { query: string; limit?: number; offset?: number }) =>
    ctx.engine.search(payload.query, { limit: payload.limit, offset: payload.offset }),
  );
  handle('engine:suggest', async (_event, payload: { query: string }) => ctx.engine.suggest(payload.query));

  // ---------------------------------------------------------------- settings

  handle('settings:get', (): Settings => ctx.store.settings.value);
  handle('settings:update', (event, patch: Partial<Settings>): Settings => {
    const before = ctx.store.settings.value;
    const next = ctx.store.updateSettings(patch);
    if (next.theme !== before.theme) nativeTheme.themeSource = next.theme;
    const engineChanged =
      next.engine.port !== before.engine.port ||
      next.engine.autoStart !== before.engine.autoStart ||
      next.engine.dataDir !== before.engine.dataDir ||
      next.engine.executable !== before.engine.executable;
    if (engineChanged) void ctx.engine.restart();
    if (patch.privacy?.remoteBlocklist !== undefined) void ctx.privacy.loadRemoteBlocklist();
    ctx.broadcast('settings:changed', next);
    ctx.scheduleAll();
    return next;
  });

  // ----------------------------------------------------------------- history

  handle('history:list', (_event, payload: { query?: string; limit?: number } | undefined) =>
    ctx.store.listHistory(payload?.query ?? '', payload?.limit ?? 300),
  );
  handle('history:remove', (_event, payload: { id: string }) => {
    ctx.store.removeHistory(payload.id);
    return ctx.store.listHistory();
  });
  handle('history:clear', () => {
    ctx.store.clearHistory();
    ctx.broadcast('history:update', []);
    return [];
  });

  // --------------------------------------------------------------- bookmarks

  handle('bookmarks:list', (): Bookmark[] => ctx.store.listBookmarks());
  handle('bookmarks:remove', (_event, payload: { url: string }) => {
    ctx.store.removeBookmark(payload.url);
    ctx.scheduleAll();
    return ctx.store.listBookmarks();
  });
  handle('bookmarks:add', (_event, payload: { url: string; title: string }) => {
    const bookmark = ctx.store.addBookmark(payload.url, payload.title);
    ctx.scheduleAll();
    return bookmark;
  });

  // --------------------------------------------------------------- downloads

  handle('downloads:list', (): DownloadState[] => ctx.downloads.list());
  handle('downloads:cancel', (_event, payload: { id: string }) => ctx.downloads.cancel(payload.id));
  handle('downloads:pause', (_event, payload: { id: string }) => ctx.downloads.pause(payload.id));
  handle('downloads:resume', (_event, payload: { id: string }) => ctx.downloads.resume(payload.id));
  handle('downloads:open', async (_event, payload: { id: string }) => ctx.downloads.open(payload.id));
  handle('downloads:show', (_event, payload: { id: string }) => ctx.downloads.showInFolder(payload.id));
  handle('downloads:clear', () => {
    ctx.downloads.clear();
    return ctx.downloads.list();
  });

  // -------------------------------------------------------------- extensions

  handle('extensions:list', (): ExtensionInfo[] => ctx.extensions.list());
  handle('extensions:load', async () => {
    const directory = await ctx.extensions.pickDirectory();
    if (!directory) return ctx.extensions.list();
    await ctx.extensions.loadPath(session.defaultSession, directory);
    return ctx.extensions.list();
  });
  handle('extensions:remove', async (_event, payload: { path: string }) => {
    await ctx.extensions.remove(session.defaultSession, payload.path);
    return ctx.extensions.list();
  });
  handle('extensions:toggle', async (_event, payload: { path: string; enabled: boolean }) => {
    await ctx.extensions.setEnabled(session.defaultSession, payload.path, payload.enabled);
    return ctx.extensions.list();
  });
  handle('extensions:reveal', (_event, payload: { path: string }) => shell.openPath(payload.path));

  // ----------------------------------------------------------------- privacy

  handle('privacy:report', (): PrivacyReport => ({
    summary: ctx.privacy.summary(),
    exceptions: ctx.store.listExceptions(),
    settings: ctx.store.settings.value.privacy,
  }));
  handle('privacy:set-exception', (_event, payload: { domain: string; blockTrackers: boolean }) => {
    ctx.store.setException(payload.domain, payload.blockTrackers);
    ctx.scheduleAll();
    return ctx.store.listExceptions();
  });
  handle('privacy:remove-exception', (_event, payload: { domain: string }) => {
    ctx.store.removeException(payload.domain);
    return ctx.store.listExceptions();
  });
  handle('privacy:clear-data', async (_event, options: ClearDataOptions) => {
    await ctx.privacy.clearData(session.defaultSession, options);
    ctx.broadcast('privacy:update', ctx.privacy.summary());
    ctx.scheduleAll();
    return ctx.privacy.summary();
  });

  // ------------------------------------------------------------- internal pages

  handle('page:navigate', (event, payload: { url: string }) => {
    if (!/^(https?|lomesearch):/i.test(payload.url)) throw new Error('schema non consentito');
    windowOf(event).loadUrl(payload.url);
  });
  handle('page:open-page', (event, payload: { page: InternalPage }) => {
    if (!(INTERNAL_PAGES as readonly string[]).includes(payload.page)) {
      throw new Error('pagina sconosciuta');
    }
    windowOf(event).loadUrl(internalUrl(payload.page));
  });
  handle('page:search', (event, payload: { query: string; local?: boolean }) => {
    const settings = ctx.store.settings.value;
    const effective = payload.local ? { ...settings, searchEngine: 'local' as const } : settings;
    windowOf(event).loadUrl(buildSearchUrl(effective, ctx.engine.getStatus(), payload.query));
  });
  handle('page:open-new-tab', (event, payload: { url: string }) => {
    if (!/^(https?|lomesearch):/i.test(payload.url)) throw new Error('schema non consentito');
    windowOf(event).createTab(payload.url);
  });
  handle('page:copy', (_event, payload: { text: string }) => clipboard.writeText(payload.text));
  handle('page:titles', () => PAGE_TITLES);

  handle('shell:open-external', async (_event, payload: { url: string }) => {
    if (!/^(https?|mailto):/i.test(payload.url)) throw new Error('schema non consentito');
    await shell.openExternal(payload.url);
  });

  handle('ui:command', (event, payload: { command: string }) => {
    const controller = windowOf(event);
    switch (payload.command) {
      case 'new-tab':
        controller.createTab();
        break;
      case 'new-window':
        ctx.createWindow({ isPrivate: false });
        break;
      case 'private-window':
        ctx.createWindow({ isPrivate: true });
        break;
      case 'reopen-tab':
        controller.reopenClosedTab();
        break;
      case 'history':
      case 'bookmarks':
      case 'downloads':
      case 'extensions':
      case 'settings':
      case 'privacy':
      case 'about':
        controller.createTab(internalUrl(payload.command));
        break;
      case 'find':
        controller.focusFindBar();
        break;
      case 'print':
        controller.printPage();
        break;
      case 'save-page':
        void controller.savePage();
        break;
      case 'devtools':
        controller.toggleDevTools();
        break;
      case 'zoom-in':
        controller.zoom(1);
        break;
      case 'zoom-out':
        controller.zoom(-1);
        break;
      case 'zoom-reset':
        controller.zoom(0);
        break;
      case 'fullscreen':
        controller.toggleFullScreen();
        break;
      case 'mute':
        controller.toggleMute();
        break;
      case 'reload':
        controller.reload(false);
        break;
      case 'reload-hard':
        controller.reload(true);
        break;
      case 'back':
        controller.back();
        break;
      case 'forward':
        controller.forward();
        break;
      case 'home':
        controller.goHome();
        break;
      case 'quit':
        app.quit();
        break;
      default:
        break;
    }
  });

  handle('app:clear-data', async (_event, options: ClearDataOptions) => {
    await ctx.privacy.clearData(session.defaultSession, options);
    ctx.broadcast('privacy:update', ctx.privacy.summary());
    ctx.broadcast('history:update', ctx.store.listHistory());
    ctx.scheduleAll();
    return { ok: true };
  });

}
