import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryIndex, type MemoryDocument } from '../src/memory/index.js';

const docs: MemoryDocument[] = [
  {
    url: 'https://example.com/privacy',
    title: 'Privacy browser',
    description: 'A browser that keeps queries local',
    body: 'The privacy browser keeps the index on disk and never sends queries to a third party. Local ranking uses BM25.',
    lang: 'en',
    site: 'example.com',
    fetchedAt: Date.UTC(2026, 0, 1),
  },
  {
    url: 'https://example.org/search',
    title: 'Local search engine',
    description: 'Inverted index on your machine',
    body: 'A local search engine with an inverted index, BM25 ranking and a small HTTP server. Queries stay on loopback.',
    lang: 'en',
    site: 'example.org',
    fetchedAt: Date.UTC(2026, 1, 1),
  },
  {
    url: 'https://docs.example.net/guide',
    title: 'Crawler guide',
    description: 'How to index a site',
    body: 'Run the crawler to index a site. The crawler respects the robots file and keeps a per-host delay.',
    lang: 'it',
    site: 'example.net',
    fetchedAt: Date.UTC(2026, 2, 1),
  },
];

test('the memory index ranks by relevance like the disk index', () => {
  const index = new MemoryIndex(docs);
  const response = index.search('privacy browser');
  assert.equal(response.total, 1);
  assert.equal(response.results[0]?.url, 'https://example.com/privacy');
  assert.match(response.results[0]!.snippet, /<mark>browser<\/mark>/);
  assert.ok(response.tookMs >= 0);
  assert.equal(index.size, 3);
  assert.ok(index.stats().terms > 20);
});

test('phrases, filters and fallbacks work in memory', () => {
  const index = new MemoryIndex(docs);
  assert.equal(index.search('"inverted index"').total, 1);
  assert.equal(index.search('index', { limit: 5 }).total, 3);
  const filtered = index.search('site:example.net crawler');
  assert.equal(filtered.total, 1);
  assert.equal(filtered.results[0]?.url, 'https://docs.example.net/guide');
  assert.equal(index.search('lang:it crawler').total, 1);
  const disjunction = index.search('bm25 OR robots');
  assert.equal(disjunction.total, 3);
});

test('an unknown term is empty, and a typo suggests the real word', () => {
  const index = new MemoryIndex(docs);
  const empty = index.search('zzzqqq');
  assert.equal(empty.results.length, 0);
  assert.equal(empty.total, 0);
  // A one-letter transposition of a stem is corrected to the surface form.
  const typo = index.search('privcy');
  assert.equal(typo.suggestion, 'privacy');
  assert.equal(typo.results[0]?.url, 'https://example.com/privacy');
});

test('suggestions complete prefixes from the vocabulary', () => {
  const index = new MemoryIndex(docs);
  assert.deepEqual(index.suggest('craw'), ['crawler']);
  assert.ok(index.suggest('in').includes('index'));
  assert.deepEqual(index.suggest('zz'), []);
  assert.deepEqual(index.suggest('c'), [], 'one letter is below the minimum prefix');
});

test('an empty corpus answers instead of throwing', () => {
  const index = new MemoryIndex([]);
  const response = index.search('anything');
  assert.equal(response.total, 0);
  assert.deepEqual(response.results, []);
  assert.equal(index.stats().documents, 0);
});
