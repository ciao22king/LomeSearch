import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { shell, type DownloadItem, type Session } from 'electron';
import type { DownloadState } from '../shared/types.js';
import type { AppStore } from './store.js';

/**
 * Download tracking.
 *
 * Chromium performs the transfer; this class keeps a list the UI can render,
 * asks for a destination when configured, avoids overwriting existing files and
 * exposes open/show/cancel/clear actions. Finished entries survive restarts.
 */
export class DownloadManager {
  private readonly items = new Map<string, DownloadState>();
  private readonly electronItems = new Map<string, DownloadItem>();

  constructor(
    private readonly store: AppStore,
    private readonly onUpdate: (items: DownloadState[]) => void,
  ) {
    for (const item of store.listDownloads()) this.items.set(item.id, item);
  }

  attach(session: Session, options: { private?: boolean } = {}): void {
    session.on('will-download', (_event, item) => {
      const id = randomUUID();
      const settings = this.store.settings.value.downloads;
      if (!settings.askWhereToSave && settings.directory) {
        item.setSavePath(uniquePath(settings.directory, item.getFilename()));
      }
      if (options.private) return;
      const state: DownloadState = {
        id,
        filename: item.getFilename(),
        url: item.getURL(),
        state: 'progressing',
        received: item.getReceivedBytes(),
        total: item.getTotalBytes(),
        savePath: item.getSavePath(),
        startedAt: Date.now(),
      };
      this.items.set(id, state);
      this.electronItems.set(id, item);
      this.publish();

      item.on('updated', (_event, stateName) => {
        const current = this.items.get(id);
        if (!current) return;
        current.received = item.getReceivedBytes();
        current.total = item.getTotalBytes();
        current.savePath = item.getSavePath() || current.savePath;
        current.state = stateName === 'interrupted' ? 'interrupted' : 'progressing';
        this.publish();
      });
      item.once('done', (_event, stateName) => {
        const current = this.items.get(id);
        if (!current) return;
        current.received = item.getReceivedBytes();
        current.total = item.getTotalBytes() || current.received;
        current.savePath = item.getSavePath() || current.savePath;
        current.state = stateName;
        this.electronItems.delete(id);
        this.persist();
        this.publish();
      });
    });
  }

  list(): DownloadState[] {
    return [...this.items.values()].sort((a, b) => b.startedAt - a.startedAt);
  }

  cancel(id: string): boolean {
    const item = this.electronItems.get(id);
    if (!item) return false;
    item.cancel();
    return true;
  }

  pause(id: string): boolean {
    const item = this.electronItems.get(id);
    if (!item) return false;
    item.pause();
    return true;
  }

  resume(id: string): boolean {
    const item = this.electronItems.get(id);
    if (!item) return false;
    item.resume();
    return true;
  }

  async open(id: string): Promise<void> {
    const item = this.items.get(id);
    if (!item || item.state !== 'completed' || !existsSync(item.savePath)) return;
    await shell.openPath(item.savePath);
  }

  showInFolder(id: string): void {
    const item = this.items.get(id);
    if (item && item.savePath) shell.showItemInFolder(item.savePath);
  }

  clear(): void {
    for (const [id, item] of this.items) {
      if (item.state !== 'progressing') this.items.delete(id);
    }
    this.persist();
    this.publish();
  }

  private persist(): void {
    this.store.saveDownloads(this.list());
  }

  private publish(): void {
    this.onUpdate(this.list());
  }
}

function uniquePath(directory: string, filename: string): string {
  const safeName = filename.replace(/[/\\]/g, '_') || 'download';
  const ext = extname(safeName);
  const base = safeName.slice(0, safeName.length - ext.length);
  let candidate = join(directory, safeName);
  let counter = 1;
  while (existsSync(candidate)) {
    candidate = join(directory, `${base} (${counter})${ext}`);
    counter++;
  }
  return candidate;
}
