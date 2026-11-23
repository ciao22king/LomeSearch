import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildWebRtcScript } from '../src/shared/page-guards.js';

test('default policy leaves RTCPeerConnection untouched', () => {
  assert.equal(buildWebRtcScript('default'), '');
});

test('disable policy removes ICE servers and forces relay', () => {
  const script = buildWebRtcScript('disable');
  assert.ok(script.includes('iceServers = []'));
  assert.ok(script.includes("iceTransportPolicy = 'relay'"));
  assert.ok(script.includes('RTCPeerConnection'));
});

test('public-interface keeps host candidates but drops STUN servers', () => {
  const script = buildWebRtcScript('public-interface');
  assert.ok(script.includes('iceServers = []'));
  assert.equal(script.includes('iceTransportPolicy'), false);
});
