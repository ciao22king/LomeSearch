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
        label: 'New tab',
        accelerator: 'CmdOrCtrl+T',
        click: () => win()?.createTab(),
      },
      {
        label: 'New window',
        accelerator: 'CmdOrCtrl+N',
        click: () => ctx.newWindow(false),
      },
      {
        label: 'Private window',
        accelerator: 'CmdOrCtrl+Shift+N',
        click: () => ctx.newWindow(true),
      },
      { type: 'separator' },
      {
        label: 'Close tab',
        accelerator: 'CmdOrCtrl+W',
        click: () => {
          const controller = win();
          const active = controller?.tabs.active();
          if (controller && active) controller.closeTab(active.id);
        },
      },
      {
        label: 'Reopen closed tab',
        accelerator: 'CmdOrCtrl+Shift+T',
        click: () => win()?.reopenClosedTab(),
      },
      {
        label: 'Next tab',
        accelerator: 'Ctrl+Tab',
        click: () => win()?.tabs.cycle(1),
      },
      {
        label: 'Previous tab',
        accelerator: 'Ctrl+Shift+Tab',
        click: () => win()?.tabs.cycle(-1),
      },
      { type: 'separator' },
      {
        label: 'Save page as…',
        accelerator: 'CmdOrCtrl+S',
        click: () => win()?.savePage(),
      },
      {
        label: 'Print…',
        accelerator: 'CmdOrCtrl+P',
        click: () => win()?.printPage(),
      },
      { type: 'separator' },
      {
        label: 'Quit',
        accelerator: 'CmdOrCtrl+Q',
        click: () => ctx.quit(),
      },
    ],
  });

  template.push({
    label: 'Edit',
    submenu: [
      { role: 'undo', label: 'Undo' },
      { role: 'redo', label: 'Redo' },
      { type: 'separator' },
      { role: 'cut', label: 'Cut' },
      { role: 'copy', label: 'Copy' },
      { role: 'paste', label: 'Paste' },
      { role: 'pasteAndMatchStyle', label: 'Paste and match style' },
      { role: 'selectAll', label: 'Select all' },
      { type: 'separator' },
      {
        label: 'Find in page',
        accelerator: 'CmdOrCtrl+F',
        click: () => win()?.focusFindBar(),
      },
      {
        label: 'Find next',
        accelerator: 'CmdOrCtrl+G',
        click: () => win()?.findNext(),
      },
      {
        label: 'Find previous',
        accelerator: 'CmdOrCtrl+Shift+G',
        click: () => win()?.findPrevious(),
      },
    ],
  });

  template.push({
    label: 'View',
    submenu: [
      {
        label: 'Reload',
        accelerator: 'CmdOrCtrl+R',
        click: () => win()?.reload(false),
      },
      {
        label: 'Reload ignoring cache',
        accelerator: 'CmdOrCtrl+Shift+R',
        click: () => win()?.reload(true),
      },
      { type: 'separator' },
      { label: 'Zoom in', accelerator: 'CmdOrCtrl+Plus', click: () => win()?.zoom(1) },
      { label: 'Zoom out', accelerator: 'CmdOrCtrl+-', click: () => win()?.zoom(-1) },
      { label: 'Actual size', accelerator: 'CmdOrCtrl+0', click: () => win()?.zoom(0) },
      { type: 'separator' },
      { label: 'Full screen', accelerator: 'F11', click: () => win()?.toggleFullScreen() },
      {
        label: 'Developer tools',
        accelerator: 'CmdOrCtrl+Shift+I',
        click: () => win()?.toggleDevTools(),
      },
    ],
  });

  template.push({
    label: 'Go',
    submenu: [
      { label: 'Back', accelerator: 'Alt+Left', click: () => win()?.back() },
      { label: 'Forward', accelerator: 'Alt+Right', click: () => win()?.forward() },
      {
        label: 'Home',
        accelerator: 'Alt+Home',
        click: () => win()?.goHome(),
      },
      {
        label: 'Address bar',
        accelerator: 'CmdOrCtrl+L',
        click: () => win()?.focusOmnibox(),
      },
      { type: 'separator' },
      { label: 'Bookmarks', accelerator: 'CmdOrCtrl+Shift+O', click: () => page('bookmarks') },
      { label: 'History', accelerator: 'CmdOrCtrl+H', click: () => page('history') },
      { label: 'Downloads', accelerator: 'CmdOrCtrl+J', click: () => page('downloads') },
      { label: 'Extensions', click: () => page('extensions') },
      { label: 'Privacy', click: () => page('privacy') },
      { type: 'separator' },
      { label: 'Settings', accelerator: 'CmdOrCtrl+,', click: () => page('settings') },
    ],
  });

  template.push({
    label: 'Bookmarks',
    submenu: [
      {
        label: 'Bookmark this page',
        accelerator: 'CmdOrCtrl+D',
        click: () => win()?.toggleBookmark(),
      },
      { label: 'Manage bookmarks', click: () => page('bookmarks') },
    ],
  });

  template.push({
    label: 'Help',
    submenu: [
      { label: 'About LomeSearch', click: () => ctx.showAbout() },
      { label: 'Privacy and local data', click: () => page('privacy') },
      { label: 'Legal and licences', click: () => page('legal') },
      {
        label: 'Documentation',
        click: () => void shell.openExternal('https://github.com/ciao22king/LomeSearch'),
      },
    ],
  });

  return Menu.buildFromTemplate(template);
}
