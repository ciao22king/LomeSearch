import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildNoiseScript } from '../src/shared/fingerprint.js';

const script = buildNoiseScript('seed-1', 'example.com');

test('noise script covers canvas readback in both forms', () => {
  assert.ok(script.includes('getImageData'));
  assert.ok(script.includes('toDataURL'));
  assert.ok(script.includes('toBlob'));
  assert.ok(script.includes('jitterCanvas'));
});

test('noise script spoofs hardware, audio and device enumeration', () => {
  assert.ok(script.includes('hardwareConcurrency'));
  assert.ok(script.includes('deviceMemory'));
  assert.ok(script.includes('AudioBuffer'));
  assert.ok(script.includes('copyFromChannel'));
  assert.ok(script.includes('enumerateDevices'));
  assert.ok(script.includes("'plugins'"));
  assert.ok(script.includes('colorDepth'));
});

test('noise script embeds seed and host safely', () => {
  assert.ok(script.includes('"seed-1"'));
  assert.ok(script.includes('"example.com"'));
  const host = '"><script>';
  const quoted = buildNoiseScript('seed', host);
  assert.ok(quoted.includes(JSON.stringify(host)));
});
