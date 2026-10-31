#!/bin/bash
# UI tests in a real browser against the dev server (see CLAUDE.md, "Build & test").
#   dev/ui-tests/run.sh            all tests
#   dev/ui-tests/run.sh t3_pages   one test
# Each test gets a fresh sample vault in $UI_TEST_DIR (default /tmp/lean-ui-test); screenshots
# go to $UI_TEST_DIR/shots, the dev server's safety copies to $UI_TEST_DIR/data (also fresh for each
# test). UI_TEST_PORT picks the dev server's port (default 8766).
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
export UI_TEST_DIR=${UI_TEST_DIR:-/tmp/lean-ui-test}
export LEAN_DATA_DIR="$UI_TEST_DIR/data"
PORT=${UI_TEST_PORT:-8766} # another port and folder let two copies of the project test at once
export BASE=http://127.0.0.1:$PORT
mkdir -p "$UI_TEST_DIR"
(cd "$ROOT" && cargo build -q -p devserver) || exit 1
tests=("$@")
[ ${#tests[@]} -eq 0 ] && tests=(smoke t1_editing t2_blocks t3_pages t4_sync t5_long t6_looks t7_layout t8_phone t9_journals t10_safety t10_shortcuts t11_reading t12_pictures t13_update t13_tabs t13_tabs_safety t14_refs t14_history t14_blockmenu t15_search t15_looks t15_nav t15_edit t15_pages t15_drag t16_safety t16_alias t16_widget t16_find t16_gaps t16_refs t16_reftools t16_looks t16_looks2 t16_start t16_phone t16_feedback t16_brand t16_logo t16_settings t16_browser t17_refedit t18_security t19_build34)
status=0
fuser -k $PORT/tcp >/dev/null 2>&1 # a server left over from an earlier run would serve old code
for t in "${tests[@]}"; do
  echo "=== $t"
  python3 "$HERE/make_vault.py" "$UI_TEST_DIR/vault" >/dev/null
  rm -rf "$LEAN_DATA_DIR"
  "$ROOT/target/debug/devserver" "$UI_TEST_DIR/vault" $PORT > "$UI_TEST_DIR/dev.log" 2>&1 &
  server=$!
  for i in $(seq 100); do grep -q "http://" "$UI_TEST_DIR/dev.log" 2>/dev/null && break; sleep 0.2; done # up to 20 s on a busy machine
  grep -q "http://" "$UI_TEST_DIR/dev.log" || { echo "dev server failed:"; cat "$UI_TEST_DIR/dev.log"; exit 1; }
  out=$(cd "$HERE" && node "${t%.mjs}.mjs" 2>&1); code=$?
  echo "$out" | grep -v "^  ok"
  if [ $code -ne 0 ] || echo "$out" | grep -qE "FAIL|FAILED|script errors:"; then status=1; fi
  kill $server; wait $server 2>/dev/null
done
exit $status
