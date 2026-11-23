import { mkdtempSync, rmSync, statSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { SearchIndex } from './index/index.js';

/**
 * Synthetic benchmark.
 *
 * Builds a deterministic corpus, indexes it, then measures single-term and
 * two-term queries. The point is to catch regressions in the segment format,
 * the query path and the merge policy, not to model a real crawl.
 */

const DOCUMENTS = Number.parseInt(process.env.BENCH_DOCS ?? '5000', 10);
const QUERIES = Number.parseInt(process.env.BENCH_QUERIES ?? '300', 10);
const WORDS_PER_DOC = 160;

let seed = 0x2f6e2b1;
function random(): number {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  seed >>>= 0;
  return seed / 0x100000000;
}

const syllables = ['lo', 'me', 'sa', 'ri', 'ca', 'tu', 'vi', 'ne', 'da', 'po', 'gra', 'fia', 'stel', 'mar', 'cor', 'lin'];
const vocabulary: string[] = [];
for (let i = 0; i < 3_000; i++) {
  let word = '';
  const parts = 2 + Math.floor(random() * 3);
  for (let p = 0; p < parts; p++) word += syllables[Math.floor(random() * syllables.length)];
  vocabulary.push(word);
}

function sentence(words: number): string {
  const parts: string[] = [];
  for (let i = 0; i < words; i++) parts.push(vocabulary[Math.floor(random() * vocabulary.length)]!);
  return parts.join(' ');
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction));
  return sorted[index]!;
}

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'lomesearch-bench-'));
  process.stdout.write(`corpus: ${DOCUMENTS} documents, ${WORDS_PER_DOC} words each\n`);
  const index = SearchIndex.open(dir, { flushThreshold: 512, mergeFactor: 6 });

  const indexingStarted = performance.now();
  for (let i = 0; i < DOCUMENTS; i++) {
    index.addDocument({
      url: `https://site${i % 200}.example.com/page/${i}`,
      title: sentence(8),
      description: sentence(12),
      headings: [sentence(4)],
      body: `${sentence(WORDS_PER_DOC)} ${sentence(40)}`,
      lang: 'en',
      fetchedAt: Date.now() - Math.floor(random() * 90) * 86_400_000,
      outlinks: Array.from({ length: 4 }, () => `https://site${Math.floor(random() * 200)}.example.com/page/${Math.floor(random() * DOCUMENTS)}`),
    });
  }
  index.commit();
  const indexingMs = performance.now() - indexingStarted;

  const queries: string[] = [];
  for (let i = 0; i < QUERIES; i++) {
    const a = vocabulary[Math.floor(random() * vocabulary.length)]!;
    if (i % 2 === 0) queries.push(a);
    else queries.push(`${a} ${vocabulary[Math.floor(random() * vocabulary.length)]}`);
  }

  const latencies: number[] = [];
  let hits = 0;
  const searchStarted = performance.now();
  for (const query of queries) {
    const started = performance.now();
    const response = index.search(query, { limit: 10 });
    latencies.push(performance.now() - started);
    hits += response.results.length;
  }
  const searchMs = performance.now() - searchStarted;

  const optimizeStarted = performance.now();
  index.optimize();
  const optimizeMs = performance.now() - optimizeStarted;

  const stats = index.stats();
  index.close();
  const segmentBytes = readdirSync(join(dir, 'segments')).reduce(
    (total, name) => total + statSync(join(dir, 'segments', name)).size,
    0,
  );
  const documentBytes = statSync(join(dir, 'docs.log')).size;
  rmSync(dir, { recursive: true, force: true });

  latencies.sort((a, b) => a - b);
  process.stdout.write(
    [
      `indexing         ${(DOCUMENTS / (indexingMs / 1000)).toFixed(0)} docs/s (${indexingMs.toFixed(0)} ms)`,
      `query            ${(QUERIES / (searchMs / 1000)).toFixed(0)} q/s`,
      `latency          p50 ${percentile(latencies, 0.5).toFixed(2)} ms, p95 ${percentile(latencies, 0.95).toFixed(2)} ms, p99 ${percentile(latencies, 0.99).toFixed(2)} ms`,
      `average results  ${(hits / QUERIES).toFixed(1)}`,
      `optimize         ${optimizeMs.toFixed(0)} ms`,
      `segments         ${stats.segments} (${(segmentBytes / 1024 / 1024).toFixed(1)} MiB)`,
      `documents        ${(documentBytes / 1024 / 1024).toFixed(1)} MiB on disk`,
      `terms            ${stats.indexedTerms}`,
    ].join('\n') + '\n',
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`bench: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
