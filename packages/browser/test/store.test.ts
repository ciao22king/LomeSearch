import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { AppStore } from '../src/main/store.js';
import type { DownloadState } from '../src/shared/types.js';

function makeStore(): { store: AppStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'lomesearch-store-'));
  return { store: new AppStore(dir, join(dir, 'downloads')), dir };
}

test('settings are created with privacy-safe defaults', () => {
  const { store } = makeStore();
  const settings = store.settings.value;
  assert.equal(settings.searchEngine, 'local');
  assert.equal(settings.privacy.blockTrackers, true);
  assert.equal(settings.privacy.blockThirdPartyCookies, true);
  assert.equal(settings.privacy.httpsFirst, true);
  assert.equal(settings.privacy.sendDoNotTrack, true);
  assert.equal(settings.engine.port, 7717);
});

test('updateSettings merges nested sections without dropping defaults', () => {
  const { store } = makeStore();
  const next = store.updateSettings({ privacy: { ...store.settings.value.privacy, blockTrackers: false } });
  assert.equal(next.privacy.blockTrackers, false);
  assert.equal(next.privacy.httpsFirst, true);
  assert.equal(next.searchEngine, 'local');
  assert.equal(store.settings.value.privacy.blockTrackers, false);
});

test('recordVisit keeps one row per URL and counts visits', () => {
  const { store } = makeStore();
  store.recordVisit('https://example.com/a', 'Prima');
  store.recordVisit('https://example.com/b', 'Seconda');
  store.recordVisit('https://example.com/a', 'Prima aggiornata');
  const history = store.listHistory();
  assert.equal(history.length, 2);
  assert.equal(history[0]?.url, 'https://example.com/a');
  assert.equal(history[0]?.visitCount, 2);
  assert.equal(history[0]?.title, 'Prima aggiornata');
});

test('recordVisit ignores internal pages and disabled history', () => {
  const { store } = makeStore();
  store.recordVisit('lomesearch://newtab', 'Nuova scheda');
  store.recordVisit('file:///tmp/x.html', 'File');
  assert.equal(store.listHistory().length, 0);
  store.updateSettings({ history: { ...store.settings.value.history, enabled: false } });
  store.recordVisit('https://example.com', 'Example');
  assert.equal(store.listHistory().length, 0);
});

test('searchHistory prefers prefix matches', () => {
  const { store } = makeStore();
  store.recordVisit('https://example.com/privacy', 'Informativa privacy');
  store.recordVisit('https://example.org/privacy-policy', 'Privacy policy');
  store.recordVisit('https://wiki.example.net/', 'Privacy');
  const results = store.searchHistory('privacy');
  assert.equal(results[0]?.title, 'Privacy');
  assert.equal(store.searchHistory('').length, 0);
});

test('updateHistoryTitle rewrites the stored title', () => {
  const { store } = makeStore();
  store.recordVisit('https://example.com/x', 'Caricamento');
  store.updateHistoryTitle('https://example.com/x', 'Titolo vero');
  assert.equal(store.listHistory()[0]?.title, 'Titolo vero');
});

test('removeHistory and clearHistory work by id', () => {
  const { store } = makeStore();
  store.recordVisit('https://a.example/', 'A');
  store.recordVisit('https://b.example/', 'B');
  const first = store.listHistory()[0];
  assert.ok(first);
  store.removeHistory(first.id);
  assert.equal(store.listHistory().length, 1);
  store.clearHistory();
  assert.equal(store.listHistory().length, 0);
});

test('bookmarks are unique per URL', () => {
  const { store } = makeStore();
  const bookmark = store.addBookmark('https://example.com', 'Example');
  assert.equal(store.isBookmarked('https://example.com'), true);
  store.addBookmark('https://example.com', 'Example');
  assert.equal(store.listBookmarks().length, 1);
  assert.equal(store.removeBookmark('https://example.com'), true);
  assert.equal(store.removeBookmark('https://example.com'), false);
  assert.equal(store.listBookmarks().length, 0);
  assert.equal(bookmark.url, 'https://example.com');
});

test('downloads are sorted newest first and can be cleared', () => {
  const { store } = makeStore();
  const item = (id: string, startedAt: number): DownloadState => ({
    id,
    filename: `${id}.bin`,
    url: `https://example.com/${id}.bin`,
    state: 'completed',
    received: 10,
    total: 10,
    savePath: `/tmp/${id}.bin`,
    startedAt,
  });
  store.saveDownloads([item('old', 1), item('new', 2)]);
  assert.deepEqual(store.listDownloads().map((entry) => entry.id), ['new', 'old']);
  store.clearDownloads();
  assert.equal(store.listDownloads().length, 0);
});

test('site exceptions override tracker blocking per domain', () => {
  const { store } = makeStore();
  store.setException('example.com', false);
  assert.equal(store.exceptionFor('example.com')?.blockTrackers, false);
  store.setException('example.com', true);
  assert.equal(store.listExceptions().length, 1);
  store.removeException('example.com');
  assert.equal(store.exceptionFor('example.com'), null);
});

test('permissions store the last decision per origin', () => {
  const { store } = makeStore();
  assert.equal(store.permissionFor('https://example.com', 'notifications'), null);
  store.setPermission('https://example.com', 'notifications', 'deny');
  assert.equal(store.permissionFor('https://example.com', 'notifications'), 'deny');
  store.setPermission('https://example.com', 'notifications', 'allow');
  assert.equal(store.permissionFor('https://example.com', 'notifications'), 'allow');
});

test('privacy counters aggregate by domain and reset', () => {
  const { store } = makeStore();
  store.recordBlocked('doubleclick.net');
  store.recordBlocked('doubleclick.net');
  store.recordBlocked('facebook.net');
  const totals = store.privacyTotals();
  assert.equal(totals.total, 3);
  assert.equal(totals.domains[0]?.domain, 'doubleclick.net');
  assert.equal(totals.domains[0]?.count, 2);
  store.resetPrivacyCounters();
  assert.equal(store.privacyTotals().total, 0);
});

test('history retention prunes old entries on startup', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lomesearch-retention-'));
  const day = 86_400_000;
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ history: { retentionDays: 7 } }));
  writeFileSync(
    join(dir, 'history.json'),
    JSON.stringify([
      { id: 'old', url: 'https://old.example/', title: 'Vecchia', visitedAt: Date.now() - 30 * day, visitCount: 1 },
      { id: 'new', url: 'https://new.example/', title: 'Nuova', visitedAt: Date.now() - day, visitCount: 1 },
    ]),
  );
  const store = new AppStore(dir, join(dir, 'downloads'));
  assert.deepEqual(store.listHistory().map((entry) => entry.id), ['new']);
});

test('flushAll persists the current state', () => {
  const { store, dir } = makeStore();
  store.addBookmark('https://example.com', 'Example');
  store.flushAll();
  const saved = JSON.parse(readFileSync(join(dir, 'bookmarks.json'), 'utf8')) as Array<{ url: string }>;
  assert.equal(saved[0]?.url, 'https://example.com');
});
