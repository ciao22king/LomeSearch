# Browser

`@lomesearch/browser` is an Electron application: a Chromium renderer plus the
browser UI, state, privacy and extension layers around it.

## Window model

Each window is a `BaseWindow` with two kinds of child views:

- **chrome view** — a sandboxed `WebContentsView` loading `chrome.html`. It draws
  the tab strip, toolbar, omnibox and panels. It is transparent where the page
  shows through, and navigation is blocked.
- **tab views** — one sandboxed `WebContentsView` per tab, placed below the chrome
  area. Bounds are recomputed on resize, panel open/close, and full screen.

Panels are overlays inside the chrome view. When one opens, the page view shrinks
so page content is never hidden behind the panel.

The chrome view has its own preload (`chrome.ts`) with a narrow, typed API; page
views get a different preload (`page.ts`) that exposes nothing but the bridge
needed for internal pages. Both run with `sandbox: true`,
`contextIsolation: true` and `nodeIntegration: false`.

## Tabs

`Tab` wraps a `WebContentsView` and tracks title, URL, favicon, loading state,
audio, crash state, preview and freeze state. `TabManager` owns the ordered list,
the active tab, and a 25-entry closed-tab stack for `Ctrl+Shift+T`.

The tab strip is a vertical sidebar on the left: the chrome view fills the whole
window, the page view is inset by `SIDEBAR_WIDTH` (268 px) and `TOOLBAR_HEIGHT`
(48 px), and the chrome view is raised above the page only while a panel is
open. Each sidebar item shows a JPEG preview captured with
`webContents.capturePage()` when the tab finishes loading and when it is left.

Freezing is a real discard, not a throttle: `Tab.freeze()` reads the scroll
offset, closes the `WebContentsView` and keeps the URL. The next selection calls
`thaw()`, creates a fresh view and reloads the page at the saved offset. The
policy lives in `shared/freeze.ts` (`shouldFreeze`) and skips the active tab,
audible tabs, tabs that are loading and tabs that are already frozen. The delay
is `performance.freezeAfterMinutes` (default 20, `0` disables it), the timer runs
every 30 seconds, and `Freeze idle` in the sidebar footer forces it once.
Session restore creates background tabs lazily, so restoring twenty tabs does not
start twenty renderers.

Tabs are created with a session: the default session for normal windows, an
in-memory session for private windows. The session also decides which extension
set is loaded and whether downloads and history are recorded.

## Internal pages

Internal pages live under the `lomesearch://` scheme:

| URL | Page |
| --- | --- |
| `lomesearch://newtab` | New tab: search box, shortcuts, engine status |
| `lomesearch://history` | History with search and deletion |
| `lomesearch://bookmarks` | Bookmarks |
| `lomesearch://downloads` | Download list |
| `lomesearch://extensions` | Extension manager |
| `lomesearch://privacy` | Privacy report: blocked requests by domain |
| `lomesearch://settings` | Settings |
| `lomesearch://legal` | Licence, acceptable use, fake-IP limits |
| `lomesearch://about` | Version and engine information |
| `lomesearch://error` | Error page for failed loads |

The scheme is registered as privileged (`standard`, `secure`, `supportFetchAPI`)
and handled per session. The handler serves only `/pages/*` and `/assets/*` from
the bundled renderer directory, rejects path traversal, sends `no-store`, and
each page carries its own CSP meta tag.

`lome:` is accepted as shorthand in the omnibox (`lome:settings`).

## State flow

`AppStore` holds settings, history, bookmarks, downloads, permissions, site
exceptions, privacy counters and the saved window session. Mutations are
persisted atomically and debounced, then a snapshot is pushed to the chrome view
on `chrome:state`. The UI renders from the snapshot; it keeps no authoritative
state of its own.

Commands go the other way through the preload bridge: `tabs:*`, `nav:*`,
`bookmark:*`, `find:*`, `ui:*`, `settings:*`, `downloads:*`, `extensions:*`,
`privacy:*`.

## Omnibox

Input resolution, in order:

1. `lomesearch://…` and `lome:…` → internal page.
2. Anything that looks like a host, IPv4 address, `localhost:port` or an
   `http(s)` URL → navigate, adding `https://` when the scheme is missing.
3. Otherwise → search with the configured engine.

Suggestions combine the local engine (`GET /suggest`), history matches (prefix
matches ranked first) and a direct URL entry. When the local engine is not
running, the suggestion falls back to the configured remote engine and says so.

## Privacy layers

`PrivacyManager` installs `webRequest` handlers on the session:

- **Tracker and ad blocking** — 213 built-in rules (117 tracker hosts, 82 ad
  network hosts, 15 path patterns) applied to third-party requests; first-party
  requests are only blocked by path pattern. Trackers and ads have separate
  switches. Per-site exceptions (`exceptions.json`) disable both for a domain.
- **Cosmetic filtering** — a short CSS list injected at document start hides
  common ad containers. Generic selectors such as `.ad` are excluded on purpose.
- **Decoy IP headers** — when enabled, `X-Forwarded-For`, `X-Real-IP`,
  `Client-IP` and `Forwarded` carry a reserved RFC 5737 address. This does not
  hide the real source address; see `docs/legal.md`.
- **Cookie hygiene** — third-party cookies and storage are stripped; `DNT: 1` and
  `Sec-GPC: 1` are always sent; client hints are removed when fingerprint
  protection is on.
- **HTTPS-first** — top-level `http://` navigations are upgraded to `https://`
  once per host; if TLS fails, the host is remembered and plain HTTP is allowed.
- **Referer** — `reduceReferrer` cuts cross-site referrers to their origin,
  drops HTTPS to HTTP downgrades and can remove the header entirely.
- **Counters** — blocked requests are counted per tab and aggregated per
  registrable domain in `privacy.json`. No per-URL log is kept.

Outside `webRequest`, the main process applies startup switches for WebRTC
(`force-webrtc-ip-handling-policy`), DoH, background networking and the
spellchecker, and the tab preload patches `RTCPeerConnection` so no ICE candidate
can carry a local or public address. `TZ=UTC` is set before Chromium starts when
timezone spoofing is on. The privacy page shows the live state of each layer.

See [privacy.md](privacy.md) for the threat model.

## Extensions

Extensions are loaded unpacked from directories the user adds in
`lomesearch://extensions`. Electron implements a large subset of the Chrome
extension APIs: content scripts, background pages, `webRequest`, `storage`,
`tabs`, `cookies`, `scripting` and most UI surfaces.

- Loading is per session. Private windows never load extensions.
- Manifest V2 and V3 are both accepted as far as Electron supports them.
- Extensions can be disabled without removing them; the choice is persisted.
- Load errors are shown in the extension page and the log.

Not supported: Chrome Web Store install flow, native messaging hosts, enterprise
policy and APIs that depend on Chrome-specific services.

## Downloads

`DownloadManager` listens to `will-download`, keeps a persistent list in
`downloads.json` (capped), and exposes pause, resume, cancel, open and show.
`settings.downloads.askWhereToSave` switches between the default directory and a
save dialog. The default directory is the platform downloads folder, or
`~/Downloads` when the platform reports the home directory instead.

## Permissions

Permission requests are intercepted per origin. A remembered decision
(`permissions.json`) is applied without a prompt. A new request opens a native
dialog that names the permission and the origin, and offers to remember the
answer. Dismissing the dialog denies the request. Media and display capture
requests go through the same flow.

## Menus and shortcuts

The application menu is built at startup. It covers file, edit, view,
navigation, bookmarks, history, downloads, tools and help. Accelerators live in the menu, so they work whether the chrome view or the
page has focus. `F5` and `F6` are handled per tab in `before-input-event`
because Chromium does not bind them.

Right-click menus are built per context: page (link, image, selection, editable
field), tab strip and omnibox.

## Settings

`settings.json` is merged with defaults on start and validated per field. The
schema is defined in `src/shared/types.ts` and the defaults in
`src/shared/constants.ts`. Unknown fields are preserved, so downgrades do not
lose data.

Key groups: search engine and homepage, startup behaviour, theme, privacy
switches, engine host/port/data directory/executable, download behaviour,
history retention, extension list, session restore.

The engine data directory defaults to the platform data directory
(`~/.local/share/lomesearch` on Linux), the same path the CLI uses, so indexes
built from the terminal appear in the browser without configuration.

## Build

`build.mjs` runs esbuild for:

| Entry | Output |
| --- | --- |
| `src/main/main.ts` | `dist/main/main.js` (Node, external electron) |
| `src/preload/chrome.ts` | `dist/preload/chrome.js` (CJS, sandboxed) |
| `src/preload/page.ts` | `dist/preload/page.js` |
| `src/renderer/chrome.ts` | `dist/renderer/chrome.js` (browser bundle) |
| `src/renderer/pages/*.ts` | `dist/renderer/pages/*.js` |

HTML and CSS are copied as-is. `npm run build` in the package runs the bundler;
`npm start` builds and launches Electron.

## Tests

`npm test` compiles the pure main-process modules (`store`, `search`, `privacy`)
to `dist-test/` with `tsc` and runs them with `node --test`. The tests cover
settings merging, history ordering and retention, bookmarks, downloads,
permissions, privacy counters, URL resolution, search URL construction,
suggestion ranking, internal URL display, the blocklist matcher, referrer
reduction, the startup switch list and the injected page guards.
