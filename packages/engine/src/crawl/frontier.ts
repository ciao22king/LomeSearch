import { hostOf } from '../core/url.js';

/**
 * Crawl frontier with per-host politeness.
 *
 * Entries are grouped by host. A host is only allowed one request at a time and
 * is put to sleep after each response, which keeps a single busy site from
 * starving the rest of the queue. Within a host, lower priority numbers and
 * older discoveries are served first.
 */

export interface FrontierEntry {
  url: string;
  /** 0 = IndexNow / manual, 1 = sitemap, 2 = link, 3 = recrawl. */
  priority: number;
  depth: number;
  discoveredAt: number;
  referrer?: string;
  lastmod?: string;
}

export interface FrontierOptions {
  perHostDelayMs?: number;
  maxConcurrentPerHost?: number;
  maxSeen?: number;
}

interface HostState {
  host: string;
  queue: FrontierEntry[];
  active: number;
  nextAt: number;
}

export class Frontier {
  private readonly hosts = new Map<string, HostState>();
  private readonly hostOrder: string[] = [];
  private readonly seen = new Map<string, number>();
  private cursor = 0;
  private readonly perHostDelayMs: number;
  private readonly maxConcurrentPerHost: number;
  private readonly maxSeen: number;
  private queued = 0;

  constructor(options: FrontierOptions = {}) {
    this.perHostDelayMs = options.perHostDelayMs ?? 1_000;
    this.maxConcurrentPerHost = options.maxConcurrentPerHost ?? 1;
    this.maxSeen = options.maxSeen ?? 2_000_000;
  }

  get size(): number {
    return this.queued;
  }

  has(url: string): boolean {
    return this.seen.has(url);
  }

  /** Returns false when the URL was already scheduled. */
  add(entry: FrontierEntry): boolean {
    if (this.seen.has(entry.url)) return false;
    this.seen.set(entry.url, Date.now());
    if (this.seen.size > this.maxSeen) {
      const oldest = this.seen.keys().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    const host = hostOf(entry.url) ?? '';
    let state = this.hosts.get(host);
    if (!state) {
      state = { host, queue: [], active: 0, nextAt: 0 };
      this.hosts.set(host, state);
      this.hostOrder.push(host);
    }
    insertSorted(state.queue, entry);
    this.queued++;
    return true;
  }

  /** Marks a URL as seen without scheduling it (for redirects and duplicates). */
  remember(url: string): void {
    if (this.seen.has(url)) return;
    this.seen.set(url, Date.now());
  }

  take(now = Date.now()): FrontierEntry | null {
    const count = this.hostOrder.length;
    for (let step = 0; step < count; step++) {
      const index = (this.cursor + step) % count;
      const host = this.hostOrder[index]!;
      const state = this.hosts.get(host);
      if (!state || state.queue.length === 0) continue;
      if (state.active >= this.maxConcurrentPerHost || state.nextAt > now) continue;
      const entry = state.queue.shift()!;
      state.active++;
      this.queued--;
      this.cursor = (index + 1) % count;
      return entry;
    }
    return null;
  }

  /** Returns the earliest time at which some host becomes available. */
  nextWakeAt(now = Date.now()): number {
    let earliest = Number.POSITIVE_INFINITY;
    for (const state of this.hosts.values()) {
      if (state.queue.length === 0 || state.active >= this.maxConcurrentPerHost) continue;
      earliest = Math.min(earliest, state.nextAt);
    }
    if (!Number.isFinite(earliest)) return now + 100;
    return Math.max(earliest, now);
  }

  complete(url: string, delayMs = this.perHostDelayMs): void {
    const host = hostOf(url) ?? '';
    const state = this.hosts.get(host);
    if (!state) return;
    state.active = Math.max(0, state.active - 1);
    state.nextAt = Date.now() + Math.max(delayMs, this.perHostDelayMs);
    if (state.queue.length === 0 && state.active === 0) {
      this.hosts.delete(host);
      const index = this.hostOrder.indexOf(host);
      if (index !== -1) {
        this.hostOrder.splice(index, 1);
        if (this.hostOrder.length > 0) this.cursor %= this.hostOrder.length;
      }
    }
  }

  get pendingHosts(): number {
    return this.hostOrder.length;
  }
}

function insertSorted(queue: FrontierEntry[], entry: FrontierEntry): void {
  let low = 0;
  let high = queue.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    const candidate = queue[mid]!;
    if (
      candidate.priority < entry.priority ||
      (candidate.priority === entry.priority && candidate.discoveredAt <= entry.discoveredAt)
    ) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  queue.splice(low, 0, entry);
}
