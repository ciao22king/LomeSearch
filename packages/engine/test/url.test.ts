import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalizeUrl,
  displayUrl,
  looksLikeUrl,
  normalizeUserUrl,
  sameOrigin,
  siteOf,
} from '../src/core/url.js';
import { getPublicSuffix, getRegistrableDomain, sameSite } from '../src/core/psl.js';

test('canonicalizeUrl strips fragments and tracking parameters', () => {
  assert.equal(
    canonicalizeUrl('HTTPS://Example.COM:443/a//b/../c/?utm_source=x&b=2&a=1#frag'),
    'https://example.com/a/c?a=1&b=2',
  );
  assert.equal(canonicalizeUrl('http://example.com/'), 'http://example.com/');
  assert.equal(canonicalizeUrl('https://example.com/path?gclid=1&fbclid=2'), 'https://example.com/path');
});

test('canonicalizeUrl keeps meaningful parameters and sorts them', () => {
  assert.equal(
    canonicalizeUrl('https://example.com/s?q=hello+world&lang=it'),
    'https://example.com/s?lang=it&q=hello+world',
  );
  assert.equal(canonicalizeUrl('https://example.com/s?q=1&q=2'), 'https://example.com/s?q=1&q=2');
});

test('canonicalizeUrl rejects non-http schemes and relative input without base', () => {
  assert.equal(canonicalizeUrl('javascript:alert(1)'), null);
  assert.equal(canonicalizeUrl('mailto:someone@example.com'), null);
  assert.equal(canonicalizeUrl('/relative'), null);
  assert.equal(canonicalizeUrl('/relative', 'https://example.com/dir/page'), 'https://example.com/relative');
});

test('canonicalizeUrl removes credentials and trailing dot', () => {
  assert.equal(
    canonicalizeUrl('https://user:pass@example.com./x'),
    'https://example.com/x',
  );
});

test('looksLikeUrl distinguishes URLs from searches', () => {
  assert.equal(looksLikeUrl('https://example.com'), true);
  assert.equal(looksLikeUrl('example.com'), true);
  assert.equal(looksLikeUrl('example.com/path?q=1'), true);
  assert.equal(looksLikeUrl('localhost:3000'), true);
  assert.equal(looksLikeUrl('192.168.1.1'), true);
  assert.equal(looksLikeUrl('how to write a browser'), false);
  assert.equal(looksLikeUrl('c++'), false);
  assert.equal(looksLikeUrl('example'), false);
});

test('normalizeUserUrl adds a scheme when it is obvious', () => {
  assert.equal(normalizeUserUrl('example.com'), 'https://example.com/');
  assert.equal(normalizeUserUrl('localhost:8080'), 'http://localhost:8080/');
  assert.equal(normalizeUserUrl('https://example.com/x'), 'https://example.com/x');
  assert.equal(normalizeUserUrl('not a url'), null);
});

test('displayUrl keeps the host visible', () => {
  assert.equal(displayUrl('https://example.com/'), 'example.com');
  const long = `https://example.com/${'x'.repeat(200)}`;
  assert.ok(displayUrl(long, 60).length <= 60);
});

test('sameOrigin compares scheme, host and port', () => {
  assert.equal(sameOrigin('https://a.example.com/x', 'https://a.example.com/y'), true);
  assert.equal(sameOrigin('https://a.example.com', 'http://a.example.com'), false);
  assert.equal(sameOrigin('https://a.example.com:8443', 'https://a.example.com'), false);
});

test('public suffix list handles multi-label and private suffixes', () => {
  assert.equal(getPublicSuffix('www.example.co.uk'), 'co.uk');
  assert.equal(getRegistrableDomain('www.example.co.uk'), 'example.co.uk');
  assert.equal(getRegistrableDomain('a.b.github.io'), 'b.github.io');
  assert.equal(getRegistrableDomain('example.com'), 'example.com');
  assert.equal(getRegistrableDomain('com'), null);
  assert.equal(getRegistrableDomain('127.0.0.1'), null);
});

test('sameSite compares registrable domains', () => {
  assert.equal(sameSite('www.example.com', 'api.example.com'), true);
  assert.equal(sameSite('example.com', 'example.org'), false);
  assert.equal(siteOf('https://news.example.co.uk/a'), 'example.co.uk');
});
