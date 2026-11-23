import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeEntities, extractHtml, stripTags } from '../src/core/html.js';
import { decodeHtml, detectCharset } from '../src/core/encoding.js';
import { RobotsTxt } from '../src/core/robots.js';
import { hammingDistance, simhash } from '../src/core/simhash.js';
import { parseSitemapXml } from '../src/crawl/sitemap.js';
import { Frontier } from '../src/crawl/frontier.js';

test('extractHtml reads the document head and body', () => {
  const page = extractHtml(`<!doctype html>
<html lang="it">
<head>
  <title> Guida   al  browser </title>
  <meta name="description" content="Una guida pratica">
  <meta name="robots" content="index,follow">
  <meta property="og:title" content="Titolo social">
  <link rel="canonical" href="https://example.com/guida">
  <base href="https://example.com/docs/">
  <script>var hidden = "non deve apparire";</script>
  <style>.hidden { display: none }</style>
</head>
<body>
  <h1>Primo capitolo</h1>
  <h2>Sottotitolo</h2>
  <p>Ciao &amp; benvenuti nel <b>mondo</b> del web.</p>
  <p>Prezzo: 10&nbsp;&euro; &#8364; &#x41;</p>
  <img src="x.png" alt="descrizione immagine">
  <a href="/a" rel="nofollow">Link A</a>
  <a href="https://other.example/b">Link B</a>
  <noscript>attiva javascript</noscript>
</body>
</html>`);

  assert.equal(page.title, 'Guida al browser');
  assert.equal(page.description, 'Una guida pratica');
  assert.equal(page.metaRobots, 'index,follow');
  assert.equal(page.ogTitle, 'Titolo social');
  assert.equal(page.canonical, 'https://example.com/guida');
  assert.equal(page.baseHref, 'https://example.com/docs/');
  assert.equal(page.lang, 'it');
  assert.deepEqual(page.headings, ['Primo capitolo', 'Sottotitolo']);
  assert.match(page.text, /Ciao & benvenuti nel mondo del web\./);
  assert.match(page.text, /descrizione immagine/);
  assert.ok(!page.text.includes('non deve apparire'));
  assert.ok(!page.text.includes('display: none'));
  assert.ok(!page.text.includes('attiva javascript'));
  assert.equal(page.links.length, 2);
  assert.equal(page.links[0]!.href, '/a');
  assert.equal(page.links[0]!.nofollow, true);
  assert.equal(page.links[1]!.nofollow, false);
});

test('extractHtml drops menus, sidebars and hidden nodes', () => {
  const page = extractHtml(`<body>
    <header><p>LomeSearch blog</p></header>
    <nav><a href="/a">Casa</a> <a href="/b">Chi siamo</a></nav>
    <aside><p>Pubblicita</p></aside>
    <div role="navigation"><p>Menu laterale</p></div>
    <div aria-hidden="true"><p>Nascosto</p></div>
    <form><input value="cerca"><button>Cerca</button></form>
    <main>
      <h1>Titolo</h1>
      <p>Il contenuto che conta.</p>
    </main>
    <footer><p>Copyright 2026</p></footer>
  </body>`);

  assert.match(page.text, /Il contenuto che conta\./);
  for (const furniture of ['Casa', 'Chi siamo', 'Pubblicita', 'Menu laterale', 'Nascosto', 'Copyright', 'LomeSearch blog']) {
    assert.ok(!page.text.includes(furniture), `unexpected furniture in text: ${furniture}`);
  }
  assert.equal(page.links.length, 2, 'nav links stay available for the frontier');
});

test('extractHtml drops accessibility helpers', () => {
  const page = extractHtml(
    '<a class="skip-to-content" href="#main">Skip to main content</a>' +
      '<p class="sr-only">Solo per screen reader</p><p>Testo reale</p>',
  );
  assert.ok(!page.text.includes('Skip to main content'));
  assert.ok(!page.text.includes('Solo per screen reader'));
  assert.match(page.text, /Testo reale/);
});

test('extractHtml keeps a header that wraps article content', () => {
  const page = extractHtml(
    '<article><header><h1>Titolo articolo</h1><p>Occhiello</p></header><p>Corpo</p></article>',
  );
  assert.match(page.text, /Titolo articolo/);
  assert.match(page.text, /Occhiello/);
  assert.match(page.text, /Corpo/);
});

test('extractHtml unwinds nested boilerplate of the same tag', () => {
  const page = extractHtml('<nav><nav>annidato</nav>ancora menu</nav><p>dopo il menu</p>');
  assert.ok(!page.text.includes('annidato'));
  assert.ok(!page.text.includes('ancora menu'));
  assert.match(page.text, /dopo il menu/);
});

test('extractHtml survives malformed markup', () => {
  const page = extractHtml('<p>uno <b>due<p>tre <a href=x>quattro</a> < 5 &unknown; <div');
  assert.match(page.text, /uno due/);
  assert.match(page.text, /quattro/);
  assert.ok(page.text.includes('< 5'));
  assert.equal(page.links[0]!.href, 'x');
});

test('decodeEntities handles named, decimal and hex references', () => {
  assert.equal(decodeEntities('&amp; &lt; &gt; &quot; &apos;'), '& < > " \'');
  assert.equal(decodeEntities('&#65;&#x42;&#233;'), 'AB\u00e9');
  assert.equal(decodeEntities('&unknown;'), '&unknown;');
  assert.equal(stripTags('<b>ciao</b> <i>mondo</i>'), 'ciao mondo');
});

test('encoding detection prefers headers, then BOM, then meta', () => {
  const latin = Buffer.from([0x63, 0x61, 0x66, 0xe9]);
  assert.equal(detectCharset(latin, 'text/html; charset=windows-1252'), 'windows-1252');
  assert.equal(decodeHtml(latin, 'text/html; charset=windows-1252'), 'caf\u00e9');

  const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('ciao')]);
  assert.equal(detectCharset(bom), 'utf-8');
  assert.equal(decodeHtml(bom), 'ciao');

  const meta = Buffer.from('<meta charset="iso-8859-1"><p>caf\xe9</p>', 'latin1');
  assert.equal(detectCharset(meta), 'windows-1252');
});

test('robots.txt picks the most specific group and longest rule', () => {
  const robots = RobotsTxt.parse(`
User-agent: *
Disallow: /private
Allow: /private/public
Crawl-delay: 5
Sitemap: https://example.com/sitemap.xml

User-agent: LomeSearchBot
Disallow: /no-bot
Allow: /
`);

  assert.equal(robots.isAllowed('/private', 'OtherBot'), false);
  assert.equal(robots.isAllowed('/private/public/page', 'OtherBot'), true);
  assert.equal(robots.isAllowed('/anything', 'OtherBot'), true);
  assert.equal(robots.isAllowed('/no-bot', 'LomeSearchBot/1.0'), false);
  assert.equal(robots.isAllowed('/private', 'LomeSearchBot/1.0'), true);
  assert.equal(robots.crawlDelay('OtherBot'), 5);
  assert.deepEqual(robots.sitemaps, ['https://example.com/sitemap.xml']);
});

test('robots.txt supports wildcards and end anchors', () => {
  const robots = RobotsTxt.parse('User-agent: *\nDisallow: /*.pdf$\nDisallow: /tmp*/x\n');
  assert.equal(robots.isAllowed('/doc.pdf', 'bot'), false);
  assert.equal(robots.isAllowed('/doc.pdf?x=1', 'bot'), true);
  assert.equal(robots.isAllowed('/tmp1/x', 'bot'), false);
  assert.equal(robots.isAllowed('/tmp1/y', 'bot'), true);
});

test('simhash is stable and separates different texts', () => {
  const a = simhash(['browser', 'privacy', 'search', 'index']);
  const b = simhash(['browser', 'privacy', 'search', 'index']);
  const c = simhash(['completely', 'different', 'words', 'entirely']);
  assert.equal(hammingDistance(a, b), 0);
  assert.ok(hammingDistance(a, c) > 3);
});

test('sitemap parsing handles urlset, index and CDATA', () => {
  const urlset = parseSitemapXml(`<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/a</loc><lastmod>2024-01-02</lastmod></url>
  <url><loc><![CDATA[https://example.com/b?x=1&y=2]]></loc></url>
</urlset>`);
  assert.equal(urlset.kind, 'urlset');
  assert.equal(urlset.urls.length, 2);
  assert.equal(urlset.urls[0]!.lastmod, '2024-01-02');
  assert.equal(urlset.urls[1]!.loc, 'https://example.com/b?x=1&y=2');

  const index = parseSitemapXml(`<sitemapindex><sitemap><loc>https://example.com/s1.xml</loc></sitemap></sitemapindex>`);
  assert.equal(index.kind, 'sitemapindex');
  assert.deepEqual(index.sitemaps, ['https://example.com/s1.xml']);
});

test('frontier serialises a host and honours priority', () => {
  const frontier = new Frontier({ perHostDelayMs: 0, maxConcurrentPerHost: 1 });
  assert.equal(frontier.add({ url: 'https://a.example/1', priority: 2, depth: 0, discoveredAt: 1 }), true);
  assert.equal(frontier.add({ url: 'https://a.example/1', priority: 2, depth: 0, discoveredAt: 1 }), false);
  frontier.add({ url: 'https://a.example/2', priority: 0, depth: 0, discoveredAt: 2 });
  frontier.add({ url: 'https://b.example/1', priority: 2, depth: 0, discoveredAt: 3 });

  const first = frontier.take();
  assert.equal(first?.url, 'https://a.example/2');
  const blocked = frontier.take();
  assert.equal(blocked?.url, 'https://b.example/1');
  frontier.complete('https://a.example/2');
  frontier.complete('https://b.example/1');
  const next = frontier.take();
  assert.equal(next?.url, 'https://a.example/1');
});
