# Privacy

LomeSearch is built around a simple rule: the default path for a query is a
local index, and every network request the browser makes on your behalf should
be visible and explainable.

This document describes what is protected, what is not, and where data lives.

## Threat model

**Protected against**

- Search queries being sent to an advertising-funded provider by default.
- Third-party tracking requests from pages you visit.
- Cross-site cookies and storage.
- Silent permission grants (camera, microphone, location, notifications).
- Cleartext HTTP for top-level navigation.
- WebRTC IP leaks: ICE candidates cannot carry a local or public address.
- Referer paths and query strings leaking to other origins.
- Timezone as an identifier: the browser runs in UTC.
- Background traffic: component updates, autofill uploads, crash reports,
  translation, optimization hints and the spellchecker dictionary download are
  all disabled.
- Telemetry, accounts, sync and remote logging: none exist in the codebase.
- Blocked-request profiling: counters are aggregated per domain, not per URL.

**Not protected against**

- Your IP address: sites and DNS resolvers still see it.
- DNS metadata: DoH moves it from your ISP to the DoH provider (see below).
- A malicious page exploiting the renderer: Chromium's sandbox is the boundary,
  not something LomeSearch adds.
- Local disk access: settings, history and bookmarks are plain JSON, not
  encrypted. Anyone who can read your home directory can read them.
- Fingerprinting in general: canvas, WebGL, audio, hardware counts, screen depth
  and device enumeration are noised, but installed fonts, `Intl` locale and
  timing are still observable.
- Network-level leaks below the browser: a VPN or proxy that does not cover IPv6
  can still expose an IPv6 address for ordinary HTTP(S) traffic. WebRTC is
  covered by LomeSearch; the rest is the operating system's job.
- Extensions: an installed extension can read and modify pages, as in Chrome.
- Remote search engines: if you pick one, your query goes there.

## Layers

### 1. Tracker blocking

Applied in `webRequest.onBeforeRequest` before a connection is opened.

- 214 curated rules: 117 tracker hosts, 82 ad-network hosts and 15 path
  patterns, including advertising, analytics, session replay, social widgets and
  fingerprinting endpoints. Ads and trackers can be switched independently.
- Host rules match the host and its subdomains.
- Path patterns apply to first-party requests too (for example, a first-party
  analytics beacon).
- Third-party requests are blocked by host rule; first-party requests only by
  path rule.
- Per-site exceptions (`exceptions.json`) disable blocking for one registrable
  domain when a site breaks.
- `privacy.remoteBlocklist` accepts a hosts-file style list or plain domains and
  is refreshed when the setting changes.

Blocked requests never leave the machine.

### 2. Cookie and storage hygiene

- Third-party cookies and storage are stripped from requests and responses.
- `DNT: 1` and `Sec-GPC: 1` are always advertised.
- Client hints (`sec-ch-ua*`, `sec-ch-device-memory`, `device-memory`,
  `sec-ch-ua-model`, `sec-ch-ua-platform-version`) are removed when fingerprint
  protection is on.
- Clearing site data is available per site and globally.

### 3. HTTPS-first

Top-level `http://` navigations are upgraded to `https://` before the request is
sent. If TLS fails for that host, the host is remembered for the session and
plain HTTP is allowed on retry. Subresources are not upgraded, so a page that
mixes content still shows the mixed-content state.

### 4. Permissions

Nothing is granted silently. A new permission request opens a native dialog that
names the origin and the permission, with an option to remember the answer.
Decisions are stored per origin in `permissions.json`. The synchronous check
handler consults the same decisions, so Chromium's second check cannot grant more
than the prompt did.

### 5. Private windows

Private windows use an in-memory session with its own storage partition:

- no history entries;
- no download records (the file itself is still written where you chose);
- no extensions loaded;
- cookies and storage are discarded when the last private window closes;
- the window is not saved in the session restore file.

### 6. WebRTC

Two layers, because the Chromium switch alone is not enough on Electron 33,
where a STUN request still produced a `srflx` candidate with the public IP:

- `--force-webrtc-ip-handling-policy=disable_non_proxied_udp` is passed at
  startup for builds that honour it.
- `RTCPeerConnection` is patched in every page before any script runs. With the
  default `disable` policy, `iceServers` is emptied and `iceTransportPolicy` is
  set to `relay`, so no candidate leaves the machine. With `public-interface`,
  STUN is removed and only mDNS host candidates remain (they contain a `.local`
  name, never an IP address). `default` restores Chromium behaviour.

Verified with a probe page that gathered ICE candidates: `disable` produced zero
candidates, `public-interface` produced one mDNS host candidate and no `srflx`.

### 7. Referer

Every request passes through `onBeforeSendHeaders`, which rewrites the header:

- `strict` (default): same-origin keeps the full URL, everything else is cut to
  the origin, and HTTPS to HTTP drops the header.
- `origin`: always the origin only.
- `none`: header removed.

This is enforced even when a page sets a looser `Referrer-Policy`.

### 8. Timezone

With `privacy.spoofTimezone` on (default), `TZ=UTC` is set before Chromium
starts, so `Intl.DateTimeFormat`, `Date` and the rendered clock all agree on UTC
instead of exposing the local zone. The setting needs a restart.

### 9. Background traffic and spellchecker

At startup the browser passes `--disable-background-networking`,
`--disable-component-update`, `--disable-domain-reliability`, `--disable-breakpad`,
`--no-pings`, `--no-first-run`, `--no-default-browser-check` and disables the
features `AutofillServerCommunication`, `CertificateTransparencyComponentUpdater`,
`InterestFeedContentSuggestions`, `MediaRouter`, `NetworkTimeServiceQuerying`,
`OptimizationHints`, `SegmentationPlatform` and `Translate`.

Electron downloads Hunspell dictionaries from a Google CDN the first time the
spellchecker runs, so `privacy.spellchecker` defaults to `false`. Turn it on if
you want it; the download is then the only request it makes.

### 10. Storage partitioning

Chromium 130 partitions HTTP cache, localStorage, IndexedDB and service workers
by top-level site; LomeSearch enables `ThirdPartyStoragePartitioning` explicitly.
On top of that, third-party cookies and `Set-Cookie` headers are stripped, so a
tracker cannot use a shared cookie jar to recognise a visit.

### 11. DNS over HTTPS

When `privacy.dnsOverHttps` is on (default), Chromium resolves names through
`https://cloudflare-dns.com/dns-query`. This hides DNS queries from your ISP and
local network, and shows them to Cloudflare instead. If you prefer your system
resolver, turn the setting off; the browser then uses the OS configuration.

This is the one default network dependency in the browser. It is listed in the
privacy page and can be disabled.

## What is stored

| File | Contents | Retention |
| --- | --- | --- |
| `settings.json` | Preferences | Until changed |
| `history.json` | URL, title, visit count, last visit | 90 days by default; can be disabled |
| `bookmarks.json` | URL, title, creation date | Until deleted |
| `downloads.json` | Filename, URL, size, save path | Last 200; normal windows only |
| `permissions.json` | Origin → allow/deny per permission | Until reset |
| `exceptions.json` | Domain → tracker blocking on/off | Until reset |
| `privacy.json` | Total blocked count and per-domain counts | Until reset |
| `session.json` | Open tabs per normal window | Overwritten on quit |

Nothing else is written by the browser. The engine writes only to its own data
directory.

## Clearing data

- `lomesearch://settings` → clear browsing data: history, cookies, cache, site
  storage, downloads list, individually.
- `privacy.clearOnExit` clears cookies, cache and localStorage on quit. It does
  not delete history or downloads; those have their own controls.
- Private windows clear themselves.

## Network calls the browser can make

| Destination | When | Payload |
| --- | --- | --- |
| Local engine (`127.0.0.1:7717`) | Every search, suggestion, stats refresh | Query text |
| Configured remote engine | Only if you choose one | Query text |
| Engine's external provider (Brave API or a SearXNG instance) | Only when the results page carries `web=1` and the engine was started with `--web-provider` | Query text |
| Search engine behind the hand-off link (Bing by default) | Only when you click the link | Query text, in the URL |
| The site you visit | Always | Normal browsing traffic |
| Cloudflare DoH | DNS resolution, if enabled | Hostnames |
| Google CDN | Only if the spellchecker is enabled | Dictionary request |
| Remote blocklist URL | Only if configured | Nothing; the list is downloaded |
| IndexNow participants | Only when you run `indexnow submit` | URLs you submit |

There is no other outbound traffic. The browser does not contact update servers,
crash reporters or analytics endpoints, and the switch list above is applied
before Chromium starts, so background services never get a chance to run.

The local engine binds `127.0.0.1`, accepts only loopback `Host` headers (so DNS
rebinding fails with `421`), sends no CORS headers (so a page cannot read the
index) and logs only method, route, status and duration: the query string is
never written to disk or to the log.

## Leak checklist

| # | Vector | Status |
| --- | --- | --- |
| 1 | WebRTC IP leak | Closed. Switch plus page guard; zero candidates in `disable`. |
| 2 | DNS leak | Closed while DoH is on; DNS goes to Cloudflare, not the ISP. Turning DoH off uses the system resolver. |
| 3 | IPv6 leak | WebRTC is covered. Ordinary IPv6 traffic still follows the routing table; use a VPN that carries IPv6. |
| 4 | Engine telemetry | Closed. Background networking, component updates, crash reports, autofill upload, translate, optimization hints and the spellchecker download are disabled. |
| 5 | Canvas, WebGL, audio | Noised per site and per session, including `toDataURL`/`toBlob`, `getImageData`, `readPixels`-adjacent parameters, WebGL vendor/renderer and `AudioBuffer` reads. |
| 6 | Fonts and hardware | `hardwareConcurrency`, `deviceMemory`, plugins, screen depth and media devices are spoofed. Installed fonts remain observable. |
| 7 | Cache and storage leaks | Third-party cookies stripped; storage partitioning enabled; private windows use a memory-only session. |
| 8 | Referer leak | Closed. Origin-only cross-site by default, downgrades dropped, policy configurable. |
| 9 | Timezone, locale | Timezone is UTC. `navigator.languages` and `Intl` locale are left real to keep pages usable. |
| 10 | Query metadata | Queries stay on loopback, are never logged, and the engine refuses foreign `Host` headers and cross-origin reads. |
| 11 | Query hand-off to a third party | Explicit. The results page names the service, the link is inert until clicked, and inline external results are opt-in per engine (they come with a line saying which host received the query). |

## Reporting a problem

Security issues should be reported privately to the maintainers rather than in a
public issue. Include the version from `lomesearch://about`, the platform, and a
minimal reproduction.
