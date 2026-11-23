# @lomesearch/browser

The LomeSearch desktop browser: Electron shell, tab management, omnibox,
internal pages, downloads, permissions, tracker blocking and unpacked Chrome
extension support.

```bash
npm run build     # esbuild bundles for main, preloads and renderer
npm start         # build and launch Electron
npm test          # pure main-process logic, node --test
```

The browser starts the local engine on `127.0.0.1:7717` and uses it as the
default search provider. Data lives in the platform config directory; see
[../../docs/browser.md](../../docs/browser.md) for the window model, internal
pages, IPC surface and settings, and [../../docs/privacy.md](../../docs/privacy.md)
for the privacy model.

Apache-2.0.
