import type { SearchIndex } from '../index/index.js';
import { Crawler, type CrawlOptions, type CrawlStats } from './crawler.js';

/**
 * Keeps one crawler alive for the lifetime of the server so that IndexNow
 * submissions and manual seeds share the same frontier, robots cache and
 * duplicate detection. Runs are serialised: a submission that arrives while a
 * crawl is running simply extends the frontier.
 */
export class CrawlService {
  readonly crawler: Crawler;
  private running = false;
  private readonly waiters: Array<(stats: CrawlStats) => void> = [];

  constructor(index: SearchIndex, options: Omit<CrawlOptions, 'seeds' | 'index'> = {}) {
    this.crawler = new Crawler({ ...options, seeds: [], index });
  }

  get pending(): number {
    return this.crawler.pending;
  }

  get busy(): boolean {
    return this.running;
  }

  submit(urls: string[], priority = 0): number {
    const added = this.crawler.enqueue(urls, priority);
    if (added > 0) void this.schedule();
    return added;
  }

  /** Runs a crawl now and resolves when the frontier is empty. */
  run(seeds: string[] = []): Promise<CrawlStats> {
    if (seeds.length > 0) this.crawler.enqueue(seeds, 0);
    return this.schedule();
  }

  private async drain(): Promise<CrawlStats> {
    let stats = await this.crawler.run([]);
    while (this.crawler.pending > 0) stats = await this.crawler.run([]);
    return stats;
  }

  private schedule(): Promise<CrawlStats> {
    if (this.running) return new Promise((resolve) => this.waiters.push(resolve));
    this.running = true;
    return (async () => {
      try {
        const stats = await this.drain();
        for (const resolve of this.waiters.splice(0)) resolve(stats);
        return stats;
      } finally {
        this.running = false;
        if (this.crawler.pending > 0) void this.schedule();
      }
    })();
  }
}
