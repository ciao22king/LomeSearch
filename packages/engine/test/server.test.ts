import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SearchIndex } from '../src/index/index.js';
import { isAllowedHost, startSearchServer } from '../src/server/http.js';
import { IndexNowVerifier } from '../src/indexnow.js';

const KEY = 'lomesearchkey1234';
const HOST = 'example.com';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'lomesearch-server-'));
}

test('search server serves pages, JSON, suggestions and IndexNow', async () => {
  const dir = tempDir();
  const index = SearchIndex.open(dir);
  index.addDocument({
    url: 'https://example.com/privacy',
    title: 'Browser privato',
    description: 'Un browser che non registra le query',
    body: 'Il browser privato non salva la cronologia e non invia dati a terzi.',
    lang: 'it',
  });
  index.addDocument({
    url: 'https://example.org/search',
    title: 'Motore di ricerca',
    description: 'Indice locale',
    body: 'Un motore di ricerca con indice locale e ranking BM25.',
    lang: 'it',
  });
  index.commit();

  const submitted: string[] = [];
  const server = await startSearchServer({
    index,
    port: 0,
    engineHost: 'search.local',
    engineKey: KEY,
    submitUrls: (urls) => {
      submitted.push(...urls);
      return urls.length;
    },
    verifier: new IndexNowVerifier({
      fetchImpl: (async () => new Response(KEY)) as typeof fetch,
    }),
    rateLimits: { searchPerMinute: 1_000, indexNowPerMinute: 1_000 },
  });

  try {
    const health = await fetch(`${server.origin}/health`);
    assert.equal(health.status, 200);
    const healthJson = (await health.json()) as { status: string };
    assert.equal(healthJson.status, 'ok');

    const json = await fetch(`${server.origin}/search?q=browser&format=json`);
    assert.equal(json.status, 200);
    const payload = (await json.json()) as { total: number; results: Array<{ url: string }> };
    assert.equal(payload.total, 1);
    assert.equal(payload.results[0]!.url, 'https://example.com/privacy');
    assert.equal(json.headers.get('access-control-allow-origin'), null);
    assert.equal(json.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(json.headers.get('x-content-type-options'), 'nosniff');

    const html = await fetch(`${server.origin}/search?q=browser`);
    const text = await html.text();
    assert.equal(html.status, 200);
    assert.match(text, /<mark>browser<\/mark>/);
    assert.match(text, /name="q"/);
    assert.match(text, /Nessun cookie/);

    const home = await fetch(`${server.origin}/`);
    assert.match(await home.text(), /documenti indicizzati/);

    const suggest = await fetch(`${server.origin}/suggest?q=priv`);
    const suggestions = (await suggest.json()) as [string, string[]];
    assert.equal(suggestions[0], 'priv');
    assert.ok(suggestions[1].includes('privato') || suggestions[1].includes('privato.'));

    const openSearch = await fetch(`${server.origin}/opensearch.xml`);
    const openSearchText = await openSearch.text();
    assert.match(openSearchText, /<ShortName>LomeSearch<\/ShortName>/);
    assert.match(openSearchText, /search\?q=\{searchTerms\}/);

    const keyFile = await fetch(`${server.origin}/indexnow/${KEY}.txt`);
    assert.equal(keyFile.status, 200);
    assert.equal(await keyFile.text(), KEY);
    assert.equal((await fetch(`${server.origin}/${KEY}.txt`)).status, 200);
    assert.equal((await fetch(`${server.origin}/indexnow/wrongkey123.txt`)).status, 404);

    const robots = await fetch(`${server.origin}/robots.txt`);
    assert.match(await robots.text(), /Disallow: \//);

    const stats = await fetch(`${server.origin}/stats`);
    const statsJson = (await stats.json()) as { index: { documents: number } };
    assert.equal(statsJson.index.documents, 2);

    const notFound = await fetch(`${server.origin}/nope`);
    assert.equal(notFound.status, 404);

    const post = await fetch(`${server.origin}/indexnow`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        host: HOST,
        key: KEY,
        urlList: ['https://example.com/privacy', 'https://example.com/new'],
      }),
    });
    assert.equal(post.status, 200);
    const postJson = (await post.json()) as { accepted: number; queued: number };
    assert.equal(postJson.accepted, 2);
    assert.equal(postJson.queued, 2);
    assert.deepEqual(submitted, ['https://example.com/privacy', 'https://example.com/new']);

    const foreign = await fetch(`${server.origin}/indexnow`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ host: HOST, key: KEY, urlList: ['https://other.org/x'] }),
    });
    assert.equal(foreign.status, 422);

    const badKey = await fetch(`${server.origin}/indexnow`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ host: HOST, key: 'bad', urlList: ['https://example.com/x'] }),
    });
    assert.equal(badKey.status, 403);

    const wrongMethod = await fetch(`${server.origin}/indexnow`);
    assert.equal(wrongMethod.status, 405);
  } finally {
    await server.close();
    index.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('indexnow rejects a key file that does not match', async () => {
  const dir = tempDir();
  const index = SearchIndex.open(dir);
  index.commit();
  const server = await startSearchServer({
    index,
    port: 0,
    engineHost: 'search.local',
    submitUrls: () => 0,
    verifier: new IndexNowVerifier({
      fetchImpl: (async () => new Response('different-key')) as typeof fetch,
    }),
    rateLimits: { indexNowPerMinute: 1_000 },
  });
  try {
    const response = await fetch(`${server.origin}/indexnow`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ host: HOST, key: KEY, urlList: ['https://example.com/x'] }),
    });
    assert.equal(response.status, 403);
  } finally {
    await server.close();
    index.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('isAllowedHost accepts loopback, bind address and explicit names only', () => {
  assert.equal(isAllowedHost('127.0.0.1:7717', '127.0.0.1'), true);
  assert.equal(isAllowedHost('localhost:7717', '127.0.0.1'), true);
  assert.equal(isAllowedHost('[::1]:7717', '127.0.0.1'), true);
  assert.equal(isAllowedHost('search.local', '127.0.0.1'), false);
  assert.equal(isAllowedHost('search.local:7717', '127.0.0.1', ['search.local']), true);
  assert.equal(isAllowedHost('attacker.example', '127.0.0.1'), false);
  assert.equal(isAllowedHost(undefined, '127.0.0.1'), false);
});

test('server rejects foreign Host headers and never sends CORS wildcards', async () => {
  const dir = tempDir();
  const index = SearchIndex.open(dir);
  index.addDocument({
    url: 'https://example.com/privacy',
    title: 'Privacy',
    body: 'Indice locale, nessuna query registrata.',
  });
  index.commit();
  const server = await startSearchServer({
    index,
    port: 0,
    engineHost: 'search.local',
    submitUrls: () => 0,
  });
  try {
    const status = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(
        { host: '127.0.0.1', port: server.port, path: '/health', headers: { host: 'attacker.example' } },
        (response) => {
          response.resume();
          resolve(response.statusCode ?? 0);
        },
      );
      request.on('error', reject);
      request.end();
    });
    assert.equal(status, 421);

    const suggest = await fetch(`${server.origin}/suggest?q=priv`);
    assert.equal(suggest.status, 200);
    assert.equal(suggest.headers.get('access-control-allow-origin'), null);

    const preflight = await fetch(`${server.origin}/suggest`, { method: 'OPTIONS' });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), null);
  } finally {
    await server.close();
    index.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
