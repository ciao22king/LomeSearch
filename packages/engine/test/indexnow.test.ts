import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  IndexNowClient,
  IndexNowVerifier,
  buildKeyLocation,
  generateKey,
  validatePayload,
  verifyKeyFile,
} from '../src/indexnow.js';

const KEY = 'abcdef1234567890';
const HOST = 'example.com';

test('generateKey produces a valid key', () => {
  const key = generateKey();
  assert.match(key, /^[a-zA-Z0-9-]{8,128}$/);
  assert.notEqual(key, generateKey());
  assert.equal(buildKeyLocation(HOST, key), `https://${HOST}/${key}.txt`);
});

test('validatePayload accepts a well formed submission', () => {
  const result = validatePayload({
    host: HOST,
    key: KEY,
    urlList: ['https://example.com/a', 'https://www.example.com/b'],
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.payload.urlList.length, 2);
    assert.equal(result.payload.host, HOST);
  }
});

test('validatePayload rejects bad hosts, keys and URLs', () => {
  assert.equal(validatePayload(null).ok, false);
  assert.equal(validatePayload({ host: 'not a host', key: KEY, urlList: ['https://x.test'] }).ok, false);
  assert.equal(validatePayload({ host: '127.0.0.1', key: KEY, urlList: ['http://127.0.0.1/'] }).ok, false);
  assert.equal(validatePayload({ host: HOST, key: 'short', urlList: ['https://example.com/'] }).ok, false);
  assert.equal(validatePayload({ host: HOST, key: KEY, urlList: [] }).ok, false);

  const foreign = validatePayload({ host: HOST, key: KEY, urlList: ['https://other.org/a'] });
  assert.equal(foreign.ok, false);
  if (!foreign.ok) assert.equal(foreign.status, 422);

  const scheme = validatePayload({ host: HOST, key: KEY, urlList: ['ftp://example.com/a'] });
  assert.equal(scheme.ok, false);

  const badLocation = validatePayload({
    host: HOST,
    key: KEY,
    keyLocation: 'https://attacker.example/key.txt',
    urlList: ['https://example.com/a'],
  });
  assert.equal(badLocation.ok, false);
});

test('verifyKeyFile accepts only a matching key file', async () => {
  const valid = await verifyKeyFile(
    { host: HOST, key: KEY, urlList: [] },
    {
      fetchImpl: (async () => new Response(KEY)) as typeof fetch,
    },
  );
  assert.equal(valid, 'valid');

  const wrong = await verifyKeyFile(
    { host: HOST, key: KEY, urlList: [] },
    { fetchImpl: (async () => new Response('another-key')) as typeof fetch },
  );
  assert.equal(wrong, 'invalid');

  const missing = await verifyKeyFile(
    { host: HOST, key: KEY, urlList: [] },
    { fetchImpl: (async () => new Response('not found', { status: 404 })) as typeof fetch },
  );
  assert.equal(missing, 'invalid');

  const unreachable = await verifyKeyFile(
    { host: HOST, key: KEY, urlList: [] },
    {
      fetchImpl: (async () => {
        throw new Error('offline');
      }) as typeof fetch,
    },
  );
  assert.equal(unreachable, 'unreachable');
});

test('verifyKeyFile refuses redirects to another host', async () => {
  let calls = 0;
  const result = await verifyKeyFile(
    { host: HOST, key: KEY, urlList: [] },
    {
      fetchImpl: (async () => {
        calls++;
        return new Response(null, {
          status: 302,
          headers: { location: 'https://attacker.example/key.txt' },
        });
      }) as typeof fetch,
    },
  );
  assert.equal(result, 'invalid');
  assert.equal(calls, 1);
});

test('IndexNowVerifier caches positive and negative results', async () => {
  let calls = 0;
  const verifier = new IndexNowVerifier({
    fetchImpl: (async () => {
      calls++;
      return new Response(KEY);
    }) as typeof fetch,
  });
  const payload = { host: HOST, key: KEY, urlList: [] };
  assert.equal(await verifier.verify(payload), 'valid');
  assert.equal(await verifier.verify(payload), 'valid');
  assert.equal(calls, 1);
});

test('IndexNowClient posts a JSON payload', async () => {
  let captured: { url: string; body: unknown } | null = null;
  const client = new IndexNowClient({
    host: HOST,
    key: KEY,
    endpoint: 'https://search.example/indexnow',
    fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
      captured = { url: String(input), body: JSON.parse(String(init?.body)) };
      return new Response('', { status: 200 });
    }) as typeof fetch,
  });
  const result = await client.submit(['https://example.com/a', 'https://example.com/b']);
  assert.equal(result.ok, true);
  assert.equal(result.submitted, 2);
  assert.equal(captured!.url, 'https://search.example/indexnow');
  assert.deepEqual(captured!.body, {
    host: HOST,
    key: KEY,
    urlList: ['https://example.com/a', 'https://example.com/b'],
  });
});

test('IndexNowClient reports endpoint failures', async () => {
  const client = new IndexNowClient({
    host: HOST,
    key: KEY,
    fetchImpl: (async () => new Response('bad key', { status: 403 })) as typeof fetch,
  });
  const result = await client.submit(['https://example.com/a']);
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
});
