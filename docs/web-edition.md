# The web edition

`site/web/` is the browser and the engine running inside a page, published with
the rest of the site on GitHub Pages. It exists so the project can be tried
without installing anything, and so the ranking code is visible in a place
nobody has to trust.

```
https://ciao22king.github.io/LomeSearch/web/
```

## What runs where

| Layer | File | Notes |
| --- | --- | --- |
| Engine | `site/web/engine.js` | esbuild bundle of `packages/engine/src/web/entry.ts`, 22 KiB, no `node:` imports |
| Corpus | `site/web/data/corpus.json` | 137 Wikipedia extracts, 204 KiB, committed |
| Shell | `site/web/index.html`, `app.css` | window chrome, tabs, toolbar, internal pages |
| UI | `site/web/app.js` | tab model, address bar, results, settings, history |

The bundle is a build product. `scripts/build-web.mjs` produces it and the Pages
workflow runs that step before uploading the artifact, so `engine.js` never sits
in git.

```bash
npm run web          # rebuild site/web/engine.js
npm run web:corpus   # re-generate the corpus (needs network, ~1 minute)
```

## The index in memory

`packages/engine/src/memory/index.ts` is a second implementation of the same
contract the disk-backed index uses (`SearchContext` from
`query/executor.ts`). There is no second ranking engine:

- analysis is `core/analysis.ts`, shared with `index/index.ts`;
- scoring is `query/scoring.ts` (BM25F plus the quality multiplier);
- query parsing is `query/parser.ts`, execution is `query/executor.ts`;
- snippets come from `query/snippet.ts`, completions from `query/suggest.ts`.

The only difference is storage. Postings live in `Map`s, are converted to the
typed-array shape the executor expects on first access, and are cached for the
lifetime of the page. Building the index for the bundled corpus takes 15–150 ms
depending on the machine, which is why the boot screen is a real step and not an
animation.

`FIELD` and `FieldLengths` moved to `core/fields.ts` during this work, so the
query path can be imported without dragging `index/segment.ts` and its `node:fs`
dependency into a browser bundle.

## The corpus

`scripts/demo-corpus.mjs` fetches a fixed list of articles from the Wikipedia
API, keeps the first 2800 characters of each, uses the first sentence as the
description, and stores the canonical URL. Wikipedia is CC BY-SA 4.0, so every
result links back to its article; the About page says so and the generator
refuses to invent text.

The corpus is committed because the demo has to be reproducible: the workflow
does not touch the network, and a rebuild of the site does not silently change
what the demo searches.

## The window

`app.js` models tabs as entries: `newtab`, `search`, `page`, `external`. Each tab
keeps its own history, so the back and forward buttons are real. The address bar
accepts a query, `lome:history`, `lome:settings`, `lome:privacy`, `lome:about`,
or an address.

External addresses get an honest screen instead of a fake render: a web page
cannot display another site, and claiming otherwise is how "online browsers"
usually lie. The screen explains it and offers two ways out, open the real tab or
search the host in the local index.

Searches are mirrored into the URL hash (`#q=privacy`), so a result page can be
linked, reloaded and shared.

## Privacy of the page itself

The page carries a strict policy in a `<meta>` tag:

```
default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:;
font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'
```

Consequences worth knowing:

- inline `<style>` and `style=""` attributes are blocked, so the UI styles
  everything through classes (`document.style` is still allowed, but the demo
  does not use it);
- there are no fonts, no CDN, no analytics, no third-party images;
- `lome:privacy` measures this at runtime with `performance.getEntriesByType`
  and lists exactly which files the page loaded.

State is four keys in `localStorage` — theme, page size, hand-off engine and the
query history — and the settings page can delete all of them. The history stores
queries only, never URLs or titles.

## What the web edition does not do

No crawling, no IndexNow, no request blocking, no extensions, no separate
processes, no private windows. Those need the desktop app; the site says where
the line is instead of implying the page is the product.
