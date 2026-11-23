import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SearchIndex } from '../src/index/index.js';
import { SegmentBuilder, SegmentReader } from '../src/index/segment.js';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'lomesearch-test-'));
}

const DOCUMENTS = [
  {
    url: 'https://example.com/browser',
    title: 'Privacy browser',
    description: 'Un browser che rispetta la privacy',
    headings: ['Navigazione privata'],
    body: 'Un browser che rispetta la privacy e non registra le query degli utenti.',
    lang: 'it',
    outlinks: ['https://example.com/search'],
  },
  {
    url: 'https://example.com/search',
    title: 'Search engine locale',
    description: 'Motore di ricerca con indice invertito',
    headings: ['Indice'],
    body: 'Motore di ricerca locale con indice invertito e ranking BM25.',
    lang: 'it',
    outlinks: ['https://other.org/page'],
  },
  {
    url: 'https://other.org/page',
    title: 'Altra pagina',
    description: 'Testo di esempio',
    headings: ['Esempio'],
    body: 'Testo di esempio sul browser e sulla ricerca sul web.',
    lang: 'en',
    outlinks: [],
  },
];

test('segment round trip preserves postings and positions', () => {
  const builder = new SegmentBuilder();
  builder.addPosting('browser', 1, [2, 0, 3, 0, 0], [[0, 5], [], [1, 4, 9], []]);
  builder.addPosting('browser', 7, [0, 0, 1, 0, 0], [[], [], [2], []]);
  builder.addPosting('privacy', 1, [1, 0, 1, 0, 0], [[1], [], [0], []]);
  builder.setLengths(1, [3, 2, 12, 2, 1]);
  builder.setLengths(7, [0, 0, 4, 1, 0]);

  const dir = tempDir();
  const path = join(dir, 'seg.seg');
  const buffer = builder.serialize();
  assert.ok(buffer.length > 0);

  writeFileSync(path, buffer);
  const reader = SegmentReader.open(path);
  assert.equal(reader.termCount, 2);
  assert.equal(reader.docCount, 2);
  assert.equal(reader.termIndex('browser'), 0);
  assert.equal(reader.termIndex('privacy'), 1);
  assert.equal(reader.termIndex('missing'), -1);
  assert.deepEqual([...reader.lengths.get(1)!], [3, 2, 12, 2, 1]);

  const list = reader.readTerm('browser')!;
  assert.deepEqual([...list.docIds], [1, 7]);
  assert.equal(list.tfs[0], 2);
  assert.equal(list.tfs[2], 3);
  assert.deepEqual([...list.posData[0]!.subarray(list.posOffsets[0]![0]!, list.posOffsets[0]![1]!)], [0, 5]);
  assert.deepEqual([...list.posData[2]!.subarray(list.posOffsets[2]![0]!, list.posOffsets[2]![1]!)], [1, 4, 9]);

  const prefix: string[] = [];
  reader.scanPrefix('pri', (term) => {
    prefix.push(term);
  });
  assert.deepEqual(prefix, ['privacy']);

  rmSync(dir, { recursive: true, force: true });
});

test('indexing and ranking', () => {
  const dir = tempDir();
  const index = SearchIndex.open(dir);
  for (const document of DOCUMENTS) index.addDocument(document);
  index.commit();

  const browser = index.search('browser');
  assert.equal(browser.results.length, 2);
  assert.equal(browser.results[0]!.url, 'https://example.com/browser');
  assert.ok(browser.results[0]!.snippet.includes('<mark>'));
  assert.ok(browser.tookMs >= 0);

  const phrase = index.search('"non registra"');
  assert.equal(phrase.results.length, 1);
  assert.equal(phrase.results[0]!.url, 'https://example.com/browser');

  const phraseMiss = index.search('"registra non"');
  assert.equal(phraseMiss.results.length, 0);

  const andQuery = index.search('browser ricerca', { strict: true });
  assert.equal(andQuery.results.length, 1);
  assert.equal(andQuery.results[0]!.url, 'https://other.org/page');

  const relaxed = index.search('browser ricerca');
  assert.equal(relaxed.relaxed, true);
  assert.ok(relaxed.results.length >= 2);

  const exclusion = index.search('ricerca -locale');
  assert.equal(exclusion.results.length, 1);
  assert.equal(exclusion.results[0]!.url, 'https://other.org/page');

  const disjunction = index.search('privacy OR indice');
  assert.ok(disjunction.results.length >= 2);

  const fieldQuery = index.search('intitle:privacy');
  assert.equal(fieldQuery.results.length, 1);
  assert.equal(fieldQuery.results[0]!.url, 'https://example.com/browser');

  const siteQuery = index.search('site:example.com');
  assert.equal(siteQuery.results.length, 2);
  assert.ok(siteQuery.results.every((result) => result.site === 'example.com'));

  const langQuery = index.search('lang:en');
  assert.equal(langQuery.results.length, 1);
  assert.equal(langQuery.results[0]!.url, 'https://other.org/page');

  const paged = index.search('browser', { limit: 1, offset: 1 });
  assert.equal(paged.results.length, 1);
  assert.equal(paged.results[0]!.url, 'https://other.org/page');

  index.close();
  rmSync(dir, { recursive: true, force: true });
});

test('suggestions and spelling correction', () => {
  const dir = tempDir();
  const index = SearchIndex.open(dir);
  for (const document of DOCUMENTS) index.addDocument(document);
  index.commit();

  const suggestions = index.suggest('pri');
  assert.ok(suggestions.includes('privacy'), `suggestions: ${suggestions.join(', ')}`);

  const typo = index.search('provacy');
  assert.equal(typo.results.length, 1);
  assert.equal(typo.suggestion, 'privacy');
  assert.equal(typo.results[0]!.url, 'https://example.com/browser');

  index.close();
  rmSync(dir, { recursive: true, force: true });
});

test('updates replace the old document', () => {
  const dir = tempDir();
  const index = SearchIndex.open(dir);
  index.addDocument({
    url: 'https://example.com/articolo',
    title: 'Privacy browser',
    body: 'Un browser che rispetta la privacy.',
  });
  index.commit();
  assert.equal(index.search('browser').results.length, 1);

  index.addDocument({
    url: 'https://example.com/articolo',
    title: 'Titolo nuovo',
    body: 'Contenuto completamente diverso senza i termini precedenti.',
  });
  index.commit();
  assert.equal(index.documentCount, 1);
  assert.equal(index.search('browser').results.length, 0);
  assert.equal(index.search('completamente').results.length, 1);

  assert.equal(index.deleteUrl('https://example.com/articolo'), true);
  index.commit();
  assert.equal(index.documentCount, 0);
  assert.equal(index.search('completamente').results.length, 0);
  index.close();
  rmSync(dir, { recursive: true, force: true });
});

test('index persists across reopen', () => {
  const dir = tempDir();
  const first = SearchIndex.open(dir);
  for (const document of DOCUMENTS) first.addDocument(document);
  first.commit();
  first.close();

  const second = SearchIndex.open(dir);
  assert.equal(second.documentCount, 3);
  const results = second.search('indice invertito');
  assert.equal(results.results.length, 1);
  assert.equal(results.results[0]!.url, 'https://example.com/search');
  const stored = second.storedDocument('https://example.com/browser');
  assert.equal(stored?.title, 'Privacy browser');
  second.close();
  rmSync(dir, { recursive: true, force: true });
});

test('multiple segments are searched together and merged by optimize', () => {
  const dir = tempDir();
  const index = SearchIndex.open(dir, { flushThreshold: 2, mergeFactor: 8 });
  for (let i = 0; i < 8; i++) {
    index.addDocument({
      url: `https://example.com/p${i}`,
      title: `Documento numero ${i}`,
      body: `parola comune contenuto specifico${i}`,
    });
  }
  index.commit();
  assert.ok(index.stats().segments >= 2);
  const before = index.search('comune');
  assert.equal(before.results.length, 8);

  const optimized = index.optimize();
  assert.ok(optimized.mergedSegments >= 2);
  assert.equal(index.stats().segments, 1);
  const after = index.search('comune');
  assert.equal(after.results.length, 8);
  assert.deepEqual(
    after.results.map((result) => result.url).sort(),
    before.results.map((result) => result.url).sort(),
  );
  index.close();
  rmSync(dir, { recursive: true, force: true });
});

test('deleted documents are removed by optimize', () => {
  const dir = tempDir();
  const index = SearchIndex.open(dir, { flushThreshold: 2 });
  for (let i = 0; i < 4; i++) {
    index.addDocument({
      url: `https://example.com/d${i}`,
      title: `Pagina ${i}`,
      body: 'contenuto condiviso',
    });
  }
  index.deleteUrl('https://example.com/d0');
  index.deleteUrl('https://example.com/d2');
  index.commit();
  assert.equal(index.search('condiviso').results.length, 2);
  assert.equal(index.stats().tombstones, 2);

  const result = index.optimize();
  assert.equal(result.vacuumedDocuments, 2);
  assert.equal(index.stats().tombstones, 0);
  assert.equal(index.search('condiviso').results.length, 2);
  index.close();
  rmSync(dir, { recursive: true, force: true });
});

test('empty and filter-only queries behave', () => {
  const dir = tempDir();
  const index = SearchIndex.open(dir);
  for (const document of DOCUMENTS) index.addDocument(document);
  index.commit();

  assert.equal(index.search('').results.length, 0);
  assert.equal(index.search('   ').results.length, 0);
  assert.equal(index.search('termineinesistente').results.length, 0);

  const byDate = index.search('site:example.com', { sort: 'date' });
  assert.equal(byDate.results.length, 2);

  index.close();
  rmSync(dir, { recursive: true, force: true });
});
