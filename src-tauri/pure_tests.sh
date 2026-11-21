#!/bin/sh
# The shell's tests that need neither Windows nor Tauri (src-tauri/src/shell_rules.rs and
# ai_key.rs), run with plain rustc against outline_core: for a computer that can't build the whole
# shell (Linux without WebKitGTK, the cloud workspace). On Windows, `cargo test -p lean-outliner`
# runs these with the rest.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
cargo build -q -p outline_core
out="${CARGO_TARGET_DIR:-$root/target}/pure-tests"
mkdir -p "$out"
lib="${CARGO_TARGET_DIR:-$root/target}/debug"
for f in shell_rules ai_key; do
  rustc --edition 2021 --test "src-tauri/src/$f.rs" --crate-name "$f" -o "$out/$f" \
    --extern outline_core="$lib/liboutline_core.rlib" -L dependency="$lib/deps"
  "$out/$f"
done
