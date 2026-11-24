#!/usr/bin/env bash
# Builds the LomeSearch Android client without Gradle.
#
# Needs: JDK 17+, Android build-tools, an Android platform jar and zip/unzip.
# Point ANDROID_HOME at an SDK that contains build-tools/<version> and
# platforms/<api>, or set ANDROID_BUILD_TOOLS / ANDROID_PLATFORM directly.
#
# Signing: LOMESEARCH_KEYSTORE (+ LOMESEARCH_KEYSTORE_PASSWORD, alias
# LOMESEARCH_KEY_ALIAS, default "lomesearch") produces a release-signed APK.
# Without it the script creates .keystore/lomesearch.jks on first use, so
# repeated local builds keep the same signature (and later builds can be
# installed over earlier ones).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
version="$(sed -n 's/.*android:versionName="\([^"]*\)".*/\1/p' "$here/AndroidManifest.xml")"
version="${version:-1.0.0}"

sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/tmp/android-sdk/sdk}}"
build_tools="${ANDROID_BUILD_TOOLS:-$(ls -d "$sdk"/build-tools/* 2>/dev/null | sort -V | tail -1)}"
platform="${ANDROID_PLATFORM:-$(ls -d "$sdk"/platforms/* 2>/dev/null | sort -V | tail -1)}"

for tool in aapt2 d8 zipalign apksigner; do
  if [[ ! -x "$build_tools/$tool" ]]; then
    echo "missing $tool in $build_tools (set ANDROID_HOME)" >&2
    exit 1
  fi
done
if [[ ! -f "$platform/android.jar" ]]; then
  echo "missing android.jar in $platform (set ANDROID_HOME)" >&2
  exit 1
fi

out="$here/build"
rm -rf "$out"
mkdir -p "$out/res" "$out/gen" "$out/classes" "$out/dex"

# The pages and the in-page engine are the ones the web edition ships. The APK
# carries them as assets, so search runs on the device: no server, no port.
web="$here/../../site/web"
assets="$here/assets"
if [[ ! -f "$web/engine.js" ]]; then
  echo "missing $web/engine.js: run node scripts/build-web.mjs first" >&2
  exit 1
fi
rm -rf "$assets/web"
mkdir -p "$assets/web/data"
cp "$web/index.html" "$web/app.css" "$assets/web/"
cp "$web/data/corpus.json" "$assets/web/data/corpus.json"

# A file:// document is a null origin, and Chromium refuses to load module
# scripts from one: the pages ship as a single classic script instead.
esbuild="$here/../../node_modules/.bin/esbuild"
if [[ ! -x "$esbuild" ]]; then
  echo "missing esbuild: run npm ci first" >&2
  exit 1
fi
"$esbuild" "$web/app.js" --bundle --format=iife --target=chrome100 \
  --log-level=warning --outfile="$assets/web/app.js"

# `fetch` of a relative file is refused on file:// origins, so the corpus ships
# as a script that assigns window.LOME_CORPUS before app.js boots.
{
  printf 'window.LOME_CORPUS='
  cat "$web/data/corpus.json"
  printf ';\n'
} > "$assets/web/corpus.js"

# The mascot lives in the site's assets; the APK carries its own copy so the
# page renders without reaching outside the bundle.
mkdir -p "$assets/assets/mascot"
cp "$web/../assets/mascot/mascotte.svg" "$assets/assets/mascot/mascotte.svg"

index="$assets/web/index.html"
sed -i '/<link rel="icon"/d' "$index"
sed -i "s|script-src 'self'; style-src 'self'|script-src 'self' file:; style-src 'self' file:|" "$index"
sed -i "s|img-src 'self' data:|img-src 'self' file: data:|" "$index"
sed -i "s|font-src 'self'|font-src 'self' file:|" "$index"
sed -i "s|connect-src 'self'|connect-src 'none'|" "$index"
sed -i 's|<script type="module" src="./app.js"></script>|<script src="./corpus.js"></script>\n    <script src="./app.js"></script>|' "$index"

echo "compile resources"
"$build_tools/aapt2" compile --dir "$here/res" -o "$out/res/resources.zip"

echo "link resources"
"$build_tools/aapt2" link \
  -o "$out/app-unsigned.apk" \
  -I "$platform/android.jar" \
  --manifest "$here/AndroidManifest.xml" \
  --java "$out/gen" \
  --min-sdk-version 24 \
  --target-sdk-version 36 \
  --auto-add-overlay \
  -A "$assets" \
  "$out/res/resources.zip"

echo "compile java"
javac --release 8 -nowarn -Xlint:-options \
  -classpath "$platform/android.jar" \
  -d "$out/classes" \
  "$out/gen/org/lomesearch/android/R.java" \
  "$here"/src/org/lomesearch/android/*.java

echo "dex"
"$build_tools/d8" --release --min-api 24 --lib "$platform/android.jar" \
  --output "$out/dex" $(find "$out/classes" -name '*.class')

echo "package"
(cd "$out/dex" && zip -q -j "$out/app-unsigned.apk" classes.dex)
"$build_tools/zipalign" -f -p 4 "$out/app-unsigned.apk" "$out/app-aligned.apk"

keystore="${LOMESEARCH_KEYSTORE:-$here/.keystore/lomesearch.jks}"
if [[ ! -f "$keystore" ]]; then
  mkdir -p "$(dirname "$keystore")"
  keytool -genkeypair -keystore "$keystore" -storepass "${LOMESEARCH_KEYSTORE_PASSWORD:-lomesearch}" \
    -alias "${LOMESEARCH_KEY_ALIAS:-lomesearch}" -keyalg RSA -keysize 2048 -validity 10950 \
    -dname "CN=LomeSearch, OU=Android, O=LomeSearch contributors, C=IT" >/dev/null
  echo "created keystore $keystore"
fi

echo "sign"
mkdir -p "$here/../../dist"
apk="$here/../../dist/LomeSearch-${version}-android.apk"
"$build_tools/apksigner" sign \
  --ks "$keystore" \
  --ks-pass "pass:${LOMESEARCH_KEYSTORE_PASSWORD:-lomesearch}" \
  --ks-key-alias "${LOMESEARCH_KEY_ALIAS:-lomesearch}" \
  --min-sdk-version 24 \
  --out "$apk" "$out/app-aligned.apk"

"$build_tools/apksigner" verify --print-certs "$apk" | head -4
echo "built $apk"
