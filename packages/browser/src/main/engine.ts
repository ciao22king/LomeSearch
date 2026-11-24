import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import type { EngineSearchOptions, EngineStatus, SearchResponse } from '../shared/types.js';
import type { AppStore } from './store.js';

/**
 * Owns the bundled search engine process.
 *
 * The engine is a normal Node program (`@lomesearch/engine`), so it is launched
 * with the Electron binary in `ELECTRON_RUN_AS_NODE` mode: no separate Node
 * runtime is required in the packaged app. If the configured port is busy or
 * the engine is already running (started from a terminal), the browser attaches
 * to it instead of spawning a second instance.
 */

const START_TIMEOUT_MS = 10_000;
const SEARCH_TIMEOUT_MS = 4_000;

export class EngineManager {
  private child: ChildProcess | null = null;
  private status: EngineStatus;
  private starting: Promise<void> | null = null;
  private stopping = false;

  constructor(
    private readonly store: AppStore,
    private readonly onUpdate: (status: EngineStatus) => void,
    private readonly log: (line: string) => void,
  ) {
    const settings = store.settings.value.engine;
    this.status = {
      running: false,
      port: settings.port,
      origin: `http://${settings.host}:${settings.port}`,
      documents: 0,
      indexedTerms: 0,
      error: null,
      version: '',
    };
  }

  getStatus(): EngineStatus {
    return { ...this.status };
  }

  async start(): Promise<void> {
    if (this.starting) return this.starting;
    this.starting = this.doStart().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async doStart(): Promise<void> {
    const settings = this.store.settings.value.engine;
    const origin = `http://${settings.host}:${settings.port}`;
    this.status = { ...this.status, port: settings.port, origin, error: null };

    if (await this.probe(origin)) {
      await this.refreshStats();
      this.log('engine: already running, attached');
      this.publish();
      return;
    }

    if (!settings.autoStart) {
      this.status = { ...this.status, running: false, error: null };
      this.publish();
      return;
    }

    const entry = this.entryPath();
    if (!entry) {
      this.status = {
        ...this.status,
        running: false,
        error: 'engine not found: run "npm run build" in the project folder',
      };
      this.publish();
      return;
    }

    const child = spawn(
      process.execPath,
      [
        entry,
        'serve',
        '--dir',
        settings.dataDir,
        '--port',
        String(settings.port),
        '--bind',
        settings.host,
        '--engine-host',
        `${settings.host}:${settings.port}`,
        '--parent-pid',
        String(process.pid),
        '--quiet',
      ],
      {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    this.child = child;
    child.stdout?.on('data', (chunk: Buffer) => this.log(`engine: ${chunk.toString().trim()}`));
    child.stderr?.on('data', (chunk: Buffer) => this.log(`engine: ${chunk.toString().trim()}`));
    child.on('exit', (code) => {
      this.child = null;
      if (this.stopping) return;
      this.status = {
        ...this.status,
        running: false,
        error: code === 0 ? null : `the engine exited (code ${code ?? 'unknown'})`,
      };
      this.publish();
    });

    const ready = await this.waitForHealth(origin);
    if (!ready) {
      this.status = {
        ...this.status,
        running: false,
        error: `the engine does not answer on ${origin}. Check port ${settings.port} and the logs.`,
      };
      this.publish();
      return;
    }
    await this.refreshStats();
    this.log(`engine: started on ${origin}`);
    this.publish();
  }

  async stop(): Promise<void> {
    const child = this.child;
    this.stopping = true;
    this.child = null;
    if (child) {
      child.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          resolve();
        }, 2_000);
        child.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    this.stopping = false;
    this.status = { ...this.status, running: false, documents: 0, indexedTerms: 0 };
    this.publish();
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  async refreshStats(): Promise<void> {
    try {
      const response = await fetch(`${this.status.origin}/stats`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (!response.ok) return;
      const data = (await response.json()) as {
        version?: string;
        index?: { documents?: number; indexedTerms?: number };
      };
      this.status = {
        ...this.status,
        running: true,
        error: null,
        version: data.version ?? '',
        documents: data.index?.documents ?? 0,
        indexedTerms: data.index?.indexedTerms ?? 0,
      };
    } catch {
      // The engine can be busy or restarting; the status is refreshed on demand.
    }
  }

  async search(query: string, options: EngineSearchOptions = {}): Promise<SearchResponse | null> {
    const params = new URLSearchParams({
      q: query,
      format: 'json',
      limit: String(options.limit ?? 10),
    });
    if (options.offset) params.set('offset', String(options.offset));
    if (options.web) params.set('web', '1');
    try {
      const response = await fetch(`${this.status.origin}/search?${params.toString()}`, {
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
      });
      if (!response.ok) return null;
      return (await response.json()) as SearchResponse;
    } catch {
      return null;
    }
  }

  async suggest(query: string): Promise<string[]> {
    if (!query.trim()) return [];
    try {
      const response = await fetch(
        `${this.status.origin}/suggest?q=${encodeURIComponent(query)}`,
        { signal: AbortSignal.timeout(1_500) },
      );
      if (!response.ok) return [];
      const payload = (await response.json()) as [string, string[]];
      return Array.isArray(payload) && Array.isArray(payload[1]) ? payload[1] : [];
    } catch {
      return [];
    }
  }

  private entryPath(): string | null {
    const configured = this.store.settings.value.engine.executable;
    if (configured && existsSync(configured)) return configured;
    const candidates = [
      join(app.getAppPath(), '..', 'engine', 'dist', 'src', 'cli.js'),
      join(process.resourcesPath ?? '', 'engine', 'dist', 'src', 'cli.js'),
      join(app.getAppPath(), 'engine', 'dist', 'src', 'cli.js'),
    ];
    return candidates.find((candidate) => existsSync(candidate)) ?? null;
  }

  private async probe(origin: string): Promise<boolean> {
    try {
      const response = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(800) });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async waitForHealth(origin: string): Promise<boolean> {
    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await this.probe(origin)) return true;
      if (!this.child) return false;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return false;
  }

  private publish(): void {
    this.onUpdate(this.getStatus());
  }
}
