#!/bin/bash
# Build the website's "try thinky" demo: the real ui/ with the real core in the page (WebAssembly).
#   web/build-demo.sh [out dir]    (default web/demo-out)
# Needs: rustup target add wasm32-wasip1. Optional: wasm-opt (binaryen) on PATH, for a smaller file.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=${1:-$ROOT/web/demo-out}
(cd "$ROOT/web/core-wasm" && cargo build --release --target wasm32-wasip1)
WASM=$ROOT/web/core-wasm/target/wasm32-wasip1/release/thinky_web.wasm
rm -rf "$OUT" && mkdir -p "$OUT"
cp -r "$ROOT/ui/." "$OUT/"
# the demo's own part (the core in the page, its file layer): kept out of ui/, which the app packs
cp -r "$ROOT/web/demo/." "$OUT/"
rm -f "$OUT/thinky_core.wasm"
if command -v wasm-opt >/dev/null; then
  wasm-opt -Oz --enable-bulk-memory --enable-nontrapping-float-to-int --enable-sign-ext --enable-mutable-globals "$WASM" -o "$OUT/thinky_core.wasm"
else
  cp "$WASM" "$OUT/thinky_core.wasm"
fi
# the demo's page: the app's own, marked as the demo (api.js then calls the core in the page)
sed -i 's/<html lang="en" data-skin="thinky">/<html lang="en" data-skin="thinky" data-web-demo>/' "$OUT/index.html"
grep -q data-web-demo "$OUT/index.html"
echo "demo in $OUT ($(du -sh "$OUT" | cut -f1))"
