# @lomesearch/engine

Crawler, inverted index, BM25 query engine, suggester and HTTP query server for
[LomeSearch](https://github.com/ciao22king/LomeSearch). No runtime dependencies
outside Node.js.

```bash
npm run build
node dist/src/cli.js serve --port 7717
node dist/src/cli.js crawl https://example.com --max-pages 50
node dist/src/cli.js search "privacy locale" --json
```

The server exposes `/search`, `/suggest`, `/stats`, `/health`,
`/opensearch.xml` and `/indexnow`. See [../../docs/engine.md](../../docs/engine.md)
for the index format, query syntax, crawler defaults and the IndexNow protocol.

```bash
npm test        # node --test, 47 tests
npm run bench
```

Apache-2.0.
