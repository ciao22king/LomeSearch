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
      { label: 'Apri link in nuova scheda', click: () => win.createTab(params.linkURL) },
      {
        label: 'Apri link in finestra privata',
        click: () => ctx.openUrlInNewWindow(params.linkURL, true),
      },
      {
        label: 'Copia indirizzo del link',
        click: () => clipboard.writeText(params.linkURL),
      },
      {
        label: 'Cerca il link nell’indice locale',
        click: () => win.createTab(localSearch(params.linkURL)),
      },
      { type: 'separator' },
    );
  }

  if (params.mediaType === 'image' && params.srcURL) {
    items.push(
      { label: 'Apri immagine in nuova scheda', click: () => win.createTab(params.srcURL) },
      { label: 'Copia indirizzo immagine', click: () => clipboard.writeText(params.srcURL) },
      {
        label: 'Salva immagine con nome…',
        click: () => tab.webContents.downloadURL(params.srcURL),
      },
      { type: 'separator' },
    );
  }

  if (params.selectionText.trim()) {
    const selection = params.selectionText.trim();
    const short = selection.length > 40 ? `${selection.slice(0, 40)}…` : selection;
    items.push(
      { role: 'copy', label: 'Copia' },
      {
        label: `Cerca “${short}” con ${settings.searchEngine === 'local' ? 'LomeSearch' : 'il motore predefinito'}`,
        click: () => win.createTab(buildSearchUrl(settings, status, selection)),
      },
      {
        label: 'Cerca nell’indice locale',
        click: () => win.createTab(localSearch(selection)),
      },
      { type: 'separator' },
    );
  }

  if (params.isEditable) {
    items.push(
      { role: 'undo', label: 'Annulla' },
      { role: 'redo', label: 'Ripeti' },
      { type: 'separator' },
      { role: 'cut', label: 'Taglia' },
      { role: 'copy', label: 'Copia' },
      { role: 'paste', label: 'Incolla' },
      { role: 'selectAll', label: 'Seleziona tutto' },
      { type: 'separator' },
    );
  }

  if (items.length > 0 && items[items.length - 1]?.type !== 'separator') {
    items.push({ type: 'separator' });
  }

  const bookmarked = ctx.store.isBookmarked(tab.url);
  items.push(
    {
      label: bookmarked ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti',
      click: () => {
        if (bookmarked) ctx.store.removeBookmark(tab.url);
        else ctx.store.addBookmark(tab.url, tab.title);
        win.scheduleState();
      },
    },
    {
      label: 'Copia indirizzo della pagina',
      enabled: Boolean(tab.url),
      click: () => clipboard.writeText(tab.url),
    },
    { type: 'separator' },
    { label: 'Indietro', enabled: tab.webContents.navigationHistory.canGoBack(), click: () => win.back() },
    { label: 'Avanti', enabled: tab.webContents.navigationHistory.canGoForward(), click: () => win.forward() },
    { label: 'Ricarica', click: () => win.reload(false) },
    { type: 'separator' },
    {
      label: 'Ispeziona elemento',
      click: () => {
        tab.webContents.inspectElement(params.x, params.y);
      },
    },
  );

  Menu.buildFromTemplate(items).popup({ window: win.window });
}
