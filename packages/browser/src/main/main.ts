import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, Menu } from 'electron';
import { AppContext } from './app-context.js';
import { registerIpc } from './ipc.js';
import { buildAppMenu } from './menu.js';
import { internalUrl, registerInternalScheme } from './internal-pages.js';
import type { Settings } from '../shared/types.js';

/**
 * Entry point.
 *
 * Order matters: privileged schemes, DNS-over-HTTPS and the user-agent have to
 * be configured before `ready`; everything else (sessions, protocol handler,
 * engine, windows) happens once Electron is up.
 */

app.setName('LomeSearch');
if (process.platform === 'win32') app.setAppUserModelId('dev.lomesearch.browser');

const userDataDir = safePath('userData');
const earlySettings = readEarlySettings(userDataDir);
applyPrivacySwitches(earlySettings);
registerInternalScheme();
app.userAgentFallback = app.userAgentFallback
  .replace(/\sElectron\/[\d.]+/i, '')
  .replace(/\slomesearch\/[\d.]+/i, '');

const isDev = !app.isPackaged;
let context: AppContext | null = null;
let shuttingDown = false;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const window = context?.focused();
    if (window) {
      if (window.window.isMinimized()) window.window.restore();
      window.window.focus();
    }
  });

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', (event) => {
    if (shuttingDown) return;
    shuttingDown = true;
    event.preventDefault();
    void (context?.shutdown() ?? Promise.resolve()).finally(() => app.quit());
  });

  app
    .whenReady()
    .then(async () => {
      context = new AppContext(
        userDataDir,
        downloadDir(),
        join(app.getAppPath(), 'dist', 'preload'),
        join(app.getAppPath(), 'dist', 'renderer'),
        isDev,
      );
      registerIpc(context);
      Menu.setApplicationMenu(
        buildAppMenu({
          focused: () => context?.focused() ?? null,
          newWindow: (privateMode) => context?.createWindow({ isPrivate: privateMode }),
          quit: () => app.quit(),
          showAbout: () => {
            const window = context?.focused();
            if (window) window.createTab(internalUrl('about'));
            else void context?.createWindow({ isPrivate: false, urls: [internalUrl('about')] });
          },
        }),
      );
      app.setAboutPanelOptions({
        applicationName: 'LomeSearch',
        applicationVersion: app.getVersion(),
        copyright: 'Apache-2.0',
        credits: 'Motore di ricerca locale, senza tracciamento.',
      });

      await context.initialise();
      createStartupWindows(context);

      app.on('activate', () => {
        if (context && context.windows.size === 0) {
          context.createWindow({ isPrivate: false, urls: [internalUrl('newtab')] });
        }
      });
    })
    .catch((error: unknown) => {
      console.error('LomeSearch failed to start:', error);
      app.quit();
    });
}

function createStartupWindows(ctx: AppContext): void {
  const settings = ctx.store.settings.value;
  const saved = ctx.store.savedSession();
  if (settings.startup === 'restore' && settings.restoreSession && saved.length > 0) {
    for (const entry of saved) {
      if (entry.urls.length === 0) continue;
      ctx.createWindow({
        isPrivate: false,
        urls: entry.urls,
        activeIndex: entry.activeIndex,
      });
    }
    if (ctx.windows.size > 0) return;
  }
  const urls =
    settings.startup === 'homepage' && settings.homepage
      ? [settings.homepage]
      : [internalUrl('newtab')];
  ctx.createWindow({ isPrivate: false, urls });
}

function downloadDir(): string {
  const downloads = safePath('downloads');
  return downloads === safePath('home') ? join(downloads, 'Downloads') : downloads;
}

function safePath(name: 'userData' | 'downloads' | 'home'): string {
  try {
    return app.getPath(name);
  } catch {
    return process.cwd();
  }
}

function readEarlySettings(dir: string): Settings | null {
  try {
    const raw = readFileSync(join(dir, 'settings.json'), 'utf8');
    return JSON.parse(raw) as Settings;
  } catch {
    return null;
  }
}

function applyPrivacySwitches(settings: Settings | null): void {
  if (settings?.privacy?.dnsOverHttps === false) return;
  app.commandLine.appendSwitch('enable-features', 'DnsOverHttps');
  app.commandLine.appendSwitch(
    'dns-over-https-templates',
    'https://cloudflare-dns.com/dns-query{?dns}',
  );
}

process.on('uncaughtException', (error) => {
  console.error('uncaught exception:', error);
});
process.on('unhandledRejection', (reason) => {
  console.error('unhandled rejection:', reason);
});
