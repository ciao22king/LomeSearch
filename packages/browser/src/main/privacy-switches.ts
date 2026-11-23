import { DEFAULT_PRIVACY } from '../shared/constants.js';
import type { PrivacySettings, WebRtcPolicy } from '../shared/types.js';

/**
 * Chromium switches that close leak paths the browser cannot fix with
 * webRequest alone: WebRTC, DNS, background phone-home and the spellchecker.
 *
 * Switches are read once at startup, so changing these settings needs a
 * restart. The timezone is returned separately because it uses the environment.
 */

export interface CommandLineSwitch {
  name: string;
  value?: string;
}

/**
 * Features that talk to Google or download data in the background:
 * autofill uploads, the certificate transparency updater, the optimization
 * hints model, media router discovery, translate and segmentation.
 */
const DISABLED_FEATURES = [
  'AutofillServerCommunication',
  'CertificateTransparencyComponentUpdater',
  'InterestFeedContentSuggestions',
  'MediaRouter',
  'NetworkTimeServiceQuerying',
  'OptimizationHints',
  'SegmentationPlatform',
  'Translate',
];

/** Explicitly on: DoH is conditional, storage partitioning is the safety net. */
const BASE_FEATURES = ['ThirdPartyStoragePartitioning'];

export const DOH_TEMPLATE = 'https://cloudflare-dns.com/dns-query{?dns}';

export function webrtcSwitchValue(policy: WebRtcPolicy): string {
  switch (policy) {
    case 'default':
      return 'default';
    case 'public-interface':
      return 'default_public_interface_only';
    default:
      return 'disable_non_proxied_udp';
  }
}

export function privacySwitches(settings: PrivacySettings | null | undefined): CommandLineSwitch[] {
  const privacy = { ...DEFAULT_PRIVACY, ...(settings ?? {}) };
  const enabled = [...BASE_FEATURES];
  const switches: CommandLineSwitch[] = [
    { name: 'disable-background-networking' },
    { name: 'disable-component-update' },
    { name: 'disable-domain-reliability' },
    { name: 'disable-breakpad' },
    { name: 'no-pings' },
    { name: 'no-first-run' },
    { name: 'no-default-browser-check' },
    { name: 'force-webrtc-ip-handling-policy', value: webrtcSwitchValue(privacy.webrtcPolicy) },
  ];
  if (privacy.dnsOverHttps) {
    enabled.push('DnsOverHttps');
    switches.push({ name: 'dns-over-https-templates', value: DOH_TEMPLATE });
  }
  switches.push({ name: 'enable-features', value: enabled.join(',') });
  switches.push({ name: 'disable-features', value: DISABLED_FEATURES.join(',') });
  return switches;
}

/** Chromium reads TZ before the first Date is created, so set it early. */
export function timezoneValue(settings: PrivacySettings | null | undefined): 'UTC' | undefined {
  const privacy = { ...DEFAULT_PRIVACY, ...(settings ?? {}) };
  return privacy.spoofTimezone ? 'UTC' : undefined;
}
