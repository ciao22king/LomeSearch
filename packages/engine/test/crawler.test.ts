import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SearchIndex } from '../src/index/index.js';
import { Crawler } from '../src/crawl/crawler.js';

interface Fixture {
  server: Server;
  origin: string;
  requests: string[];
  close(): Promise<void>;
}

async function startFixture(): Promise<Fixture> {
  const requests: string[] = [];
  const pages = new Map<string, { title: string; body: string }>([
    [
      '/',
      {
        title: 'Home page',
        body: '<h1>Home</h1><p>browser privacy indice</p><a href="/a">A</a><a href="/private/x">Private</a><a href="/nofollow" rel="nofollow">No follow</a><a href="/missing">Missing</a>',
      },
    ],
    [
      '/a',
      {
        title: 'Pagina A',
        body: `<p>${'alfa '.repeat(30)}contenuto della pagina a</p><a href="/b">B</a>`,
      },
    ],
    ['/b', { title: 'Pagina B', body: `<p>${'beta '.repeat(30)}contenuto della pagina b</p>` }],
    ['/private/x', { title: 'Privata', body: '<p>non deve essere scansionata</p>' }],
    ['/nofollow', { title: 'Nofollow', body: '<p>non deve essere seguita</p>' }],
    [
      '/sitemap-page',
      { title: 'Sitemap page', body: `<p>${'gamma '.repeat(30)}elencata solo nella sitemap</p>` },
    ],
  ]);

  let origin = '';
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', origin || 'http://127.0.0.1');
    requests.push(url.pathname);
    if (url.pathname === '/robots.txt') {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end(`User-agent: *\nDisallow: /private\nSitemap: ${origin}/sitemap.xml\n`);
      return;
    }
    if (url.pathname === '/sitemap.xml') {
      response.writeHead(200, { 'content-type': 'application/xml' });
      response.end(
        `<?xml version="1.0"?><urlset><url><loc>${origin}/sitemap-page</loc></url></urlset>`,
      );
      return;
    }
    const page = pages.get(url.pathname);
    if (!page) {
      response.writeHead(404, { 'content-type': 'text/html' });
      response.end('<title>404</title>not found');
      return;
    }
    const etag = `"${url.pathname}-v1"`;
    if (request.headers['if-none-match'] === etag) {
      response.writeHead(304, { etag });
      response.end();
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', etag });
    response.end(
      `<!doctype html><html lang="it"><head><title>${page.title}</title><meta name="description" content="descrizione ${page.title}"></head><body>${page.body}</body></html>`,
    );
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  origin = `http://127.0.0.1:${port}`;
  return {
    server,
    origin,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test('crawler respects robots, nofollow, sitemaps and conditional requests', async () => {
  const fixture = await startFixture();
  const dir = mkdtempSync(join(tmpdir(), 'lomesearch-crawl-'));
  const index = SearchIndex.open(dir, { flushThreshold: 100 });

  try {
    const crawler = new Crawler({
      seeds: [`${fixture.origin}/`],
      index,
      maxPages: 20,
      maxDepth: 3,
      sameSite: true,
      concurrency: 2,
      perHostDelayMs: 0,
      commitEvery: 100,
    });
    const stats = await crawler.run([`${fixture.origin}/`]);
    assert.equal(stats.errors, 0);
    assert.equal(stats.indexed, 4, `indexed ${stats.indexed}`);
    assert.ok(!fixture.requests.includes('/private/x'), 'robots.txt was ignored');
    assert.ok(!fixture.requests.includes('/nofollow'), 'nofollow link was followed');

    assert.equal(index.search('browser').results.length, 1);
    assert.equal(index.search('"beta beta"').results.length, 1);
    assert.equal(index.search('"beta alfa"').results.length, 0);
    assert.equal(index.search('sitemap').results.length, 1);
    const stored = index.storedDocument(`${fixture.origin}/a`);
    assert.ok(stored?.etag.startsWith('"/a-v1"'));
    assert.equal(stored?.site, '127.0.0.1');

    fixture.requests.length = 0;
    const secondCrawler = new Crawler({
      seeds: [`${fixture.origin}/`],
      index,
      maxPages: 20,
      maxDepth: 3,
      sameSite: true,
      concurrency: 2,
      perHostDelayMs: 0,
      commitEvery: 100,
    });
    const second = await secondCrawler.run([`${fixture.origin}/`]);
    assert.equal(second.indexed, 0, 'conditional requests should avoid reindexing');
    assert.ok(second.skipped >= 4);
  } finally {
    index.close();
    await fixture.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('crawler deduplicates near-identical pages', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lomesearch-dup-'));
  const index = SearchIndex.open(dir, { flushThreshold: 100 });
  const repeated = 'identico '.repeat(100);
  let origin = '';
  const server = createServer((request, response) => {
    const path = (request.url ?? '/').split('?')[0]!;
    if (path === '/robots.txt') {
      response.writeHead(404);
      response.end();
      return;
    }
    let body = `<a href="/copy1">uno</a><a href="/copy2">due</a><p>pagina iniziale con link</p>`;
    let title = 'Home';
    if (path === '/copy1' || path === '/copy2') {
      body = `<p>${repeated}</p>`;
      title = 'Copia';
    }
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(`<html><head><title>${title}</title></head><body>${body}</body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  origin = `http://127.0.0.1:${port}`;
  try {
    const crawler = new Crawler({
      seeds: [`${origin}/`],
      index,
      maxPages: 10,
      maxDepth: 2,
      perHostDelayMs: 0,
      concurrency: 1,
    });
    const stats = await crawler.run([`${origin}/`]);
    assert.equal(stats.indexed, 2, `indexed ${stats.indexed}`);
    assert.ok(stats.skipped >= 1);
    assert.equal(index.search('identico').results.length, 1);
  } finally {
    index.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});
