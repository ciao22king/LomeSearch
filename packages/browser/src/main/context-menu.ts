import { Menu, clipboard, type ContextMenuParams, type MenuItemConstructorOptions } from 'electron';
import type { AppContext } from './app-context.js';
import type { BrowserWindowController } from './browser-window.js';
import type { Tab } from './tabs.js';
import { buildSearchUrl } from './search.js';
import type { Settings } from '../shared/types.js';

/**
 * Right-click menu.
 *
 * Contextual actions are generated from what was clicked: a link, a selection,
 * an image or an editable field. The search entries always offer the local
 * index in addition to the configured default engine.
 */
export function showContextMenu(
  ctx: AppContext,
  win: BrowserWindowController,
  tab: Tab,
  params: ContextMenuParams,
): void {
  const settings = ctx.store.settings.value;
  const status = ctx.engine.getStatus();
  const localSettings: Settings = { ...settings, searchEngine: 'local' };
  const localSearch = (query: string): string => buildSearchUrl(localSettings, status, query);
  const items: MenuItemConstructorOptions[] = [];

  if (params.misspelledWord) {
    for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
      items.push({
        label: suggestion,
        click: () => tab.webContents.replaceMisspelling(suggestion),
      });
    }
    if (params.dictionarySuggestions.length > 0) items.push({ type: 'separator' });
  }

  if (params.linkURL) {
    items.push(
      { label: 'Open link in new tab', click: () => win.createTab(params.linkURL) },
      {
        label: 'Open link in private window',
        click: () => ctx.openUrlInNewWindow(params.linkURL, true),
      },
      {
        label: 'Copy link address',
        click: () => clipboard.writeText(params.linkURL),
      },
      {
        label: 'Search the link in the local index',
        click: () => win.createTab(localSearch(params.linkURL)),
      },
      { type: 'separator' },
    );
  }

  if (params.mediaType === 'image' && params.srcURL) {
    items.push(
      { label: 'Open image in new tab', click: () => win.createTab(params.srcURL) },
      { label: 'Copy image address', click: () => clipboard.writeText(params.srcURL) },
      {
        label: 'Save image as…',
        click: () => tab.webContents.downloadURL(params.srcURL),
      },
      { type: 'separator' },
    );
  }

  if (params.selectionText.trim()) {
    const selection = params.selectionText.trim();
    const short = selection.length > 40 ? `${selection.slice(0, 40)}…` : selection;
    items.push(
      { role: 'copy', label: 'Copy' },
      {
        label: `Search “${short}” with ${settings.searchEngine === 'local' ? 'LomeSearch' : 'the default engine'}`,
        click: () => win.createTab(buildSearchUrl(settings, status, selection)),
      },
      {
        label: 'Search the local index',
        click: () => win.createTab(localSearch(selection)),
      },
      { type: 'separator' },
    );
  }

  if (params.isEditable) {
    items.push(
      { role: 'undo', label: 'Undo' },
      { role: 'redo', label: 'Redo' },
      { type: 'separator' },
      { role: 'cut', label: 'Cut' },
      { role: 'copy', label: 'Copy' },
      { role: 'paste', label: 'Paste' },
      { role: 'selectAll', label: 'Select all' },
      { type: 'separator' },
    );
  }

  if (items.length > 0 && items[items.length - 1]?.type !== 'separator') {
    items.push({ type: 'separator' });
  }

  const bookmarked = ctx.store.isBookmarked(tab.url);
  items.push(
    {
      label: bookmarked ? 'Remove bookmark' : 'Bookmark this page',
      click: () => {
        if (bookmarked) ctx.store.removeBookmark(tab.url);
        else ctx.store.addBookmark(tab.url, tab.title);
        win.scheduleState();
      },
    },
    {
      label: 'Copy page address',
      enabled: Boolean(tab.url),
      click: () => clipboard.writeText(tab.url),
    },
    { type: 'separator' },
    { label: 'Back', enabled: tab.webContents.navigationHistory.canGoBack(), click: () => win.back() },
    { label: 'Forward', enabled: tab.webContents.navigationHistory.canGoForward(), click: () => win.forward() },
    { label: 'Reload', click: () => win.reload(false) },
    { type: 'separator' },
    {
      label: 'Inspect element',
      click: () => {
        tab.webContents.inspectElement(params.x, params.y);
      },
    },
  );

  Menu.buildFromTemplate(items).popup({ window: win.window });
}
