# Engine

`@lomesearch/engine` is a self-contained search engine: a polite crawler, an
immutable on-disk index, a BM25 query engine, a suggester and an HTTP server.
It has no runtime dependencies outside Node.js.

## Pipeline

```
seeds / IndexNow / JSONL
        │
        ▼
   frontier  ──►  fetcher  ──►  extractor  ──►  analyser  ──►  segments
 (per-host        (HTTP,        (title,        (fold,          (immutable)
  delay,          limits,       headings,       segment,
  robots,         gzip)         body, links)    stem)
  sitemaps)                                                    │
                                                               ▼
                                                    docstore (compressed)
                                                               │
                                                        BM25 query
```

## Text analysis

- Word breaking uses `Intl.Segmenter` with `granularity: 'word'`, so scripts
  without spaces (Chinese, Japanese, Thai) segment correctly.
- Text is NFKC-normalised, lowercased and stripped of diacritics
  (`Crème Brûlée` → `creme brulee`). Apostrophes are treated as word separators.
- Tokens shorter than the minimum or longer than the maximum are dropped from the
  index, but kept in the source text for snippets.
- Latin tokens run through a Porter stemmer. Non-Latin tokens are indexed as-is.
- Each token keeps its source offsets, so snippets are cut from the original
  text, not from a normalised copy.

Fields, in order: `title`, `heading`, `body`, `url`, `meta`. Positions are stored
for the first four, which is what phrase queries and proximity scoring use.

## Segments

A segment is written once and never modified:

```
magic | termCount | docCount | termsLength | postingsLength | lengthsLength
term offsets      termCount + 1 uint32 into the terms blob
postings offsets  termCount + 1 uint32 into the postings section
terms blob        length-prefixed UTF-8, sorted
postings          per term: delta-encoded doc ids + term frequencies + positions
document lengths  per doc: five field lengths, delta-encoded doc ids
```

Both offset tables make a term lookup `O(log n)` plus the cost of decoding its
postings. That is the only random access the query path needs.

A small in-memory table absorbs writes between commits. When enough segments
accumulate (`mergeFactor`, default 6) they are merged into one. Deletions are
tombstones in `manifest.json`: reads skip them, merges drop them, `optimize`
rewrites segments and vacuums the docstore.

Index directory:

| File | Contents |
| --- | --- |
| `manifest.json` | Segment list, tombstones, counters, index version |
| `segments/seg-<id>.seg` | Immutable postings |
| `docs.log` | Append-only compressed document store |
| `docs.idx` | Offset table for the document store |
| `urls.json` | URL → doc id map |
| `surfaces.json` | Stem → surface form, used for suggestions and highlighting |
| `indexnow-key.txt` | Generated IndexNow key, if enabled |

## Scoring

BM25 with field weights:

```ts
k1 = 1.2
b = 0.75
weights = { title: 4.0, heading: 2.0, body: 1.0, url: 1.8, meta: 1.2 }
phraseBoost = 1.6
titleMatchBoost = 1.35
```

The weighted term frequency is the sum of per-field frequencies times their
weights; the length normalisation uses the same weighted lengths. Phrase matches
add `phraseBoost` when the terms appear consecutively at a stored position, and
a full title match adds `titleMatchBoost`.

Query terms are ANDed by default. Results are paginated ten at a time, with
`total` and `totalRelation` (`eq` when the exact count is known, `gte` when the
engine stops counting early).

## Query syntax

| Syntax | Meaning |
| --- | --- |
| `privacy locale` | Both terms must match |
| `"privacy locale"` | Exact phrase on token positions |
| `-tracker` | Exclude documents with the term |
| `site:example.com` | Host or registrable-domain filter (PSL-aware) |
| `title:privacy` | Restrict a term to the title field |
| `url:/docs` | Restrict to the URL field |

A field prefix also works with a quoted value: `site:"example com"`.

## Crawler

Defaults:

| Option | Default |
| --- | --- |
| `maxPages` | 200 |
| `maxDepth` | 3 |
| `sameSite` | true |
| `concurrency` | 4 |
| `perHostDelayMs` | 1000 |
| `maxBytes` per response | 5 MiB |
| `timeoutMs` | 15 s |
| `respectRobots` | true |
| `followNofollow` | false |
| `discoverSitemaps` | true |

- The frontier schedules one request per host at a time and enforces the delay.
- `robots.txt` is fetched once per host and obeyed, including `Crawl-delay`.
- `sitemap.xml` and `robots.txt` sitemap declarations seed the frontier.
- Only HTML is indexed; other content types are recorded but not analysed.
- Links are resolved, canonicalised (fragment removed, tracking parameters
  dropped, PSL-aware host normalisation) and deduplicated before queueing.
- Near-duplicates are detected with SimHash over the first 20 000 tokens
  (Hamming distance threshold), on top of an exact content hash.
- Commits happen every 50 documents, so a crawl that dies still leaves a usable
  index.

`lomesearch crawl` prints a live summary and a final report: requested, indexed,
skipped, errors, and elapsed time.

## HTTP server

The server binds `127.0.0.1` by default. Every response carries
`x-content-type-options`, `x-frame-options: DENY` and `referrer-policy:
no-referrer`; HTML pages also get a strict CSP. There are no CORS headers, so a
web page cannot read the index, and requests whose `Host` header is not loopback,
the bind address or an explicitly allowed name are rejected with `421` to stop
DNS rebinding. The access log records method, route, status and duration only:
never the query string, the headers or the client address.

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/search?q=…&page=N` | HTML by default, JSON with `format=json` or `Accept: application/json` |
| `GET` | `/suggest?q=…` | `[query, [suggestions]]` |
| `GET` | `/stats` | Index and process statistics |
| `GET` | `/health` | `{ status, version, uptimeSeconds }` |
| `GET` | `/opensearch.xml` | OpenSearch description |
| `GET` | `/<key>.txt` | IndexNow key file |
| `POST` | `/indexnow` | IndexNow submissions |

Limits: 2 MiB request bodies, 120 searches per minute per client, 30 IndexNow
submissions per minute per client. Rate-limit keys are HMACs of the client
address with a rotating per-process salt, so they cannot be linked across runs.

## IndexNow

The engine is both a participant and a client.

Server side, `POST /indexnow` accepts the standard payload:

```json
{
  "host": "example.com",
  "key": "0123456789abcdef",
  "keyLocation": "https://example.com/0123456789abcdef.txt",
  "urlList": ["https://example.com/page"]
}
```

Validation:

- `host` must be a valid hostname, `key` must match `[a-zA-Z0-9-]{8,128}`.
- `urlList` must hold 1–10 000 absolute `http(s)` URLs, all on `host`.
- The key file is fetched from the host (or `keyLocation`) and must contain the
  key. Results are cached for 24 hours.
- Accepted URLs are queued at priority 0, ahead of normal crawl links.

Responses: `200` accepted, `202` key file not reachable yet, `403` invalid key or
verification failed, `422` invalid host, `400` invalid payload, `413` body too
large, `429` rate limited.

Client side:

```bash
lomesearch indexnow key --host example.com
lomesearch indexnow submit https://example.com/a https://example.com/b \
  --host example.com --key <key>
lomesearch indexnow verify --host example.com --key <key>
```

`submit` posts to `https://api.indexnow.org/indexnow` by default; `--endpoint`
points it at another participant, including a local engine.

## Command line

```
lomesearch serve   [--port 7717] [--dir …] [--seed url] [--crawl] [--key …]
lomesearch crawl   <url…> [--max-pages n] [--max-depth n] [--delay ms] [--json]
lomesearch index   <file.jsonl> [--dir …]
lomesearch search  <query…> [--json] [--page n]
lomesearch suggest <prefix…>
lomesearch stats   [--json]
lomesearch optimize
lomesearch indexnow key|submit|verify …
lomesearch version | help
```

`index` reads JSON Lines. Required: `url`, `title`, `body`. Optional:
`description`, `headings`, `lang`, `fetchedAt`, `contentHash`, `outlinks`.

## Benchmarks

`npm run bench` builds a synthetic corpus and reports indexing throughput, query
latency and index size. Numbers depend on the machine; the benchmark exists to
catch regressions, not to compete with server-class engines.
