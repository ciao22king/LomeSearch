# LomeSearch for Android

A self-contained browser: the search engine and its pages ship inside the APK, so
there is no server to point at, no port to open and nothing to install on a
desktop. A bare word in the address bar searches the bundled index; anything that
looks like a host is a normal navigation.

## Why the pages are assets

The engine is TypeScript, so it cannot run as a background service on Android. The
web edition of LomeSearch (`site/web`) already runs the whole index inside a page:
it builds an in-memory inverted index from a corpus and answers queries without a
network call. The APK carries that same bundle as assets, so the browser and the
engine are one program:

- search runs on the device, in the same process as the page;
- no HTTP server, no port, no engine address to configure;
- the index is rebuilt from the bundled corpus at launch (about 120 ms for 137
  documents) and never leaves the app.

## Install

Download `LomeSearch-<version>-android.apk` from the release page, allow installs
from the file manager or the browser you use to download it, and open the file.
Android 7.0 (API 24) or newer is required; the build targets API 36.

## What the browser does for privacy

- cookies are off by default and third-party cookies are always blocked;
- mixed content never loads, geolocation is off, form data is not saved;
- only the bundled pages may use `file://`; the web cannot read other local files;
- *Privacy* and *Clear data* in the menu open the privacy page and wipe cookies,
  cache, history and the settings the internal pages store, in one step;
- nothing is uploaded anywhere: the only traffic is the websites you open.

## Address bar

| Input | Result |
| --- | --- |
| `privacy policy` | `lome://search?q=privacy%20policy` on the bundled index |
| `example.com` | `https://example.com` |
| `lome://settings` | the settings page, drawn from assets |
| `lome://privacy`, `lome://history` | the other internal pages |

Fragment navigation is used for the internal pages, so the index stays loaded
between searches instead of being rebuilt on every query.

## Build

The build needs no Gradle. `build.sh` bundles the pages with esbuild, then drives
`aapt2`, `javac`, `d8`, `zipalign` and `apksigner` from an installed Android SDK:

```bash
node scripts/build-web.mjs          # produces site/web/engine.js
ANDROID_HOME=/path/to/android-sdk bash packages/android/build.sh
# -> dist/LomeSearch-<version>-android.apk
```

`ANDROID_HOME` must contain `build-tools/36.0.0` and `platforms/android-36`.
The script copies `site/web` into `assets/` (git-ignored), inlines the corpus as
`corpus.js` — `fetch` of a relative file is refused on `file://` origins — and
bundles `app.js` into one classic script, because Chromium will not load module
scripts from a null origin.

Signing: set `LOMESEARCH_KEYSTORE`, `LOMESEARCH_KEYSTORE_PASSWORD` and optionally
`LOMESEARCH_KEY_ALIAS` to sign with a stable key. Without them the script creates
`.keystore/lomesearch.jks` on first use, so consecutive local builds keep the same
signature. Keep that file if you want to ship updates that install over the
previous version; it is git-ignored and lives outside `build/`, which the script
wipes on every run.

`bash packages/android/test.sh` runs the JVM-only part of the client (address
classification, query encoding, internal URLs) on the host.

## Layout

```
AndroidManifest.xml            package, permissions and the http/https view intent
res/                           theme, layout, launcher icons, network config
src/org/lomesearch/android/
  MainActivity.java            WebView shell, toolbar, menu, privacy defaults
  Engine.java                  address detection, lome:// routes, query URLs
test/                          host-side test for Engine
build.sh                       asset bundling + aapt2 + javac + d8 + apksigner
assets/                        generated from site/web on every build
```
