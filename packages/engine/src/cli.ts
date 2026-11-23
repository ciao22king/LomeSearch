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
import {
  IndexNowClient,
  buildKeyLocation,
  generateKey,
  verifyKeyFile,
} from './indexnow.js';

const VERSION = '1.0.0';
const DEFAULT_PORT = 7717;

const HELP = `LomeSearch ${VERSION} - motore di ricerca locale

Uso:
  lomesearch serve [opzioni]                 avvia il server di ricerca
  lomesearch crawl <url...> [opzioni]        indicizza siti web
  lomesearch index <file.jsonl> [opzioni]    importa documenti
  lomesearch search <query> [opzioni]        interroga l'indice da terminale
  lomesearch suggest <prefisso>              suggerimenti di completamento
  lomesearch stats                           statistiche dell'indice
  lomesearch optimize                        compatta segmenti e archivio
  lomesearch indexnow <key|submit|verify>    strumenti IndexNow
  lomesearch version | help

Opzioni comuni:
  --dir <percorso>       directory dei dati (default: ${defaultDataDir()})
  --json                 output JSON
  --quiet                nessun progresso su stderr

serve:
  --port <n>             porta (default ${DEFAULT_PORT}; 0 = casuale)
  --bind <indirizzo>     indirizzo di ascolto (default 127.0.0.1)
  --engine-host <host>   nome pubblico usato nei link OpenSearch
  --key <chiave>         chiave IndexNow servita da /indexnow/<chiave>.txt
  --seed <url>           URL iniziale (ripetibile)
  --crawl                avvia subito la scansione dei seed
  --max-pages <n>        pagine massime per scansione (default 200)
  --delay <ms>           pausa minima per host (default 1000)
  --concurrency <n>      richieste parallele (default 4)

crawl:
  --max-pages <n>        pagine massime (default 200)
  --max-depth <n>        profondità massima dei link (default 3)
  --concurrency <n>      richieste parallele (default 4)
  --delay <ms>           pausa minima per host (default 1000)
  --user-agent <string>  user agent del crawler
  --no-same-site         segui anche link verso altri domini
  --no-robots            ignora robots.txt (sconsigliato)
  --no-sitemaps          non leggere le sitemap
  --optimize             compatta l'indice al termine

index:
  --optimize             compatta l'indice al termine

search:
  --limit <n>            risultati (default 10)
  --page <n>             pagina (default 1)

indexnow submit <url...>:
  --host <host> --key <chiave> [--endpoint <url>] [--key-location <url>]

indexnow verify:
  --host <host> --key <chiave> [--key-location <url>]

indexnow key:
  --host <host>          genera una chiave e mostra il file da pubblicare
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

async function commandServe(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      dir: { type: 'string' },
      port: { type: 'string' },
      bind: { type: 'string' },
      'engine-host': { type: 'string' },
      key: { type: 'string' },
      seed: { type: 'string', multiple: true },
      crawl: { type: 'boolean' },
      'max-pages': { type: 'string' },
      delay: { type: 'string' },
      concurrency: { type: 'string' },
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
      if (event.type === 'indexed') process.stderr.write(`  indicizzato ${event.url}\n`);
      else if (event.type === 'skipped') process.stderr.write(`  saltato ${event.url} (${event.reason})\n`);
      else if (event.type === 'error') process.stderr.write(`  errore ${event.url}: ${event.message}\n`);
    },
  });

  const server = await startSearchServer({
    index,
    port: numberOption(values.port, DEFAULT_PORT),
    bindAddress: stringOption(values.bind) ?? '127.0.0.1',
    engineHost: stringOption(values['engine-host']),
    engineKey: key,
    submitUrls: (urls, priority) => service.submit(urls, priority),
    log: common.quiet ? undefined : (line) => process.stderr.write(`${line}\n`),
  });

  process.stdout.write(`LomeSearch in ascolto su ${server.origin}\n`);
  process.stdout.write(`  pagina di ricerca  ${server.origin}/\n`);
  process.stdout.write(`  OpenSearch         ${server.origin}/opensearch.xml\n`);
  process.stdout.write(`  IndexNow           POST ${server.origin}/indexnow\n`);
  process.stdout.write(`  chiave IndexNow    ${server.origin}/indexnow/${key}.txt\n`);
  process.stdout.write(`  dati               ${common.dir}\n`);

  const seeds = (values.seed as string[] | undefined) ?? [];
  if (seeds.length > 0 && values.crawl) {
    process.stderr.write(`scansione di ${seeds.length} seed...\n`);
    const stats = await service.run(seeds);
    process.stderr.write(
      `scansione conclusa: ${stats.indexed} indicizzati, ${stats.skipped} saltati, ${stats.errors} errori\n`,
    );
  }

  let closing = false;
  const shutdown = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    process.stderr.write('\narresto in corso...\n');
    await server.close();
    index.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
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
  if (positionals.length === 0) fail('specifica almeno un URL da scansionare');
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
        `pagine richieste   ${stats.fetched}`,
        `documenti indicizzati ${stats.indexed}`,
        `saltati            ${stats.skipped}`,
        `errori             ${stats.errors}`,
        `URL da sitemap     ${stats.sitemapUrls}`,
        `dati scaricati     ${(stats.bytes / 1024 / 1024).toFixed(1)} MiB`,
        `durata             ${(stats.durationMs / 1000).toFixed(1)} s`,
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
  if (!file) fail('specifica un file JSONL');
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
      if (!document.url || typeof document.body !== 'string') throw new Error('url e body sono obbligatori');
      index.addDocument(document);
      added++;
      if (!common.quiet && added % 1000 === 0) process.stderr.write(`${added} documenti\n`);
    } catch (error) {
      failed++;
      if (!common.quiet) {
        process.stderr.write(`riga ${lineNumber}: ${error instanceof Error ? error.message : String(error)}\n`);
      }
    }
  }
  index.commit();
  if (values.optimize === true) index.optimize();
  index.close();
  if (common.json) process.stdout.write(`${JSON.stringify({ added, failed, lines: lineNumber })}\n`);
  else process.stdout.write(`${added} documenti indicizzati, ${failed} righe scartate\n`);
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
  if (!query) fail('specifica una query');
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
    `${response.total}${response.totalRelation === 'gte' ? '+' : ''} risultati in ${response.tookMs.toFixed(1)} ms\n`,
  );
  if (response.suggestion) process.stdout.write(`forse cercavi: ${response.suggestion}\n`);
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
  if (!prefix) fail('specifica un prefisso');
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
      `documenti          ${stats.documents}`,
      `segmenti           ${stats.segments}`,
      `termini (posting)  ${stats.indexedTerms}`,
      `tombstone          ${stats.tombstones}`,
      `archivio documenti ${(stats.documentBytes / 1024 / 1024).toFixed(1)} MiB`,
      `segmenti su disco  ${(stats.segmentBytes / 1024 / 1024).toFixed(1)} MiB`,
      `lunghezze medie    ${stats.averageLengths.map((value) => value.toFixed(1)).join(' / ')}`,
      `aggiornato         ${stats.updatedAt ? new Date(stats.updatedAt).toISOString() : 'mai'}`,
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
      `segmenti compattati: ${result.mergedSegments}\ndocumenti conservati: ${result.vacuumedDocuments}\n`,
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
        `chiave:        ${key}`,
        `file da pubblicare su ${host ?? '<host>'}: ${key}.txt`,
        `contenuto del file: ${key}`,
        `URL del file:  ${location}`,
        '',
        'Aggiungi la chiave al server con --key, poi invia gli URL con:',
        `  lomesearch indexnow submit https://${host ?? 'example.com'}/pagina --host ${host ?? 'example.com'} --key ${key}`,
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
    if (!host || !key) fail('--host e --key sono obbligatori');
    if (positionals.length === 0) fail('specifica almeno un URL');
    const client = new IndexNowClient({
      host,
      key,
      endpoint: stringOption(values.endpoint),
      keyLocation: stringOption(values['key-location']),
    });
    const result = await client.submit(positionals);
    if (values.json === true) process.stdout.write(`${JSON.stringify(result)}\n`);
    else process.stdout.write(`${result.ok ? 'accettati' : 'rifiutati'} ${result.submitted} URL (HTTP ${result.status}) - ${result.message}\n`);
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
    if (!host || !key) fail('--host e --key sono obbligatori');
    const payload: { host: string; key: string; keyLocation?: string; urlList: string[] } = {
      host,
      key,
      urlList: [],
    };
    const keyLocation = stringOption(values['key-location']);
    if (keyLocation) payload.keyLocation = keyLocation;
    const result = await verifyKeyFile(payload);
    if (values.json === true) process.stdout.write(`${JSON.stringify({ result })}\n`);
    else process.stdout.write(`verifica: ${result}\n`);
    if (result !== 'valid') process.exitCode = 1;
    return;
  }

  fail(`sottocomando IndexNow sconosciuto: ${subcommand ?? '(nessuno)'}`);
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
      fail(`comando sconosciuto: ${command}\n\n${HELP}`);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`lomesearch: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
