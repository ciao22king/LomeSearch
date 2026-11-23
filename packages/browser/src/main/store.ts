import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  Bookmark,
  DownloadState,
  HistoryEntry,
  Settings,
  SiteException,
} from '../shared/types.js';
import { MAX_DOWNLOADS, MAX_HISTORY_ENTRIES, defaultSettings } from '../shared/constants.js';
import { homedir } from 'node:os';

/**
 * Persistence for everything the browser remembers.
 *
 * Files are plain JSON written atomically (temp file + rename) with a short
 * debounce, so a crash never leaves a half-written settings file behind. Every
 * write goes through this module: nothing else in the browser touches disk
 * except the engine data directory and the download directory.
 */

function readJson<T>(path: string, fallback: T): T {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function writeJson(path: string, data: unknown): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  renameSync(tmp, path);
}

class JsonStore<T> {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly path: string,
    private data: T,
  ) {}

  get value(): T {
    return this.data;
  }

  set(next: T): void {
    this.data = next;
    this.schedule();
  }

  schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 300);
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    writeJson(this.path, this.data);
  }
}

export interface StoredWindowSession {
  isPrivate: boolean;
  urls: string[];
  activeIndex: number;
}

interface PermissionRecord {
  [origin: string]: { [permission: string]: 'allow' | 'deny' };
}

interface PrivacyCounters {
  total: number;
  domains: Record<string, number>;
  updatedAt: number;
}

/** Same location the engine CLI uses, so `lomesearch crawl` feeds the browser. */
export function defaultEngineDir(): string {
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'LomeSearch');
  }
  if (process.platform === 'win32') {
    return join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'LomeSearch');
  }
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'lomesearch');
}

export class AppStore {
  private readonly dir: string;
  readonly settings: JsonStore<Settings>;
  readonly history: JsonStore<HistoryEntry[]>;
  readonly bookmarks: JsonStore<Bookmark[]>;
  readonly downloads: JsonStore<DownloadState[]>;
  readonly permissions: JsonStore<PermissionRecord>;
  readonly session: JsonStore<{ windows: StoredWindowSession[] }>;
  readonly privacyCounters: JsonStore<PrivacyCounters>;
  readonly exceptions: JsonStore<SiteException[]>;

  constructor(userDataDir: string, downloadDir: string) {
    this.dir = userDataDir;
    mkdirSync(this.dir, { recursive: true });
    const defaults = defaultSettings({ dataDir: defaultEngineDir(), downloadDir });
    const loaded = readJson<Partial<Settings>>(join(this.dir, 'settings.json'), {});
    const settings = mergeSettings(defaults, loaded);
    this.settings = new JsonStore(join(this.dir, 'settings.json'), settings);
    this.history = new JsonStore(join(this.dir, 'history.json'), readJson<HistoryEntry[]>(join(this.dir, 'history.json'), []));
    this.bookmarks = new JsonStore(join(this.dir, 'bookmarks.json'), readJson<Bookmark[]>(join(this.dir, 'bookmarks.json'), []));
    this.downloads = new JsonStore(join(this.dir, 'downloads.json'), readJson<DownloadState[]>(join(this.dir, 'downloads.json'), []));
    this.permissions = new JsonStore(join(this.dir, 'permissions.json'), readJson<PermissionRecord>(join(this.dir, 'permissions.json'), {}));
    this.session = new JsonStore(
      join(this.dir, 'session.json'),
      readJson<{ windows: StoredWindowSession[] }>(join(this.dir, 'session.json'), { windows: [] }),
    );
    this.privacyCounters = new JsonStore(
      join(this.dir, 'privacy.json'),
      readJson<PrivacyCounters>(join(this.dir, 'privacy.json'), { total: 0, domains: {}, updatedAt: 0 }),
    );
    this.exceptions = new JsonStore(join(this.dir, 'exceptions.json'), readJson<SiteException[]>(join(this.dir, 'exceptions.json'), []));
    this.pruneHistory();
    this.history.value.sort((a, b) => b.visitedAt - a.visitedAt);
  }

  flushAll(): void {
    this.settings.flush();
    this.history.flush();
    this.bookmarks.flush();
    this.downloads.flush();
    this.permissions.flush();
    this.session.flush();
    this.privacyCounters.flush();
    this.exceptions.flush();
  }

  updateSettings(patch: Partial<Settings>): Settings {
    const current = this.settings.value;
    const next: Settings = {
      ...current,
      ...patch,
      privacy: { ...current.privacy, ...(patch.privacy ?? {}) },
      engine: { ...current.engine, ...(patch.engine ?? {}) },
      downloads: { ...current.downloads, ...(patch.downloads ?? {}) },
      history: { ...current.history, ...(patch.history ?? {}) },
      extensions: { ...current.extensions, ...(patch.extensions ?? {}) },
    };
    this.settings.set(next);
    return next;
  }

  // ------------------------------------------------------------------ history

  recordVisit(url: string, title: string): void {
    if (!this.settings.value.history.enabled) return;
    if (!/^https?:/i.test(url)) return;
    const entries = this.history.value;
    const index = entries.findIndex((entry) => entry.url === url);
    const now = Date.now();
    if (index >= 0) {
      const [entry] = entries.splice(index, 1);
      if (entry) {
        entry.visitedAt = now;
        entry.visitCount += 1;
        if (title) entry.title = title;
        entries.unshift(entry);
      }
    } else {
      entries.unshift({
        id: randomUUID(),
        url,
        title: title || url,
        visitedAt: now,
        visitCount: 1,
      });
    }
    if (entries.length > MAX_HISTORY_ENTRIES) entries.length = MAX_HISTORY_ENTRIES;
    this.history.set(entries);
  }

  updateHistoryTitle(url: string, title: string): void {
    const entry = this.history.value.find((item) => item.url === url);
    if (entry && title) {
      entry.title = title;
      this.history.schedule();
    }
  }

  listHistory(query = '', limit = 200): HistoryEntry[] {
    const needle = query.trim().toLowerCase();
    const entries = this.history.value;
    if (!needle) return entries.slice(0, limit);
    return entries
      .filter(
        (entry) =>
          entry.url.toLowerCase().includes(needle) || entry.title.toLowerCase().includes(needle),
      )
      .slice(0, limit);
  }

  searchHistory(query: string, limit = 6): HistoryEntry[] {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    const starts: HistoryEntry[] = [];
    const contains: HistoryEntry[] = [];
    for (const entry of this.history.value) {
      const title = entry.title.toLowerCase();
      const url = entry.url.toLowerCase();
      if (title.startsWith(needle) || url.startsWith(needle)) starts.push(entry);
      else if (title.includes(needle) || url.includes(needle)) contains.push(entry);
      if (starts.length >= limit) break;
    }
    return [...starts, ...contains].slice(0, limit);
  }

  removeHistory(id: string): void {
    this.history.set(this.history.value.filter((entry) => entry.id !== id));
  }

  clearHistory(): void {
    this.history.set([]);
  }

  private pruneHistory(): void {
    const days = this.settings.value.history.retentionDays;
    if (!Number.isFinite(days) || days <= 0) return;
    const cutoff = Date.now() - days * 86_400_000;
    const kept = this.history.value.filter((entry) => entry.visitedAt >= cutoff);
    if (kept.length !== this.history.value.length) this.history.set(kept);
  }

  // ---------------------------------------------------------------- bookmarks

  listBookmarks(): Bookmark[] {
    return [...this.bookmarks.value].sort((a, b) => b.createdAt - a.createdAt);
  }

  addBookmark(url: string, title: string): Bookmark {
    const existing = this.bookmarks.value.find((bookmark) => bookmark.url === url);
    if (existing) {
      if (title) existing.title = title;
      this.bookmarks.schedule();
      return existing;
    }
    const bookmark: Bookmark = {
      id: randomUUID(),
      url,
      title: title || url,
      createdAt: Date.now(),
    };
    this.bookmarks.set([bookmark, ...this.bookmarks.value]);
    return bookmark;
  }

  removeBookmark(url: string): boolean {
    const next = this.bookmarks.value.filter((bookmark) => bookmark.url !== url);
    if (next.length === this.bookmarks.value.length) return false;
    this.bookmarks.set(next);
    return true;
  }

  isBookmarked(url: string): boolean {
    return this.bookmarks.value.some((bookmark) => bookmark.url === url);
  }

  // ----------------------------------------------------------------- download

  listDownloads(): DownloadState[] {
    return [...this.downloads.value].sort((a, b) => b.startedAt - a.startedAt);
  }

  saveDownloads(items: DownloadState[]): void {
    this.downloads.set(items.slice(0, MAX_DOWNLOADS));
  }

  clearDownloads(): void {
    this.downloads.set([]);
  }

  // -------------------------------------------------------------- permissions

  permissionFor(origin: string, permission: string): 'allow' | 'deny' | null {
    return this.permissions.value[origin]?.[permission] ?? null;
  }

  setPermission(origin: string, permission: string, decision: 'allow' | 'deny'): void {
    const record = this.permissions.value;
    record[origin] = { ...(record[origin] ?? {}), [permission]: decision };
    this.permissions.set(record);
  }

  // ------------------------------------------------------------------ privacy

  recordBlocked(domain: string): void {
    const counters = this.privacyCounters.value;
    counters.total += 1;
    counters.domains[domain] = (counters.domains[domain] ?? 0) + 1;
    counters.updatedAt = Date.now();
    if (Object.keys(counters.domains).length > 2_000) {
      const sorted = Object.entries(counters.domains).sort((a, b) => b[1] - a[1]).slice(0, 500);
      counters.domains = Object.fromEntries(sorted);
    }
    this.privacyCounters.schedule();
  }

  privacyTotals(): { total: number; domains: Array<{ domain: string; count: number }> } {
    const counters = this.privacyCounters.value;
    return {
      total: counters.total,
      domains: Object.entries(counters.domains)
        .map(([domain, count]) => ({ domain, count }))
        .sort((a, b) => b.count - a.count),
    };
  }

  resetPrivacyCounters(): void {
    this.privacyCounters.set({ total: 0, domains: {}, updatedAt: Date.now() });
  }

  listExceptions(): SiteException[] {
    return [...this.exceptions.value].sort((a, b) => a.domain.localeCompare(b.domain));
  }

  setException(domain: string, blockTrackers: boolean): void {
    const next = this.exceptions.value.filter((item) => item.domain !== domain);
    next.push({ domain, blockTrackers, createdAt: Date.now() });
    this.exceptions.set(next);
  }

  removeException(domain: string): void {
    this.exceptions.set(this.exceptions.value.filter((item) => item.domain !== domain));
  }

  exceptionFor(domain: string): SiteException | null {
    return this.exceptions.value.find((item) => item.domain === domain) ?? null;
  }

  // ----------------------------------------------------------------- session

  saveSession(windows: StoredWindowSession[]): void {
    this.session.set({ windows });
  }

  savedSession(): StoredWindowSession[] {
    return this.session.value.windows;
  }
}

function mergeSettings(defaults: Settings, loaded: Partial<Settings>): Settings {
  return {
    ...defaults,
    ...loaded,
    privacy: { ...defaults.privacy, ...(loaded.privacy ?? {}) },
    engine: { ...defaults.engine, ...(loaded.engine ?? {}) },
    downloads: { ...defaults.downloads, ...(loaded.downloads ?? {}) },
    history: { ...defaults.history, ...(loaded.history ?? {}) },
    extensions: { ...defaults.extensions, ...(loaded.extensions ?? {}) },
  };
}
