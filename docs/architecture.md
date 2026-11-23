# Architecture

LomeSearch is split into two processes that talk over loopback HTTP: an Electron
application and a Node search server. Inside the application, every window has a
trusted chrome view and one `WebContentsView` per tab, all sandboxed.

## Process model

```
Electron main process
├── AppContext                     wiring, lifecycle, single instance lock
├── AppStore                       all persistent state (JSON, atomic writes)
├── EngineManager                  spawns/attaches the engine, proxies searches
├── PrivacyManager                 webRequest layers per session
├── ExtensionManager               unpacked Chrome extensions
├── DownloadManager                download queue and history
├── PermissionManager              per-origin decisions
├── ContextMenu                    right-click menus
└── BrowserWindowController (×N)
    ├── chrome WebContentsView     sandboxed renderer, preload/chrome.ts
    └── TabManager
        └── Tab (WebContentsView)  sandboxed renderer, preload/page.ts

Engine process (Node, loopback only)
└── HTTP server + index + crawler
```

The main process never renders UI. The renderers never touch Node or the file
system directly; they call a typed bridge exposed by the preload scripts.

## Why HTTP between browser and engine

- The engine can be replaced: `settings.engine.executable` points at any program
  that serves the same API.
- The engine can run headless on another machine.
- The engine is testable with `node --test` and `curl`, with no Electron in the
  loop.
- A crashed or restarted engine cannot take the browser down with it.

The browser launches the bundled engine with the Electron binary in
`ELECTRON_RUN_AS_NODE` mode, so a packaged app needs no separate Node install.
If the configured port already answers `/health`, the browser attaches to that
instance instead of spawning a second one.

## Window composition

`BaseWindow` owns two layers:

1. A `WebContentsView` with `chrome.html`: tabs, toolbar, omnibox, panels. It is
   transparent where the page shows through, and `will-navigate` is always
   prevented, so it can never leave the local UI.
2. A `WebContentsView` per tab, positioned below the chrome area. Its bounds are
   recomputed on resize, panel open/close, and full screen.

Panels (bookmarks, history, downloads, extensions, privacy, menu) are rendered by
the chrome view as overlays. Opening one shrinks the page view, so page content
is never covered.

## Security boundaries

| Boundary | Control |
| --- | --- |
| Renderer → Node | `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, preload allowlists |
| Chrome UI → web | `will-navigate` prevented, CSP `default-src 'none'` |
| Internal pages | Privileged custom scheme, path traversal rejected, per-page CSP, `no-store` |
| Page → main | IPC handlers validate the sender and the payload shape |
| New windows | `setWindowOpenHandler` routes to a tab or denies |
| Permissions | Denied unless the user allowed the origin; decisions persisted per origin |
| Engine | Binds `127.0.0.1` by default, rate limited, body size capped |

Internal pages get a real origin (`lomesearch://settings`), so they can use the
same tab machinery, history and reload behaviour as any other page.

## State flow

`AppStore` is the single source of truth. Main processes mutations, persists them
(debounced, atomic temp-file + rename) and pushes a state snapshot to the chrome
view. The chrome view renders from that snapshot and sends commands back through
the preload bridge.

Tab state (title, URL, favicon, loading, muted, crashed) travels the same way:
`Tab` events → `TabManager` → `BrowserWindowController` → `chrome:state` patch.

This one-way flow keeps the UI stateless: a reload of the chrome view redraws
everything from the last snapshot.

## Data flow of a search

1. The user types in the omnibox; the chrome view asks main for suggestions.
2. Main combines local engine suggestions (`GET /suggest`), history matches and
   URL detection, and returns one ranked list.
3. On submit, main resolves the input: internal page, URL, or search.
4. A search URL points at the local engine (`http://127.0.0.1:7717/search?q=…`)
   and loads in a normal tab, so results are a web page with back/forward,
   bookmarks and view-source for free.
5. The engine parses the query, scores documents with BM25, builds snippets and
   returns HTML (or JSON).

Choosing a remote engine only changes step 4: the query is sent to that engine's
URL, and the UI says so.

## Engine internals

The engine is described in [engine.md](engine.md). The short version: immutable
on-disk segments, a manifest with tombstones, BM25 over five fields, positional
index for phrases, and a crawler that respects robots.txt, sitemaps and per-host
delays.

## Invariants

These are the rules the code relies on. Breaking one is a bug, not a refactor.

- Only `AppStore` writes browser state to disk.
- Only `EngineManager` starts or stops the engine process.
- The chrome view never navigates away from `chrome.html`.
- Every internal URL is served by the protocol handler of the session that
  requested it; private windows never share the default session.
- A blocked request is counted, never logged with its full URL.
- Segment files are immutable; deletions are tombstones in the manifest.
- The engine never trusts a submitted URL: IndexNow URLs must share the submitted
  host and the key must be verifiable.

## Startup and shutdown

Startup: single-instance lock → `AppStore` → sessions, protocol handlers,
privacy layers → window restore → engine start (non-blocking) → chrome view.

Shutdown: `before-quit` flushes the store, saves the window session, stops the
engine child if this process started it, and clears private session data. A
private window's session is destroyed when its last window closes.
