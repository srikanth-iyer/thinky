#!/bin/bash
# The Android code's plain rules (android/kotlin/Checks.kt) tested on a plain JVM, no phone or Android
# SDK: compiles Checks.kt with ChecksTest.kt and runs it. Uses `kotlinc` when there is one (GitHub's
# ubuntu runners have it), else the Kotlin compiler inside a Gradle install (its lib/ has
# kotlin-compiler-embeddable). Run from anywhere: bash android/test/run.sh
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT
SRC=("$HERE/../kotlin/Checks.kt" "$HERE/ChecksTest.kt")
if command -v kotlinc >/dev/null 2>&1; then
  kotlinc "${SRC[@]}" -d "$OUT" 2>&1 | grep -v '^warning:' || true
  STDLIB=$(dirname "$(readlink -f "$(command -v kotlinc)")")/../lib/kotlin-stdlib.jar
else
  LIB=$( (ls -d "${GRADLE_HOME:-/nonexistent}/lib" /opt/gradle*/lib 2>/dev/null || true) | head -1)
  [ -n "$LIB" ] || { echo "no kotlinc and no Gradle install found"; exit 2; }
  jar() { ls "$LIB"/$1-[0-9]*.jar | head -1; }
  CP="$(jar kotlin-compiler-embeddable):$(jar kotlin-stdlib):$(jar kotlin-script-runtime):$(jar kotlin-reflect):$(jar trove4j):$(jar kotlinx-coroutines-core-jvm):$(jar annotations):$(jar kotlin-daemon-embeddable)"
  STDLIB=$(jar kotlin-stdlib)
  java -cp "$CP" org.jetbrains.kotlin.cli.jvm.K2JVMCompiler -no-stdlib -no-reflect -cp "$STDLIB" "${SRC[@]}" -d "$OUT" 2>&1 | grep -v -e '^warning:' -e '^Picked up' || true
fi
[ -f "$OUT/ChecksTestKt.class" ] || { echo "FAIL the tests didn't compile"; exit 1; }
java -Drepo="$HERE/../.." -cp "$OUT:$STDLIB" ChecksTestKt 2>&1 | grep -v '^Picked up'
exit "${PIPESTATUS[0]}"
