#!/bin/sh
# The shell's tests that need neither Windows nor Tauri (src-tauri/src/shell_rules.rs and
# ai_key.rs), built by cargo as the tests of a small package of their own (src-tauri/pure), with
# outline_core and nothing else: for a computer that can't build the whole shell (Linux without
# WebKitGTK, GitHub's test job, the cloud workspace). On Windows, `cargo test -p lean-outliner`
# runs these with the rest. (Until Nov 21 this was plain rustc against target/debug's
# liboutline_core.rlib, which GitHub's runner, with its restored cache, couldn't load.)
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
cargo test -q -p shell_pure_tests --locked "$@"
