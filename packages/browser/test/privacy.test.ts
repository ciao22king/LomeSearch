import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isTrackerHost, reduceReferrer, registrableDomain } from '../src/main/privacy.js';

test('registrableDomain reduces hosts to the registrable label', () => {
  assert.equal(registrableDomain('www.example.com'), 'example.com');
  assert.equal(registrableDomain('a.b.example.com'), 'example.com');
  assert.equal(registrableDomain('example.com'), 'example.com');
  assert.equal(registrableDomain('example.com.'), 'example.com');
  assert.equal(registrableDomain('www.example.co.uk'), 'example.co.uk');
  assert.equal(registrableDomain('shop.example.github.io'), 'example.github.io');
});

test('registrableDomain leaves IP addresses and local hosts alone', () => {
  assert.equal(registrableDomain('127.0.0.1'), '127.0.0.1');
  assert.equal(registrableDomain('localhost'), 'localhost');
  assert.equal(registrableDomain('192.168.1.10'), '192.168.1.10');
  assert.equal(registrableDomain(''), '');
});

test('isTrackerHost matches known hosts and their subdomains', () => {
  assert.equal(isTrackerHost('google-analytics.com'), true);
  assert.equal(isTrackerHost('www.google-analytics.com'), true);
  assert.equal(isTrackerHost('region1.google-analytics.com'), true);
  assert.equal(isTrackerHost('connect.facebook.net'), true);
  assert.equal(isTrackerHost('securepubads.g.doubleclick.net'), true);
  assert.equal(isTrackerHost('static.hotjar.com'), true);
});

test('isTrackerHost does not match ordinary sites', () => {
  assert.equal(isTrackerHost('example.com'), false);
  assert.equal(isTrackerHost('cdn.example.com'), false);
  assert.equal(isTrackerHost('notgoogle-analytics.com'), false);
});

test('reduceReferrer keeps the path only for same-origin requests', () => {
  const headers: Record<string, string | string[]> = { Referer: 'https://a.example/secret?token=1' };
  reduceReferrer(headers, new URL('https://b.example/page'), new URL('https://a.example/start'), 'strict');
  assert.equal(headers.Referer, 'https://a.example/');

  const same: Record<string, string | string[]> = { Referer: 'https://a.example/secret?token=1' };
  reduceReferrer(same, new URL('https://a.example/other'), new URL('https://a.example/start'), 'strict');
  assert.equal(same.Referer, 'https://a.example/secret?token=1');
});

test('reduceReferrer drops HTTPS to HTTP downgrades', () => {
  const headers: Record<string, string | string[]> = { Referer: 'https://a.example/secret' };
  reduceReferrer(headers, new URL('http://a.example/x'), new URL('https://a.example/'), 'strict');
  assert.equal('Referer' in headers, false);
});

test('reduceReferrer honours origin and none policies', () => {
  const origin: Record<string, string | string[]> = { Referer: 'https://a.example/deep/path?q=1' };
  reduceReferrer(origin, new URL('https://a.example/other'), new URL('https://a.example/'), 'origin');
  assert.equal(origin.Referer, 'https://a.example/');

  const none: Record<string, string | string[]> = { Referer: 'https://a.example/deep/path' };
  reduceReferrer(none, new URL('https://a.example/other'), new URL('https://a.example/'), 'none');
  assert.equal('Referer' in none, false);
});

test('reduceReferrer removes unknown or malformed referrers', () => {
  const noContext: Record<string, string | string[]> = { Referer: 'https://a.example/x' };
  reduceReferrer(noContext, new URL('https://b.example/'), null, 'strict');
  assert.equal('Referer' in noContext, false);

  const malformed: Record<string, string | string[]> = { Referer: 'not a url' };
  reduceReferrer(malformed, new URL('https://b.example/'), new URL('https://a.example/'), 'strict');
  assert.equal('Referer' in malformed, false);
});

test('reduceReferrer finds the header case-insensitively and ignores absent headers', () => {
  const lower: Record<string, string | string[]> = { referer: 'https://a.example/secret' };
  reduceReferrer(lower, new URL('https://b.example/'), new URL('https://a.example/'), 'strict');
  assert.equal(lower.referer, 'https://a.example/');

  const empty: Record<string, string | string[]> = {};
  reduceReferrer(empty, new URL('https://b.example/'), new URL('https://a.example/'), 'strict');
  assert.deepEqual(empty, {});
});
