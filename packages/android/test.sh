#!/usr/bin/env bash
# Runs the pure-JVM part of the Android client (address handling) on the host.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
javac -nowarn -d "$out" -sourcepath "$here/src:$here/test" \
  "$here/test/org/lomesearch/android/EngineTest.java"
java -cp "$out" org.lomesearch.android.EngineTest
