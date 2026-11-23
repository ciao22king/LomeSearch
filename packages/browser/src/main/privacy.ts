import type { Session } from 'electron';
import type { ClearDataOptions, PrivacySummary, ReferrerPolicySetting } from '../shared/types.js';
import type { AppStore } from './store.js';

/**
 * Privacy enforcement for a session.
 *
 * Three independent layers:
 *  - a curated tracker blocklist (host based, third-party only for path rules);
 *  - cookie hygiene: third-party cookies and storage are stripped, DNT/GPC are
 *    always advertised, client hints are removed;
 *  - HTTPS-first with a per-tab fallback to plain HTTP when TLS is unavailable.
 *
 * Everything is enforced with Electron's webRequest API, so it also covers
 * subframes, workers and requests made by extensions. Blocked requests are
 * counted per tab and in aggregate.
 */

const TRACKER_HOSTS = new Set<string>([
  // Advertising
  'doubleclick.net',
  'googleadservices.com',
  'googlesyndication.com',
  'google-analytics.com',
  'googletagmanager.com',
  'googletagservices.com',
  'adservice.google.com',
  'adnxs.com',
  'adsrvr.org',
  'advertising.com',
  'amazon-adsystem.com',
  'criteo.com',
  'criteo.net',
  'taboola.com',
  'outbrain.com',
  'pubmatic.com',
  'rubiconproject.com',
  'openx.net',
  'casalemedia.com',
  'sharethrough.com',
  'teads.tv',
  'moatads.com',
  'smartadserver.com',
  'yieldmo.com',
  '3lift.com',
  'indexww.com',
  'sovrn.com',
  'gumgum.com',
  'contextweb.com',
  'districtm.io',
  'bidswitch.net',
  'lijit.com',
  'turn.com',
  'adform.net',
  'adsafeprotected.com',
  'doubleverify.com',
  'quantserve.com',
  'quantcount.com',
  'scorecardresearch.com',
  'chartbeat.com',
  'parsely.com',
  'newrelic.com',
  'nr-data.net',
  'hotjar.com',
  'fullstory.com',
  'mouseflow.com',
  'crazyegg.com',
  'inspectlet.com',
  'luckyorange.com',
  'clarity.ms',
  'mc.yandex.ru',
  'top-fwz1.mail.ru',
  // Analytics and attribution
  'mixpanel.com',
  'segment.io',
  'segment.com',
  'amplitude.com',
  'heapanalytics.com',
  'kissmetrics.com',
  'matomo.cloud',
  'statcounter.com',
  'histats.com',
  'clicky.com',
  'plausible.io',
  'umami.is',
  'branch.io',
  'appsflyer.com',
  'adjust.com',
  'kochava.com',
  'singular.net',
  'onesignal.com',
  // Social widgets
  'facebook.net',
  'connect.facebook.net',
  'facebook.com',
  'platform.twitter.com',
  'syndication.twitter.com',
  'platform.linkedin.com',
  'snap.licdn.com',
  'px.ads.linkedin.com',
  'analytics.tiktok.com',
  'business-api.tiktok.com',
  'ads.pinterest.com',
  'ct.pinterest.com',
  'sc-static.net',
  'tr.snapchat.com',
  'bat.bing.com',
  // Data brokers and fingerprinting
  'rlcdn.com',
  'agkn.com',
  'bluekai.com',
  'exelator.com',
  'krxd.net',
  'demdex.net',
  'omtrdc.net',
  'everesttech.net',
  'adsymptotic.com',
  'crwdcntrl.net',
  'tapad.com',
  'liadm.com',
  'id5-sync.com',
  'sitescout.com',
  'zemanta.com',
  'simpli.fi',
  'eyeota.net',
  'neustar.biz',
  'pippio.com',
  'liveramp.com',
  'tynt.com',
  'addthis.com',
  'sharethis.com',
  'disqus.com',
  // Error reporting and session replay
  'sentry.io',
  'bugsnag.com',
  'rollbar.com',
  'raygun.io',
  'logrocket.com',
  'smartlook.com',
  'userpilot.com',
  'walkme.com',
]);

const BLOCKED_PATH_PATTERNS: RegExp[] = [
  /\/pagead\//i,
  /\/adserver\//i,
  /\/adservice\//i,
  /\/adsense\//i,
  /\/doubleclick\//i,
  /\/analytics\.js$/i,
  /\/gtag\/js/i,
  /\/gtm\.js$/i,
  /\/pixel\.gif$/i,
  /\/pixel\.png$/i,
  /\/collect\?/i,
  /\/telemetry\//i,
  /\/track(ing)?\?/i,
  /\/beacon\?/i,
  /\/fingerprint/i,
];

const PRIVATE_HOSTS = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/;

export function registrableDomain(host: string): string {
  const clean = host.toLowerCase().replace(/\.$/, '');
  if (!clean || PRIVATE_HOSTS.test(clean) || /^\d+\.\d+\.\d+\.\d+$/.test(clean)) return clean;
  const labels = clean.split('.').filter(Boolean);
  if (labels.length <= 2) return clean;
  const lastTwo = labels.slice(-2).join('.');
  return MULTI_LABEL_SUFFIXES.has(lastTwo) ? labels.slice(-3).join('.') : lastTwo;
}

const MULTI_LABEL_SUFFIXES = new Set<string>([
  'co.uk', 'org.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk', 'ac.uk', 'gov.uk', 'sch.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'id.au',
  'co.nz', 'net.nz', 'org.nz', 'govt.nz',
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp',
  'co.kr', 'or.kr', 'ne.kr', 'go.kr',
  'com.br', 'net.br', 'org.br', 'gov.br',
  'com.mx', 'com.ar', 'com.co', 'com.pe', 'com.ve', 'com.uy', 'com.py', 'com.bo',
  'com.ec', 'com.do', 'com.gt', 'com.sv', 'com.hn', 'com.ni', 'com.pa', 'com.cr',
  'co.za', 'org.za', 'net.za', 'gov.za',
  'co.in', 'net.in', 'org.in', 'gen.in', 'firm.in', 'ind.in',
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn',
  'com.tw', 'org.tw', 'net.tw', 'edu.tw',
  'com.hk', 'org.hk', 'net.hk', 'edu.hk',
  'com.sg', 'org.sg', 'net.sg', 'edu.sg',
  'com.my', 'org.my', 'net.my',
  'com.ph', 'org.ph', 'net.ph',
  'co.th', 'in.th', 'or.th', 'ac.th',
  'com.vn', 'org.vn', 'net.vn',
  'co.id', 'or.id', 'web.id', 'ac.id',
  'com.tr', 'org.tr', 'net.tr', 'gov.tr',
  'co.il', 'org.il', 'net.il', 'ac.il', 'gov.il',
  'com.sa', 'com.ae', 'co.ae', 'com.qa', 'com.kw', 'com.bh', 'com.om', 'com.jo', 'com.lb',
  'co.ke', 'or.ke', 'co.ug', 'com.ng', 'com.eg', 'com.gh',
  'com.ru', 'net.ru', 'org.ru',
  'github.io', 'gitlab.io', 'netlify.app', 'vercel.app', 'pages.dev', 'workers.dev',
  'herokuapp.com', 'blogspot.com', 'appspot.com', 'firebaseapp.com', 'web.app',
  'azurewebsites.net', 'cloudfront.net', 'myshopify.com', 'wixsite.com', 'wordpress.com',
  'tumblr.com', 'medium.com', 'substack.com', 'notion.site', 'readthedocs.io',
]);

/**
 * Rewrites the Referer header before a request leaves the browser.
 *
 * `strict` mirrors strict-origin-when-cross-origin but enforces it even when a
 * page asks for something looser: same-origin keeps the path, everything else
 * is cut to the origin, and HTTPS to HTTP drops the header entirely.
 * `origin` cuts every URL to its origin. `none` removes the header.
 */
export function reduceReferrer(
  headers: Record<string, string | string[]>,
  target: URL,
  firstParty: URL | null,
  policy: ReferrerPolicySetting,
): void {
  const key = Object.keys(headers).find((name) => name.toLowerCase() === 'referer');
  if (!key) return;
  const raw = headers[key];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || policy === 'none' || !firstParty) {
    delete headers[key];
    return;
  }
  let referrer: URL;
  try {
    referrer = new URL(value);
  } catch {
    delete headers[key];
    return;
  }
  if (referrer.protocol === 'https:' && target.protocol === 'http:') {
    delete headers[key];
    return;
  }
  const sameOrigin = referrer.protocol === target.protocol && referrer.host === target.host;
  if (sameOrigin && policy === 'strict') {
    headers[key] = value;
    return;
  }
  headers[key] = `${referrer.protocol}//${referrer.host}/`;
}

export interface PrivacyContext {
  /** URL of the top-level document, used to decide what is third-party. */
  tabUrl(webContentsId: number): string | undefined;
  /** Called whenever a request is blocked, with the owning webContents id. */
  onBlocked(webContentsId: number | undefined, domain: string): void;
}

export class PrivacyManager {
  private sessionBlocked = 0;
  private readonly perTab = new Map<number, number>();
  private readonly httpsFallback = new Set<string>();
  private remoteHosts = new Set<string>();

  constructor(private readonly store: AppStore) {}

  get blocklistSize(): number {
    return TRACKER_HOSTS.size + BLOCKED_PATH_PATTERNS.length + this.remoteHosts.size;
  }

  /**
   * Loads the optional remote blocklist. Both hosts-file lines
   * (`0.0.0.0 domain`) and plain domains are accepted; comments are ignored.
   */
  async loadRemoteBlocklist(): Promise<void> {
    const url = this.store.settings.value.privacy.remoteBlocklist.trim();
    if (!url) {
      this.remoteHosts = new Set();
      return;
    }
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(10_000),
        headers: { 'user-agent': 'LomeSearch/1.0 (blocklist)' },
      });
      if (!response.ok) return;
      const text = await response.text();
      const hosts = new Set<string>();
      for (const rawLine of text.split('\n')) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#') || line.startsWith('!')) continue;
        const parts = line.split(/\s+/);
        const candidate = parts.length > 1 ? parts[parts.length - 1] : parts[0];
        if (!candidate) continue;
        const host = candidate.toLowerCase().replace(/^\*?\./, '');
        if (/^[a-z0-9.-]+$/.test(host) && host.includes('.')) hosts.add(host);
        if (hosts.size >= 200_000) break;
      }
      this.remoteHosts = hosts;
    } catch {
      // Keep the previous list when the download fails.
    }
  }

  configure(session: Session, context: PrivacyContext): void {
    session.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
      const settings = this.store.settings.value.privacy;
      const url = safeUrl(details.url);
      if (!url) {
        callback({});
        return;
      }

      if (
        settings.httpsFirst &&
        details.resourceType === 'mainFrame' &&
        url.protocol === 'http:' &&
        !PRIVATE_HOSTS.test(url.hostname) &&
        !this.httpsFallback.has(details.url)
      ) {
        callback({ redirectURL: `https://${url.host}${url.pathname}${url.search}${url.hash}` });
        return;
      }

      const firstParty = this.firstPartyFor(details, context);
      const exception = firstParty ? this.store.exceptionFor(registrableDomain(firstParty.hostname)) : null;
      const enabled = settings.blockTrackers && exception?.blockTrackers !== false;
      if (enabled && this.isTracker(url, firstParty)) {
        this.recordBlocked(details.webContentsId, url.hostname, context);
        callback({ cancel: true });
        return;
      }
      callback({});
    });

    session.webRequest.onBeforeSendHeaders({ urls: ['*://*/*'] }, (details, callback) => {
      const settings = this.store.settings.value.privacy;
      const headers = { ...details.requestHeaders };
      if (settings.sendDoNotTrack) {
        headers['DNT'] = '1';
        headers['Sec-GPC'] = '1';
      }
      if (settings.fingerprintProtection) {
        for (const name of Object.keys(headers)) {
          if (/^sec-ch-ua/i.test(name) || name.toLowerCase() === 'x-client-data') delete headers[name];
        }
      }
      const url = safeUrl(details.url);
      const firstParty = this.firstPartyFor(details, context);
      if (url) {
        reduceReferrer(headers, url, firstParty, settings.referrerPolicy ?? 'strict');
      }
      if (settings.blockThirdPartyCookies) {
        if (url && firstParty && registrableDomain(url.hostname) !== registrableDomain(firstParty.hostname)) {
          for (const name of Object.keys(headers)) {
            if (name.toLowerCase() === 'cookie') delete headers[name];
          }
        }
      }
      callback({ requestHeaders: headers });
    });

    session.webRequest.onHeadersReceived({ urls: ['*://*/*'] }, (details, callback) => {
      const settings = this.store.settings.value.privacy;
      if (!settings.blockThirdPartyCookies) {
        callback({});
        return;
      }
      const url = safeUrl(details.url);
      const firstParty = this.firstPartyFor(details, context);
      if (!url || !firstParty) {
        callback({});
        return;
      }
      if (registrableDomain(url.hostname) === registrableDomain(firstParty.hostname)) {
        callback({});
        return;
      }
      const responseHeaders = { ...details.responseHeaders };
      for (const name of Object.keys(responseHeaders)) {
        if (name.toLowerCase() === 'set-cookie') delete responseHeaders[name];
      }
      callback({ responseHeaders });
    });
  }

  /** Registers a failed HTTPS upgrade so the next attempt uses plain HTTP. */
  allowHttpFallback(url: string): void {
    if (url.startsWith('https://')) {
      this.httpsFallback.add(url.replace(/^https:\/\//, 'http://'));
    }
  }

  tabBlocked(webContentsId: number): number {
    return this.perTab.get(webContentsId) ?? 0;
  }

  resetTab(webContentsId: number): void {
    this.perTab.delete(webContentsId);
  }

  summary(): PrivacySummary {
    const totals = this.store.privacyTotals();
    return {
      blockedSession: this.sessionBlocked,
      blockedTotal: totals.total,
      blocklistSize: this.blocklistSize,
      topDomains: totals.domains.slice(0, 12),
    };
  }

  async clearData(session: Session, options: ClearDataOptions): Promise<void> {
    if (options.cookies) await session.clearStorageData({ storages: ['cookies'] });
    if (options.localStorage) {
      await session.clearStorageData({
        storages: ['localstorage', 'indexdb', 'websql', 'shadercache', 'serviceworkers', 'cachestorage'],
      });
    }
    if (options.cache) await session.clearCache();
    if (options.history) this.store.clearHistory();
    if (options.downloads) this.store.clearDownloads();
    if (options.cookies || options.localStorage) this.store.resetPrivacyCounters();
  }

  private recordBlocked(
    webContentsId: number | undefined,
    domain: string,
    context: PrivacyContext,
  ): void {
    this.sessionBlocked++;
    if (webContentsId !== undefined && webContentsId >= 0) {
      this.perTab.set(webContentsId, (this.perTab.get(webContentsId) ?? 0) + 1);
      context.onBlocked(webContentsId, domain);
    } else {
      context.onBlocked(undefined, domain);
    }
    this.store.recordBlocked(registrableDomain(domain) || domain);
  }

  private firstPartyFor(
    details: { webContentsId?: number; frame?: { url?: string } | null },
    context: PrivacyContext,
  ): URL | null {
    const frame = details.frame;
    if (frame?.url) {
      const parsed = safeUrl(frame.url);
      if (parsed && parsed.protocol !== 'devtools:') return parsed;
    }
    const tabUrl = details.webContentsId !== undefined ? context.tabUrl(details.webContentsId) : undefined;
    return tabUrl ? safeUrl(tabUrl) : null;
  }

  private isRemoteTracker(host: string): boolean {
    if (this.remoteHosts.size === 0) return false;
    if (this.remoteHosts.has(host)) return true;
    const labels = host.split('.');
    for (let i = 1; i < labels.length - 1; i++) {
      if (this.remoteHosts.has(labels.slice(i).join('.'))) return true;
    }
    return false;
  }

  private isTracker(url: URL, firstParty: URL | null): boolean {
    const host = url.hostname.toLowerCase();
    if (firstParty && registrableDomain(host) === registrableDomain(firstParty.hostname)) {
      return false;
    }
    if (isTrackerHost(host) || this.isRemoteTracker(host)) return true;
    if (!firstParty) return false;
    const path = `${url.pathname}${url.search}`;
    return BLOCKED_PATH_PATTERNS.some((pattern) => pattern.test(path));
  }
}

export function isTrackerHost(host: string): boolean {
  if (TRACKER_HOSTS.has(host)) return true;
  const labels = host.split('.');
  for (let i = 1; i < labels.length - 1; i++) {
    if (TRACKER_HOSTS.has(labels.slice(i).join('.'))) return true;
  }
  return false;
}

function safeUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url;
  } catch {
    return null;
  }
}
