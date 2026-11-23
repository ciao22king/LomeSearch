import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DOCUMENTATION_PREFIXES,
  applyFakeIpHeaders,
  isValidFakeAddress,
  pickFakeAddress,
} from '../src/shared/fake-ip.js';

test('documentation prefixes are the RFC 5737 ranges', () => {
  assert.deepEqual([...DOCUMENTATION_PREFIXES], ['192.0.2', '198.51.100', '203.0.113']);
});

test('addresses are validated as IPv4 or IPv6', () => {
  assert.equal(isValidFakeAddress('203.0.113.7'), true);
  assert.equal(isValidFakeAddress(' 192.0.2.1 '), true);
  assert.equal(isValidFakeAddress('2001:db8::1'), true);
  assert.equal(isValidFakeAddress('203.0.113.999'), false);
  assert.equal(isValidFakeAddress('example.com'), false);
  assert.equal(isValidFakeAddress(''), false);
});

test('a custom address wins, otherwise the pick stays in a reserved range', () => {
  assert.equal(pickFakeAddress('198.51.100.20'), '198.51.100.20');
  assert.equal(pickFakeAddress('not-an-ip', () => 0), '192.0.2.1');
  assert.equal(pickFakeAddress('', () => 0.99), '203.0.113.252');
  for (const value of [0, 0.2, 0.5, 0.8, 0.999]) {
    const address = pickFakeAddress('', () => value);
    assert.match(address, /^(192\.0\.2|198\.51\.100|203\.0\.113)\.\d{1,3}$/);
    assert.equal(isValidFakeAddress(address), true);
  }
});

test('decoy headers replace every forwarding header', () => {
  const headers: Record<string, string | string[]> = { Accept: 'text/html' };
  applyFakeIpHeaders(headers, '203.0.113.9');
  assert.equal(headers['X-Forwarded-For'], '203.0.113.9');
  assert.equal(headers['X-Real-IP'], '203.0.113.9');
  assert.equal(headers['Client-IP'], '203.0.113.9');
  assert.equal(headers['X-Client-IP'], '203.0.113.9');
  assert.equal(headers['Forwarded'], 'for=203.0.113.9');
  assert.equal(headers['Accept'], 'text/html');
});

test('IPv6 decoys are quoted in the Forwarded header', () => {
  const headers: Record<string, string | string[]> = {};
  applyFakeIpHeaders(headers, '2001:db8::1');
  assert.equal(headers['Forwarded'], 'for="[2001:db8::1]"');
});
