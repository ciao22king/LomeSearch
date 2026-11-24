#!/usr/bin/env node
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { SearchIndex, type IndexDocument } from './index/index.js';
import { CrawlService } from './crawl/service.js';
import { Crawler } from './crawl/crawler.js';
import { startSearchServer } from './server/http.js';
import { createWebProvider, isWebProviderId, type WebProvider } from './web/provider.js';
import {
  IndexNowClient,
  buildKeyLocation,
  generateKey,
  verifyKeyFile,
} from './indexnow.js';

const VERSION = '1.1.0';
const DEFAULT_PORT = 7717;

const HELP = `LomeSearch ${VERSION} - local search engine

Usage:
  lomesearch serve [options]                 start the search server
  lomesearch crawl <url...> [options]        index websites
  lomesearch index <file.jsonl> [options]    import documents
  lomesearch search <query> [options]        query the index from the terminal
  lomesearch suggest <prefix>                completion suggestions
  lomesearch stats                           index statistics
  lomesearch optimize                        compact segments and archive
  lomesearch indexnow <key|submit|verify>    IndexNow tools
  lomesearch version | help

Common options:
  --dir <path>           data directory (default: ${defaultDataDir()})
  --json                 JSON output
  --quiet                no progress on stderr

serve:
  --port <n>             port (default ${DEFAULT_PORT}; 0 = random)
  --bind <address>       listen address (default 127.0.0.1)
  --engine-host <host>   public name used in OpenSearch links
  --parent-pid <pid>     exit when that process disappears (used by the app)
  --key <key>            IndexNow key served from /indexnow/<key>.txt
  --seed <url>           starting URL (repeatable)
  --crawl                crawl the seeds immediately
  --max-pages <n>        pages per crawl (default 200)
  --delay <ms>           minimum delay per host (default 1000)
  --concurrency <n>      parallel requests (default 4)
  --web-provider <id>    optional external results: brave | searxng
                         (only used when a page asks with ?web=1)
  --web-key <key>        Brave subscription token (or BRAVE_SEARCH_API_KEY)
  --web-url <url>        SearXNG base URL (or LOMESEARCH_SEARXNG_URL)
  --no-ext               do not offer an external engine link on result pages

crawl:
  --max-pages <n>        maximum pages (default 200)
  --max-depth <n>        maximum link depth (default 3)
  --concurrency <n>      parallel requests (default 4)
  --delay <ms>           minimum delay per host (default 1000)
  --user-agent <string>  crawler user agent
  --no-same-site         follow links to other domains too
  --no-robots            ignore robots.txt (not recommended)
  --no-sitemaps          do not read sitemaps
  --optimize             compact the index when done

index:
  --optimize             compact the index when done

search:
  --limit <n>            results (default 10)
  --page <n>             page (default 1)

indexnow submit <url...>:
  --host <host> --key <key> [--endpoint <url>] [--key-location <url>]

indexnow verify:
  --host <host> --key <key> [--key-location <url>]

indexnow key:
  --host <host>          generate a key and print the file to publish
`;

function defaultDataDir(): string {
  if (process.env.LOMESEARCH_DATA_DIR) return process.env.LOMESEARCH_DATA_DIR;
  const home = homedir();
  if (process.platform === 'darwin') return join(home, 'Library', 'Application Support', 'LomeSearch');
  if (process.platform === 'win32') {
    return join(process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), 'LomeSearch');
  }
  return join(process.env.XDG_DATA_HOME ?? join(home, '.local', 'share'), 'lomesearch');
}

interface CommonOptions {
  dir: string;
  json: boolean;
  quiet: boolean;
}

function commonOptions(values: Record<string, unknown>): CommonOptions {
  return {
    dir: typeof values.dir === 'string' ? resolve(values.dir) : defaultDataDir(),
    json: values.json === true,
    quiet: values.quiet === true,
  };
}

function numberOption(value: unknown, fallback: number): number {
  if (typeof value !== 'string') return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stringOption(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function fail(message: string): never {
  process.stderr.write(`lomesearch: ${message}\n`);
  process.exit(1);
}

function openIndex(dir: string): SearchIndex {
  mkdirSync(dir, { recursive: true });
  return SearchIndex.open(dir);
}

/**
 * Build the optional external provider. Nothing is enabled implicitly: the flag
 * must name a provider, and the credentials must be present, or the server
 * refuses to start instead of silently falling back to local-only.
 */
function buildWebProvider(values: Record<string, unknown>): WebProvider | undefined {
  const id = stringOption(values['web-provider']) ?? process.env.LOMESEARCH_WEB_PROVIDER;
  if (!id) return undefined;
  if (!isWebProviderId(id)) fail(`unknown --web-provider "${id}" (brave, searxng)`);
  const apiKey = stringOption(values['web-key']) ?? process.env.BRAVE_SEARCH_API_KEY;
  const baseUrl = stringOption(values['web-url']) ?? process.env.LOMESEARCH_SEARXNG_URL;
  try {
    return createWebProvider({ id, apiKey, baseUrl });
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

async function commandServe(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      dir: { type: 'string' },
      port: { type: 'string' },
      bind: { type: 'string' },
      'engine-host': { type: 'string' },
      'parent-pid': { type: 'string' },
      key: { type: 'string' },
      seed: { type: 'string', multiple: true },
      crawl: { type: 'boolean' },
      'max-pages': { type: 'string' },
      delay: { type: 'string' },
      concurrency: { type: 'string' },
      'web-provider': { type: 'string' },
      'web-key': { type: 'string' },
      'web-url': { type: 'string' },
      ext: { type: 'boolean' },
      quiet: { type: 'boolean' },
      json: { type: 'boolean' },
    },
  });
  const common = commonOptions(values);
  const index = openIndex(common.dir);
  const key = stringOption(values.key) ?? loadOrCreateKey(common.dir);
  const service = new CrawlService(index, {
    maxPages: numberOption(values['max-pages'], 200),
    perHostDelayMs: numberOption(values.delay, 1_000),
    concurrency: numberOption(values.concurrency, 4),
    onEvent: (event) => {
      if (common.quiet) return;
      if (event.type === 'indexed') process.stderr.write(`  indexed ${event.url}\n`);
      else if (event.type === 'skipped') process.stderr.write(`  skipped ${event.url} (${event.reason})\n`);
      else if (event.type === 'error') process.stderr.write(`  error ${event.url}: ${event.message}\n`);
    },
  });

  const webProvider = buildWebProvider(values);
  const server = await startSearchServer({
    index,
    webProvider,
    externalOffer: values.ext === false ? null : undefined,
    port: numberOption(values.port, DEFAULT_PORT),
    bindAddress: stringOption(values.bind) ?? '127.0.0.1',
    engineHost: stringOption(values['engine-host']),
    engineKey: key,
    submitUrls: (urls, priority) => service.submit(urls, priority),
    log: common.quiet ? undefined : (line) => process.stderr.write(`${line}\n`),
  });

  process.stdout.write(`LomeSearch listening on ${server.origin}\n`);
  process.stdout.write(`  search page        ${server.origin}/\n`);
  process.stdout.write(`  OpenSearch         ${server.origin}/opensearch.xml\n`);
  process.stdout.write(`  IndexNow           POST ${server.origin}/indexnow\n`);
  process.stdout.write(`  IndexNow key       ${server.origin}/indexnow/${key}.txt\n`);
  process.stdout.write(`  data               ${common.dir}\n`);
  process.stdout.write(
    `  web results        ${webProvider ? `${webProvider.name}, only on ?web=1` : 'off (local index only)'}\n`,
  );

  const seeds = (values.seed as string[] | undefined) ?? [];
  if (seeds.length > 0 && values.crawl) {
    process.stderr.write(`crawling ${seeds.length} seed(s)...\n`);
    const stats = await service.run(seeds);
    process.stderr.write(
      `crawl finished: ${stats.indexed} indexed, ${stats.skipped} skipped, ${stats.errors} errors\n`,
    );
  }

  const parentPid = numberOption(values['parent-pid'], 0);
  if (parentPid > 0) watchParent(parentPid);

  let closing = false;
  const shutdown = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    process.stderr.write('\nstopping...\n');
    await server.close();
    index.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

/**
 * The browser spawns the engine as a child. Without this, a crash of the parent
 * leaves the engine running with a stale in-memory index, and the next launch
 * silently attaches to it instead of reading the data directory.
 */
function watchParent(pid: number): void {
  const timer = setInterval(() => {
    try {
      process.kill(pid, 0);
    } catch {
      process.stderr.write(`parent ${pid} is gone, stopping\n`);
      process.exit(0);
    }
  }, 5_000);
  timer.unref();
}

function loadOrCreateKey(dir: string): string {
  const path = join(dir, 'indexnow-key.txt');
  if (existsSync(path)) {
    const existing = readFileSync(path, 'utf8').trim();
    if (/^[a-zA-Z0-9-]{8,128}$/.test(existing)) return existing;
  }
  const key = generateKey();
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, `${key}\n`);
  return key;
}

async function commandCrawl(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      dir: { type: 'string' },
      'max-pages': { type: 'string' },
      'max-depth': { type: 'string' },
      concurrency: { type: 'string' },
      delay: { type: 'string' },
      'user-agent': { type: 'string' },
      'same-site': { type: 'boolean' },
      'no-same-site': { type: 'boolean' },
      'no-robots': { type: 'boolean' },
      'no-sitemaps': { type: 'boolean' },
      optimize: { type: 'boolean' },
      quiet: { type: 'boolean' },
      json: { type: 'boolean' },
    },
  });
  if (positionals.length === 0) fail('specify at least one URL to crawl');
  const common = commonOptions(values);
  const index = openIndex(common.dir);
  const sameSite = values['no-same-site'] === true ? false : true;

  const crawler = new Crawler({
    seeds: positionals,
    index,
    maxPages: numberOption(values['max-pages'], 200),
    maxDepth: numberOption(values['max-depth'], 3),
    concurrency: numberOption(values.concurrency, 4),
    perHostDelayMs: numberOption(values.delay, 1_000),
    userAgent: stringOption(values['user-agent']),
    sameSite,
    respectRobots: values['no-robots'] !== true,
    discoverSitemaps: values['no-sitemaps'] !== true,
    onEvent: (event) => {
      if (common.quiet) return;
      if (event.type === 'indexed') process.stderr.write(`+ ${event.url}\n`);
      else if (event.type === 'skipped') process.stderr.write(`- ${event.url} (${event.reason})\n`);
      else if (event.type === 'error') process.stderr.write(`! ${event.url}: ${event.message}\n`);
    },
  });

  const stats = await crawler.run(positionals);
  if (values.optimize === true) index.optimize();
  if (common.json) {
    process.stdout.write(`${JSON.stringify(stats, null, 2)}\n`);
  } else {
    process.stdout.write(
      [
        `pages fetched      ${stats.fetched}`,
        `documents indexed  ${stats.indexed}`,
        `skipped            ${stats.skipped}`,
        `errors             ${stats.errors}`,
        `sitemap URLs       ${stats.sitemapUrls}`,
        `downloaded         ${(stats.bytes / 1024 / 1024).toFixed(1)} MiB`,
        `duration           ${(stats.durationMs / 1000).toFixed(1)} s`,
      ].join('\n') + '\n',
    );
  }
  index.close();
}

async function commandIndex(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      dir: { type: 'string' },
      optimize: { type: 'boolean' },
      quiet: { type: 'boolean' },
      json: { type: 'boolean' },
    },
  });
  const file = positionals[0];
  if (!file) fail('specify a JSONL file');
  const common = commonOptions(values);
  const index = openIndex(common.dir);
  const reader = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
  let lineNumber = 0;
  let added = 0;
  let failed = 0;
  for await (const line of reader) {
    lineNumber++;
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const document = JSON.parse(trimmed) as IndexDocument;
      if (!document.url || typeof document.body !== 'string') throw new Error('url and body are required');
      index.addDocument(document);
      added++;
      if (!common.quiet && added % 1000 === 0) process.stderr.write(`${added} documents\n`);
    } catch (error) {
      failed++;
      if (!common.quiet) {
        process.stderr.write(`line ${lineNumber}: ${error instanceof Error ? error.message : String(error)}\n`);
      }
    }
  }
  index.commit();
  if (values.optimize === true) index.optimize();
  index.close();
  if (common.json) process.stdout.write(`${JSON.stringify({ added, failed, lines: lineNumber })}\n`);
  else process.stdout.write(`${added} documents indexed, ${failed} lines discarded\n`);
}

function commandSearch(argv: string[]): void {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      dir: { type: 'string' },
      limit: { type: 'string' },
      page: { type: 'string' },
      json: { type: 'boolean' },
      quiet: { type: 'boolean' },
    },
  });
  const query = positionals.join(' ').trim();
  if (!query) fail('specify a query');
  const common = commonOptions(values);
  const index = openIndex(common.dir);
  const limit = numberOption(values.limit, 10);
  const page = Math.max(1, numberOption(values.page, 1));
  const response = index.search(query, { limit, offset: (page - 1) * limit });
  index.close();
  if (common.json) {
    process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    `${response.total}${response.totalRelation === 'gte' ? '+' : ''} results in ${response.tookMs.toFixed(1)} ms\n`,
  );
  if (response.suggestion) process.stdout.write(`did you mean: ${response.suggestion}\n`);
  for (const result of response.results) {
    const snippet = result.snippet.replace(/<\/?mark>/g, '*').replace(/<[^>]+>/g, '');
    process.stdout.write(`\n${result.title}\n  ${result.url}\n  ${snippet}\n`);
  }
}

function commandSuggest(argv: string[]): void {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { dir: { type: 'string' }, json: { type: 'boolean' }, quiet: { type: 'boolean' } },
  });
  const prefix = positionals.join(' ').trim();
  if (!prefix) fail('specify a prefix');
  const common = commonOptions(values);
  const index = openIndex(common.dir);
  const suggestions = index.suggest(prefix, 8);
  index.close();
  if (common.json) process.stdout.write(`${JSON.stringify(suggestions)}\n`);
  else process.stdout.write(`${suggestions.join('\n')}\n`);
}

function commandStats(argv: string[]): void {
  const { values } = parseArgs({
    args: argv,
    allowPositionals: false,
    options: { dir: { type: 'string' }, json: { type: 'boolean' }, quiet: { type: 'boolean' } },
  });
  const common = commonOptions(values);
  const index = openIndex(common.dir);
  const stats = index.stats();
  index.close();
  if (common.json) {
    process.stdout.write(`${JSON.stringify(stats, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    [
      `documents          ${stats.documents}`,
      `segments           ${stats.segments}`,
      `terms (postings)   ${stats.indexedTerms}`,
      `tombstones         ${stats.tombstones}`,
      `document store     ${(stats.documentBytes / 1024 / 1024).toFixed(1)} MiB`,
      `segments on disk   ${(stats.segmentBytes / 1024 / 1024).toFixed(1)} MiB`,
      `average lengths    ${stats.averageLengths.map((value) => value.toFixed(1)).join(' / ')}`,
      `updated            ${stats.updatedAt ? new Date(stats.updatedAt).toISOString() : 'never'}`,
    ].join('\n') + '\n',
  );
}

function commandOptimize(argv: string[]): void {
  const { values } = parseArgs({
    args: argv,
    allowPositionals: false,
    options: { dir: { type: 'string' }, json: { type: 'boolean' }, quiet: { type: 'boolean' } },
  });
  const common = commonOptions(values);
  const index = openIndex(common.dir);
  const result = index.optimize();
  const stats = index.stats();
  index.close();
  if (common.json) process.stdout.write(`${JSON.stringify({ ...result, stats }, null, 2)}\n`);
  else {
    process.stdout.write(
      `segments merged: ${result.mergedSegments}\ndocuments kept: ${result.vacuumedDocuments}\n`,
    );
  }
}

async function commandIndexNow(argv: string[]): Promise<void> {
  const [subcommand, ...rest] = argv;
  if (subcommand === 'key') {
    const { values } = parseArgs({
      args: rest,
      allowPositionals: false,
      options: { host: { type: 'string' }, dir: { type: 'string' } },
    });
    const host = stringOption(values.host);
    const key = generateKey();
    const location = host ? buildKeyLocation(host, key) : `<host>/${key}.txt`;
    process.stdout.write(
      [
        `key:            ${key}`,
        `file to publish on ${host ?? '<host>'}: ${key}.txt`,
        `file content:   ${key}`,
        `file URL:       ${location}`,
        '',
        'Add the key to the server with --key, then submit URLs with:',
        `  lomesearch indexnow submit https://${host ?? 'example.com'}/page --host ${host ?? 'example.com'} --key ${key}`,
      ].join('\n') + '\n',
    );
    return;
  }

  if (subcommand === 'submit') {
    const { values, positionals } = parseArgs({
      args: rest,
      allowPositionals: true,
      options: {
        host: { type: 'string' },
        key: { type: 'string' },
        endpoint: { type: 'string' },
        'key-location': { type: 'string' },
        json: { type: 'boolean' },
      },
    });
    const host = stringOption(values.host);
    const key = stringOption(values.key);
    if (!host || !key) fail('--host and --key are required');
    if (positionals.length === 0) fail('specify at least one URL');
    const client = new IndexNowClient({
      host,
      key,
      endpoint: stringOption(values.endpoint),
      keyLocation: stringOption(values['key-location']),
    });
    const result = await client.submit(positionals);
    if (values.json === true) process.stdout.write(`${JSON.stringify(result)}\n`);
    else process.stdout.write(`${result.ok ? 'accepted' : 'rejected'} ${result.submitted} URL(s) (HTTP ${result.status}) - ${result.message}\n`);
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (subcommand === 'verify') {
    const { values } = parseArgs({
      args: rest,
      allowPositionals: false,
      options: {
        host: { type: 'string' },
        key: { type: 'string' },
        'key-location': { type: 'string' },
        json: { type: 'boolean' },
      },
    });
    const host = stringOption(values.host);
    const key = stringOption(values.key);
    if (!host || !key) fail('--host and --key are required');
    const payload: { host: string; key: string; keyLocation?: string; urlList: string[] } = {
      host,
      key,
      urlList: [],
    };
    const keyLocation = stringOption(values['key-location']);
    if (keyLocation) payload.keyLocation = keyLocation;
    const result = await verifyKeyFile(payload);
    if (values.json === true) process.stdout.write(`${JSON.stringify({ result })}\n`);
    else process.stdout.write(`verification: ${result}\n`);
    if (result !== 'valid') process.exitCode = 1;
    return;
  }

  fail(`unknown IndexNow subcommand: ${subcommand ?? '(none)'}`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const [command, ...rest] = argv;
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(HELP);
    return;
  }
  if (command === 'version' || command === '--version' || command === '-v') {
    process.stdout.write(`LomeSearch ${VERSION}\n`);
    return;
  }
  switch (command) {
    case 'serve':
      await commandServe(rest);
      break;
    case 'crawl':
      await commandCrawl(rest);
      break;
    case 'index':
      await commandIndex(rest);
      break;
    case 'search':
      commandSearch(rest);
      break;
    case 'suggest':
      commandSuggest(rest);
      break;
    case 'stats':
      commandStats(rest);
      break;
    case 'optimize':
      commandOptimize(rest);
      break;
    case 'indexnow':
      await commandIndexNow(rest);
      break;
    default:
      fail(`unknown command: ${command}\n\n${HELP}`);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`lomesearch: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
