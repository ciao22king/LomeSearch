import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SearchIndex } from '../src/index/index.js';
import { startSearchServer } from '../src/server/http.js';
import {
  EXTERNAL_ENGINES,
  createWebProvider,
  externalSearchUrl,
  isExternalEngineId,
  isWebProviderId,
  WebSearchError,
  type WebProvider,
} from '../src/web/provider.js';

function jsonFetch(payload: unknown, seen?: { url?: string; headers?: Record<string, string> }): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    if (seen) {
      seen.url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      seen.headers = (init?.headers ?? {}) as Record<string, string>;
    }
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

function indexWith(host: string) {
  const dir = mkdtempSync(join(tmpdir(), 'lomesearch-web-'));
  const index = SearchIndex.open(dir);
  index.addDocument({
    url: `https://${host}/privacy`,
    title: 'Privacy browser',
    description: 'A browser that does not log queries',
    body: 'The privacy browser keeps the index on disk and never sends queries anywhere.',
    lang: 'en',
  });
  index.commit();
  return index;
}

test('external search links use the right parameter and encode the query', () => {
  assert.equal(externalSearchUrl('bing', 'due gatti'), 'https://www.bing.com/search?q=due+gatti');
  assert.equal(
    externalSearchUrl('startpage', 'a&b'),
    'https://www.startpage.com/sp/search?query=a%26b',
  );
  assert.equal(isExternalEngineId('bing'), true);
  assert.equal(isExternalEngineId('evil.example'), false);
  assert.equal(isExternalEngineId(null), false);
  assert.deepEqual(Object.keys(EXTERNAL_ENGINES).sort(), [
    'bing',
    'brave',
    'duckduckgo',
    'google',
    'mojeek',
    'startpage',
  ]);
});

test('brave provider sends the token and normalises the payload', async () => {
  const seen: { url?: string; headers?: Record<string, string> } = {};
  const provider = createWebProvider({
    id: 'brave',
    apiKey: 'secret-token',
    fetchImpl: jsonFetch(
      {
        web: {
          results: [
            {
              title: 'Privacy first',
              url: 'https://www.example.com/page',
              description: '  spaced\n out  description ',
            },
            { title: 'Broken entry', url: 'javascript:alert(1)' },
            { url: 'https://no-title.example' },
          ],
        },
      },
      seen,
    ),
  });

  const results = await provider.search('privacy', 5);
  assert.equal(provider.name, 'Brave Search');
  assert.equal(provider.host, 'api.search.brave.com');
  assert.equal(results.length, 1);
  assert.deepEqual(results[0], {
    title: 'Privacy first',
    url: 'https://www.example.com/page',
    snippet: 'spaced out description',
    site: 'example.com',
  });
  const called = new URL(seen.url!);
  assert.equal(called.pathname, '/res/v1/web/search');
  assert.equal(called.searchParams.get('q'), 'privacy');
  assert.equal(called.searchParams.get('count'), '5');
  assert.equal(seen.headers!['x-subscription-token'], 'secret-token');
  assert.equal(seen.headers!.dnt, '1');
});

test('searxng provider talks to the configured instance', async () => {
  const seen: { url?: string } = {};
  const provider = createWebProvider({
    id: 'searxng',
    baseUrl: 'http://127.0.0.1:8888',
    fetchImpl: jsonFetch(
      { results: [{ title: 'Local first', url: 'https://example.org/a', content: 'snippet' }] },
      seen,
    ),
  });
  const results = await provider.search('local', 3);
  assert.equal(provider.host, '127.0.0.1:8888');
  assert.equal(results[0]!.site, 'example.org');
  const called = new URL(seen.url!);
  assert.equal(called.pathname, '/search');
  assert.equal(called.searchParams.get('format'), 'json');
});

test('providers reject missing credentials and bad responses', async () => {
  assert.throws(() => createWebProvider({ id: 'searxng' }), WebSearchError);
  assert.throws(() => createWebProvider({ id: 'searxng', baseUrl: 'ftp://x' }), WebSearchError);
  const noKey = createWebProvider({ id: 'brave', fetchImpl: jsonFetch({}) });
  await assert.rejects(() => noKey.search('x', 3), /missing API key/);

  const failing = createWebProvider({
    id: 'searxng',
    baseUrl: 'https://searx.example',
    fetchImpl: (async () => new Response('nope', { status: 503 })) as typeof fetch,
  });
  await assert.rejects(() => failing.search('x', 3), /HTTP 503/);

  const garbage = createWebProvider({
    id: 'searxng',
    baseUrl: 'https://searx.example',
    fetchImpl: (async () => new Response('<html>', { status: 200 })) as typeof fetch,
  });
  await assert.rejects(() => garbage.search('x', 3), /invalid JSON/);

  assert.equal(isWebProviderId('brave'), true);
  assert.equal(isWebProviderId('bing'), false);
});

test('the page offers an external engine, but only for known ids', async () => {
  const server = await startSearchServer({
    index: indexWith('example.com'),
    port: 0,
    submitUrls: (urls) => urls.length,
    rateLimits: { searchPerMinute: 1_000, indexNowPerMinute: 1_000 },
  });
  try {
    const page = await (await fetch(`${server.origin}/search?q=privacy&ext=bing`)).text();
    assert.match(page, /Search &ldquo;privacy&rdquo; on Bing/);
    assert.match(page, /https:\/\/www\.bing\.com\/search\?q=privacy/);
    assert.match(page, /Nothing leaves this machine until you click/);
    assert.match(page, /rel="noreferrer noopener"/);
    assert.match(page, /<input type="hidden" name="ext" value="bing">/);

    // An unknown id cannot be injected: the page falls back to the safe default.
    const unknown = await (await fetch(`${server.origin}/search?q=privacy&ext=evil.example`)).text();
    assert.doesNotMatch(unknown, /evil\.example/);
    assert.match(unknown, /on Bing/);

    // With no `ext` the page offers Bing: the browser's default hand-off.
    const plain = await (await fetch(`${server.origin}/search?q=privacy`)).text();
    assert.match(plain, /on Bing/);
    assert.match(plain, /https:\/\/www\.bing\.com\/search\?q=privacy/);

    const disabled = await startSearchServer({
      index: indexWith('example.com'),
      port: 0,
      submitUrls: (urls) => urls.length,
      externalOffer: null,
      rateLimits: { searchPerMinute: 1_000, indexNowPerMinute: 1_000 },
    });
    try {
      const bare = await (await fetch(`${disabled.origin}/search?q=privacy`)).text();
      assert.doesNotMatch(bare, /class="ext"/);
    } finally {
      await disabled.close();
    }
  } finally {
    await server.close();
  }
});

test('web results render with a disclosure and never replace local ones', async () => {
  const calls: string[] = [];
  const provider: WebProvider = {
    id: 'searxng',
    name: 'SearXNG',
    host: 'searx.internal',
    async search(query) {
      calls.push(query);
      return [{ title: 'Remote hit', url: 'https://remote.example/x', snippet: 'remote snippet', site: 'remote.example' }];
    },
  };
  const server = await startSearchServer({
    index: indexWith('example.com'),
    port: 0,
    submitUrls: (urls) => urls.length,
    webProvider: provider,
    rateLimits: { searchPerMinute: 1_000, indexNowPerMinute: 1_000 },
  });
  try {
    const withoutFlag = await (await fetch(`${server.origin}/search?q=privacy`)).text();
    assert.doesNotMatch(withoutFlag, /Web results from/);
    assert.equal(calls.length, 0);

    const page = await (await fetch(`${server.origin}/search?q=privacy&web=1&ext=brave`)).text();
    assert.equal(calls.length, 1);
    assert.match(page, /Privacy browser/);
    assert.match(page, /Web results from <strong>SearXNG<\/strong> &middot; this query was sent to searx\.internal/);
    assert.match(page, /Remote hit/);
    assert.match(page, /Keep looking on Brave Search/);
    assert.match(page, /<input type="hidden" name="web" value="1">/);
  } finally {
    await server.close();
  }
});

test('a failing provider degrades to the local page', async () => {
  const server = await startSearchServer({
    index: indexWith('example.com'),
    port: 0,
    submitUrls: (urls) => urls.length,
    webProvider: {
      id: 'brave',
      name: 'Brave Search',
      host: 'api.search.brave.com',
      search: async () => {
        throw new WebSearchError('HTTP 401');
      },
    },
    rateLimits: { searchPerMinute: 1_000, indexNowPerMinute: 1_000 },
  });
  try {
    const page = await (await fetch(`${server.origin}/search?q=privacy&web=1`)).text();
    assert.match(page, /Privacy browser/);
    assert.match(page, /Brave Search did not answer: HTTP 401/);
    assert.match(page, /Local results above are unaffected/);
  } finally {
    await server.close();
  }
});
