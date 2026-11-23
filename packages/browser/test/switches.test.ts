import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_PRIVACY } from '../src/shared/constants.js';
import { privacySwitches, timezoneValue, webrtcSwitchValue } from '../src/main/privacy-switches.js';

function switchValue(list: Array<{ name: string; value?: string }>, name: string): string | undefined {
  return list.find((item) => item.name === name)?.value;
}

test('privacySwitches blocks WebRTC by default and disables background traffic', () => {
  const switches = privacySwitches(DEFAULT_PRIVACY);
  assert.equal(switchValue(switches, 'force-webrtc-ip-handling-policy'), 'disable_non_proxied_udp');
  for (const name of ['disable-background-networking', 'disable-component-update', 'disable-domain-reliability', 'disable-breakpad', 'no-pings']) {
    assert.ok(switches.some((item) => item.name === name), `${name} missing`);
  }
  const disabled = switchValue(switches, 'disable-features') ?? '';
  assert.ok(disabled.includes('AutofillServerCommunication'));
  assert.ok(disabled.includes('OptimizationHints'));
  assert.ok(disabled.includes('Translate'));
});

test('privacySwitches keeps a single enable-features list', () => {
  const switches = privacySwitches(DEFAULT_PRIVACY);
  const enabled = switches.filter((item) => item.name === 'enable-features');
  assert.equal(enabled.length, 1);
  assert.ok(enabled[0]?.value?.includes('DnsOverHttps'));
  assert.ok(enabled[0]?.value?.includes('ThirdPartyStoragePartitioning'));
  assert.equal(switchValue(switches, 'dns-over-https-templates'), 'https://cloudflare-dns.com/dns-query{?dns}');
});

test('privacySwitches drops DoH when the user disabled it', () => {
  const switches = privacySwitches({ ...DEFAULT_PRIVACY, dnsOverHttps: false });
  const enabled = switchValue(switches, 'enable-features') ?? '';
  assert.equal(enabled.includes('DnsOverHttps'), false);
  assert.equal(switchValue(switches, 'dns-over-https-templates'), undefined);
});

test('webrtcSwitchValue maps the three policies', () => {
  assert.equal(webrtcSwitchValue('disable'), 'disable_non_proxied_udp');
  assert.equal(webrtcSwitchValue('public-interface'), 'default_public_interface_only');
  assert.equal(webrtcSwitchValue('default'), 'default');
});

test('timezoneValue is UTC unless the user turns spoofing off', () => {
  assert.equal(timezoneValue(DEFAULT_PRIVACY), 'UTC');
  assert.equal(timezoneValue({ ...DEFAULT_PRIVACY, spoofTimezone: false }), undefined);
  assert.equal(timezoneValue(null), 'UTC');
});
