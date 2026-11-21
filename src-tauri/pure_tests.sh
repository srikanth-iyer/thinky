#!/bin/sh
# The shell's tests that need neither Windows nor Tauri (src-tauri/src/shell_rules.rs and
# ai_key.rs), run with plain rustc against outline_core: for a computer that can't build the whole
# shell (Linux without WebKitGTK, the cloud workspace). On Windows, `cargo test -p lean-outliner`
# runs these with the rest.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
# the library's file as cargo itself names it (a restored CI cache can leave target/debug without
# its copy of liboutline_core.rlib while cargo counts the build as done, so that path isn't relied on)
rlib=$(cargo build -q -p outline_core --message-format=json \
  | grep '"name":"outline_core"' | grep -o '"filenames":\[[^]]*\]' \
  | grep -o '[^"]*liboutline_core[^"]*\.rlib' | tail -n 1)
[ -n "$rlib" ] && [ -f "$rlib" ] || { echo "pure_tests.sh: cargo named no liboutline_core.rlib" >&2; exit 1; }
deps=$(dirname "$rlib")
[ "$(basename "$deps")" = deps ] || deps="$deps/deps"
out="${CARGO_TARGET_DIR:-$root/target}/pure-tests"
mkdir -p "$out"
for f in shell_rules ai_key; do
  rustc --edition 2021 --test "src-tauri/src/$f.rs" --crate-name "$f" -o "$out/$f" \
    --extern outline_core="$rlib" -L dependency="$deps"
  "$out/$f"
done
