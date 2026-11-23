import { Menu, app, shell, type MenuItemConstructorOptions } from 'electron';
import type { InternalPage } from '../shared/constants.js';
import { internalUrl } from './internal-pages.js';
import type { BrowserWindowController } from './browser-window.js';

/**
 * Native application menu.
 *
 * Accelerators live here rather than in a keydown handler so that they work
 * while a page has focus, including inside iframes and extensions. Every entry
 * maps to a window command or an internal page.
 */

export interface MenuContext {
  focused(): BrowserWindowController | null;
  newWindow(privateMode: boolean): void;
  quit(): void;
  showAbout(): void;
}

export function buildAppMenu(ctx: MenuContext): Menu {
  const isMac = process.platform === 'darwin';
  const win = (): BrowserWindowController | null => ctx.focused();
  const page = (name: InternalPage): void => {
    const controller = win();
    if (controller) controller.createTab(internalUrl(name));
    else ctx.newWindow(false);
  };

  const template: MenuItemConstructorOptions[] = [];

  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }

  template.push({
    label: 'File',
    submenu: [
      {
        label: 'Nuova scheda',
        accelerator: 'CmdOrCtrl+T',
        click: () => win()?.createTab(),
      },
      {
        label: 'Nuova finestra',
        accelerator: 'CmdOrCtrl+N',
        click: () => ctx.newWindow(false),
      },
      {
        label: 'Finestra privata',
        accelerator: 'CmdOrCtrl+Shift+N',
        click: () => ctx.newWindow(true),
      },
      { type: 'separator' },
      {
        label: 'Chiudi scheda',
        accelerator: 'CmdOrCtrl+W',
        click: () => {
          const controller = win();
          const active = controller?.tabs.active();
          if (controller && active) controller.closeTab(active.id);
        },
      },
      {
        label: 'Riapri scheda chiusa',
        accelerator: 'CmdOrCtrl+Shift+T',
        click: () => win()?.reopenClosedTab(),
      },
      {
        label: 'Scheda successiva',
        accelerator: 'Ctrl+Tab',
        click: () => win()?.tabs.cycle(1),
      },
      {
        label: 'Scheda precedente',
        accelerator: 'Ctrl+Shift+Tab',
        click: () => win()?.tabs.cycle(-1),
      },
      { type: 'separator' },
      {
        label: 'Salva pagina con nome…',
        accelerator: 'CmdOrCtrl+S',
        click: () => win()?.savePage(),
      },
      {
        label: 'Stampa…',
        accelerator: 'CmdOrCtrl+P',
        click: () => win()?.printPage(),
      },
      { type: 'separator' },
      {
        label: 'Esci',
        accelerator: 'CmdOrCtrl+Q',
        click: () => ctx.quit(),
      },
    ],
  });

  template.push({
    label: 'Modifica',
    submenu: [
      { role: 'undo', label: 'Annulla' },
      { role: 'redo', label: 'Ripeti' },
      { type: 'separator' },
      { role: 'cut', label: 'Taglia' },
      { role: 'copy', label: 'Copia' },
      { role: 'paste', label: 'Incolla' },
      { role: 'pasteAndMatchStyle', label: 'Incolla senza formattazione' },
      { role: 'selectAll', label: 'Seleziona tutto' },
      { type: 'separator' },
      {
        label: 'Trova nella pagina',
        accelerator: 'CmdOrCtrl+F',
        click: () => win()?.focusFindBar(),
      },
      {
        label: 'Trova successivo',
        accelerator: 'CmdOrCtrl+G',
        click: () => win()?.findNext(),
      },
      {
        label: 'Trova precedente',
        accelerator: 'CmdOrCtrl+Shift+G',
        click: () => win()?.findPrevious(),
      },
    ],
  });

  template.push({
    label: 'Visualizza',
    submenu: [
      {
        label: 'Ricarica',
        accelerator: 'CmdOrCtrl+R',
        click: () => win()?.reload(false),
      },
      {
        label: 'Ricarica senza cache',
        accelerator: 'CmdOrCtrl+Shift+R',
        click: () => win()?.reload(true),
      },
      { type: 'separator' },
      { label: 'Zoom avanti', accelerator: 'CmdOrCtrl+Plus', click: () => win()?.zoom(1) },
      { label: 'Zoom indietro', accelerator: 'CmdOrCtrl+-', click: () => win()?.zoom(-1) },
      { label: 'Zoom 100%', accelerator: 'CmdOrCtrl+0', click: () => win()?.zoom(0) },
      { type: 'separator' },
      { label: 'Schermo intero', accelerator: 'F11', click: () => win()?.toggleFullScreen() },
      {
        label: 'Strumenti per sviluppatori',
        accelerator: 'CmdOrCtrl+Shift+I',
        click: () => win()?.toggleDevTools(),
      },
    ],
  });

  template.push({
    label: 'Vai',
    submenu: [
      { label: 'Indietro', accelerator: 'Alt+Left', click: () => win()?.back() },
      { label: 'Avanti', accelerator: 'Alt+Right', click: () => win()?.forward() },
      {
        label: 'Home',
        accelerator: 'Alt+Home',
        click: () => win()?.goHome(),
      },
      {
        label: 'Barra degli indirizzi',
        accelerator: 'CmdOrCtrl+L',
        click: () => win()?.focusOmnibox(),
      },
      { type: 'separator' },
      { label: 'Preferiti', accelerator: 'CmdOrCtrl+Shift+O', click: () => page('bookmarks') },
      { label: 'Cronologia', accelerator: 'CmdOrCtrl+H', click: () => page('history') },
      { label: 'Download', accelerator: 'CmdOrCtrl+J', click: () => page('downloads') },
      { label: 'Estensioni', click: () => page('extensions') },
      { label: 'Privacy', click: () => page('privacy') },
      { type: 'separator' },
      { label: 'Impostazioni', accelerator: 'CmdOrCtrl+,', click: () => page('settings') },
    ],
  });

  template.push({
    label: 'Preferiti',
    submenu: [
      {
        label: 'Aggiungi o rimuovi preferito',
        accelerator: 'CmdOrCtrl+D',
        click: () => win()?.toggleBookmark(),
      },
      { label: 'Gestisci preferiti', click: () => page('bookmarks') },
    ],
  });

  template.push({
    label: 'Aiuto',
    submenu: [
      { label: 'Informazioni su LomeSearch', click: () => ctx.showAbout() },
      { label: 'Privacy e dati locali', click: () => page('privacy') },
      {
        label: 'Documentazione',
        click: () => void shell.openExternal('https://github.com/ciao22king/LomeSearch'),
      },
    ],
  });

  return Menu.buildFromTemplate(template);
}
