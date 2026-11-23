# LomeSearch for Android

An Android client for a LomeSearch engine. The app is a WebView browser shell with
the same address bar behaviour as the desktop browser: a bare word is a query on
your engine, anything that looks like a host is a navigation.

## Why a client and not the engine

The engine is Node.js with a filesystem index, a crawler and a long-running HTTP
server. None of that maps onto an APK without shipping a JavaScript runtime and a
background service that Android will recycle. Rather than fake it, the APK is a
thin, auditable client:

- the index, the query log and the crawl frontier stay on the machine that runs
  the engine — a desktop, a home server, or the same phone under Termux;
- the APK has no analytics, no crash reporter, no push channel and no account;
- the only network destinations are the engine you configure and the websites you
  open, which is the same traffic a browser produces anyway.

## Install

Download `LomeSearch-<version>-android.apk` from the release page, allow installs
from the file manager or the browser you use to download it, and open the file.
Android 7.0 (API 24) or newer is required; the build targets API 36.

## Point it at an engine

The first time a page fails to load, the app asks for the engine address. From
the menu (`⋮` → *Engine address*) you can set it at any time:

| Where the engine runs | Address |
| --- | --- |
| Same phone, under Termux | `http://127.0.0.1:7717` |
| Desktop on the same Wi-Fi | `http://192.168.1.10:7717` |
| Android emulator with the engine on the host | `http://10.0.2.2:7717` |

Start the engine so that the network can reach it:

```bash
lomesearch serve --bind 0.0.0.0 --port 7717
```

Binding to `0.0.0.0` exposes the engine to the whole local network. The server has
no authentication, so keep that in mind on shared or public networks.

## What the client does for privacy

- cookies are off by default and third-party cookies are always blocked;
- mixed content never loads, file and content access are disabled, geolocation is
  off, form data is not saved;
- *Privacy* in the menu toggles cookies and clears cookies, cache and history in
  one step;
- nothing is uploaded anywhere: the engine address is the only setting stored, in
  private preferences.

## Build

The build needs no Gradle. `build.sh` drives `aapt2`, `javac`, `d8`, `zipalign`
and `apksigner` from an installed Android SDK:

```bash
ANDROID_HOME=/path/to/android-sdk bash packages/android/build.sh
# -> dist/LomeSearch-<version>-android.apk
```

`ANDROID_HOME` must contain `build-tools/36.0.0` (34.0.0 works for everything but
`d8` on JDK 21, which crashes with an internal error) and `platforms/android-36`.

Signing: set `LOMESEARCH_KEYSTORE`, `LOMESEARCH_KEYSTORE_PASSWORD` and optionally
`LOMESEARCH_KEY_ALIAS` to sign with a stable key. Without them the script creates
`build/keystore/lomesearch.jks` on first use, so consecutive local builds keep the
same signature. Keep that file if you want to ship updates that install over the
previous version.

`bash packages/android/test.sh` runs the JVM-only part of the client (address
classification and query encoding) on the host.

## Layout

```
AndroidManifest.xml            package, permissions and the http/https view intent
res/                           theme, layout, launcher icons, network config
src/org/lomesearch/android/
  MainActivity.java            WebView shell, toolbar, menu, privacy defaults
  Engine.java                  origin normalisation, address detection, query URLs
test/                          host-side test for Engine
build.sh                       aapt2 + javac + d8 + apksigner pipeline
```
