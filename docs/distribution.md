# Distribution

LomeSearch is meant to be installed, not cloned. Every artifact below bundles the
engine inside the application, so the person installing it does not need Node.js,
npm or a build toolchain.

| Platform | Artifact | What it does |
| --- | --- | --- |
| Windows | `LomeSearch-<version>-setup.exe` | NSIS installer: Start menu entry, per-user install, uninstaller |
| Windows | `LomeSearch-<version>-portable.exe` | Single file, no install, no registry writes |
| macOS 11+ | `LomeSearch-<version>-mac-arm64.dmg`, `-mac-x64.dmg` | Drag to Applications; unsigned, so the first launch needs right-click → Open |
| Debian/Ubuntu | `LomeSearch-<version>-linux-amd64.deb` | System install under `/opt/LomeSearch`, desktop entry, hicolor icons |
| Any Linux | `LomeSearch-<version>-x86_64.AppImage` | Single executable, no install, works without FUSE 3 via `--appimage-extract-and-run` |
| Android | `LomeSearch-<version>-android.apk` | Client for an engine on the same network; see `packages/android/README.md` |

All artifacts are built from the same commit by the same configuration, and the
version comes from `packages/browser/package.json`.

## Building locally

```bash
npm install
npm run build            # engine (tsc) + browser (esbuild)

npm run dist:linux       # deb + AppImage      -> dist/
npm run dist:win         # setup + portable    -> dist/
npm run dist:mac         # dmg + zip           -> dist/   (macOS host only)
npm run dist:android     # apk                 -> dist/
```

`npm run dist:linux` and `npm run dist:win` call electron-builder with
`--config.npmRebuild=false`: nothing in the tree has native modules, so skipping
the rebuild avoids needing a compiler toolchain on the build host.

### Linux

Targets are `deb` and `AppImage`, architecture x64. The configuration lives in
`packages/browser/electron-builder.yml`; `buildResources` is `packages/browser/assets`,
which holds `icon.ico` and the `icons/` size set used for the desktop entry.

The generated `.desktop` file is worth checking after changing the config, because
electron-builder takes flat keys (`desktop.Name`, `desktop.Exec`) and a nested
object silently produces `entry=[object Object]`:

```bash
dpkg-deb -x dist/LomeSearch-<version>-linux-amd64.deb /tmp/lome
cat /tmp/lome/usr/share/applications/lomesearch.desktop
```

### Windows

Cross-building on Linux needs Wine, and specifically a 32-bit capable Wine,
because electron-builder edits the executable resources with `rcedit-ia32.exe`:

```bash
sudo dpkg --add-architecture i386
sudo apt update && sudo apt install wine wine32
```

On a Windows host or on the CI runner none of this applies. The build produces an
unsigned executable: Windows SmartScreen will warn about an unknown publisher until
the project ships a code-signing certificate. Add the certificate through
`CSC_LINK` and `CSC_KEY_PASSWORD` and electron-builder signs automatically.

### macOS

`dmg` and `zip` targets build on a macOS host, either `macos-14` (arm64) or an
Intel machine; CI runs one job per architecture so each bundle is native. The
configuration sets `mac.identity: null` and `hardenedRuntime: false`, which means
the app is unsigned and not notarised: macOS refuses the first launch until the
user right-clicks the app, picks Open, or clears the quarantine flag:

```bash
xattr -dr com.apple.quarantine /Applications/LomeSearch.app
```

The CI job for macOS only runs when the repository variable
`ENABLE_MACOS_RUNNERS` is `true`, because a GitHub account without macOS runner
access gets the job cancelled in the first second, and a cancelled job cancels
the whole run. Turn the variable on once runners are available, or build the
bundles on any Mac with `npm run dist:mac`; the result is identical.

Signing and notarisation need an Apple Developer ID: set `CSC_LINK`,
`CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and
`APPLE_TEAM_ID`, then drop `identity: null` (or keep it and let electron-builder
pick the certificate from the keychain).

### Android

`packages/android/build.sh` needs a JDK 17+ and an Android SDK with
`build-tools/36.0.0` and `platforms/android-36`. It drives `aapt2`, `javac`, `d8`,
`zipalign` and `apksigner` directly — no Gradle, no dependency downloads.

Signing uses `LOMESEARCH_KEYSTORE` and `LOMESEARCH_KEYSTORE_PASSWORD` when set;
otherwise a local keystore is created once under
`packages/android/.keystore/lomesearch.jks` (git-ignored, outside `build/`, so the
build wipe does not delete it) and every rebuild signs with the same key. Losing
that file means future APKs cannot be installed over older ones.

## Continuous integration

`.github/workflows/dist.yml` builds every artifact on its native runner and
attaches them to the run. Pushing a tag matching `v*` also publishes them as a
GitHub release.

Signing secrets, all optional:

| Secret | Use |
| --- | --- |
| `CSC_LINK`, `CSC_KEY_PASSWORD` | Windows code signing (base64 or URL of the certificate) |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | macOS notarisation once a Developer ID exists |
| `ANDROID_KEYSTORE_BASE64` | Base64 of the `.jks` used for release APKs |
| `ANDROID_KEYSTORE_PASSWORD` | Password for that keystore |
| `ANDROID_KEY_ALIAS` | Key alias, defaults to `lomesearch` |

Without `ANDROID_KEYSTORE_BASE64` the Android job signs with a throwaway key, which
is fine for testing but means the APK cannot be installed over a previous build.

## Verifying an artifact

```bash
bash packages/android/test.sh                                  # client address logic
dpkg-deb -I dist/LomeSearch-*-linux-amd64.deb                   # package metadata
dpkg-deb -c dist/LomeSearch-*-linux-amd64.deb | grep desktop    # desktop entry present

ANDROID_BT="${ANDROID_HOME:-/tmp/android-sdk/sdk}/build-tools/36.0.0"
"$ANDROID_BT/aapt2" dump badging dist/LomeSearch-*-android.apk
"$ANDROID_BT/apksigner" verify --print-certs dist/LomeSearch-*-android.apk

# the packaged Linux build starts its own engine on 127.0.0.1:7717
dist/linux-unpacked/lomesearch &
curl -s http://127.0.0.1:7717/health
```

`dist/linux-unpacked` is what the AppImage and the deb both contain, so running it
is the quickest way to smoke-test a build without unpacking the artifacts.

The engine is bundled at `resources/engine/dist/src/cli.js` inside the Electron
payload (and under `/opt/LomeSearch/resources/engine/` in the deb), so a packaged
build never depends on the machine having the repository checked out.
