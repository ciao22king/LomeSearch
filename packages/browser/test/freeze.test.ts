import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shouldFreeze, type FreezeCandidate } from '../src/shared/freeze.js';

const NOW = 1_700_000_000_000;
const base: FreezeCandidate = {
  id: 2,
  frozen: false,
  live: true,
  loading: false,
  audible: false,
  lastActive: NOW - 21 * 60_000,
};

test('an idle background tab is frozen after the threshold', () => {
  assert.equal(shouldFreeze(base, 1, 20, NOW), true);
  assert.equal(shouldFreeze(base, 1, 30, NOW), false);
});

test('the active tab is never frozen', () => {
  assert.equal(shouldFreeze(base, 2, 20, NOW), false);
});

test('audio, loading, dead and already frozen tabs are skipped', () => {
  assert.equal(shouldFreeze({ ...base, audible: true }, 1, 20, NOW), false);
  assert.equal(shouldFreeze({ ...base, loading: true }, 1, 20, NOW), false);
  assert.equal(shouldFreeze({ ...base, live: false }, 1, 20, NOW), false);
  assert.equal(shouldFreeze({ ...base, frozen: true }, 1, 20, NOW), false);
});

test('zero or negative minutes disables freezing', () => {
  assert.equal(shouldFreeze(base, 1, 0, NOW), false);
  assert.equal(shouldFreeze(base, 1, -5, NOW), false);
  assert.equal(shouldFreeze(base, 1, Number.NaN, NOW), false);
});
