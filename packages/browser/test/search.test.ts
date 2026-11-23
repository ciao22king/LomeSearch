import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildSearchUrl,
  displayUrl,
  engineName,
  isInternalUrl,
  looksLikeUrl,
  normalizeUserUrl,
  resolveInput,
  searchSuggestions,
} from '../src/main/search.js';
import { defaultSettings } from '../src/shared/constants.js';
import type { EngineStatus } from '../src/shared/types.js';

const status: EngineStatus = {
  running: true,
  port: 7717,
  origin: 'http://127.0.0.1:7717',
  documents: 6,
  indexedTerms: 148,
  error: null,
  version: '1.0.0',
};

const settings = defaultSettings({ dataDir: '/tmp/lome-engine', downloadDir: '/tmp/lome-downloads' });

test('looksLikeUrl accepts hosts, addresses and the lome: shorthand', () => {
  assert.equal(looksLikeUrl('example.com'), true);
  assert.equal(looksLikeUrl('https://example.com/a'), true);
  assert.equal(looksLikeUrl('127.0.0.1:8899/trackers.html'), true);
  assert.equal(looksLikeUrl('localhost:3000'), true);
  assert.equal(looksLikeUrl('lome:settings'), true);
  assert.equal(looksLikeUrl('lomesearch://history'), true);
});

test('looksLikeUrl rejects queries and unknown schemes', () => {
  assert.equal(looksLikeUrl('due gatti'), false);
  assert.equal(looksLikeUrl(''), false);
  assert.equal(looksLikeUrl('javascript:alert(1)'), false);
  assert.equal(looksLikeUrl('magnet:?xt=urn'), false);
});

test('normalizeUserUrl applies the right default scheme', () => {
  assert.equal(normalizeUserUrl('example.com'), 'https://example.com/');
  assert.equal(normalizeUserUrl('example.com/path?q=1'), 'https://example.com/path?q=1');
  assert.equal(normalizeUserUrl('127.0.0.1:8899/x'), 'http://127.0.0.1:8899/x');
  assert.equal(normalizeUserUrl('lome:privacy'), 'lomesearch://privacy');
  assert.equal(normalizeUserUrl('lome:/settings/'), 'lomesearch://settings');
  assert.equal(normalizeUserUrl('lome:'), 'lomesearch://newtab');
  assert.equal(normalizeUserUrl('due parole'), null);
});

test('resolveInput separates searches, addresses and internal pages', () => {
  assert.deepEqual(resolveInput('lome:history', settings, status), {
    kind: 'internal',
    url: 'lomesearch://history',
  });
  assert.deepEqual(resolveInput('', settings, status), {
    kind: 'internal',
    url: 'lomesearch://newtab',
  });
  assert.deepEqual(resolveInput('example.com', settings, status), {
    kind: 'url',
    url: 'https://example.com/',
  });
  const search = resolveInput('due gatti', settings, status);
  assert.equal(search.kind, 'search');
  assert.equal(search.url, 'http://127.0.0.1:7717/search?q=due%20gatti');
});

test('buildSearchUrl honours the configured engine', () => {
  assert.equal(buildSearchUrl(settings, status, 'a b'), 'http://127.0.0.1:7717/search?q=a%20b');
  const custom = { ...settings, searchEngine: 'custom' as const, customSearchUrl: 'https://example.org/find?q=%s' };
  assert.equal(buildSearchUrl(custom, status, 'a b'), 'https://example.org/find?q=a%20b');
  const withoutPlaceholder = { ...custom, customSearchUrl: 'https://example.org/find' };
  assert.equal(buildSearchUrl(withoutPlaceholder, status, 'x'), 'https://example.org/find?q=x');
});

test('searchSuggestions puts addresses before the search entry', () => {
  const urlFirst = searchSuggestions('example.com', settings, status);
  assert.equal(urlFirst[0]?.type, 'url');
  assert.equal(urlFirst[0]?.url, 'https://example.com/');
  assert.equal(urlFirst[1]?.type, 'search');

  const searchFirst = searchSuggestions('gatti', settings, status);
  assert.equal(searchFirst.length, 1);
  assert.equal(searchFirst[0]?.type, 'search');
  assert.equal(searchFirst[0]?.url, 'http://127.0.0.1:7717/search?q=gatti');
  assert.deepEqual(searchSuggestions('   ', settings, status), []);
});

test('displayUrl keeps the port and shortens internal pages', () => {
  assert.equal(displayUrl('https://www.example.com:8443/a?b=1'), 'example.com:8443/a?b=1');
  assert.equal(displayUrl('http://127.0.0.1:7717/search?q=x'), '127.0.0.1:7717/search?q=x');
  assert.equal(displayUrl('lomesearch://settings/'), 'lome:settings');
  assert.equal(displayUrl(''), '');
});

test('isInternalUrl and engineName cover every engine', () => {
  assert.equal(isInternalUrl('lomesearch://newtab'), true);
  assert.equal(isInternalUrl('https://example.com'), false);
  assert.equal(engineName(settings), 'LomeSearch locale');
  assert.equal(engineName({ ...settings, searchEngine: 'duckduckgo' }), 'DuckDuckGo');
  assert.equal(engineName({ ...settings, searchEngine: 'custom' }), 'motore personalizzato');
});
