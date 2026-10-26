#!/bin/bash
# Android emulator smoke test (run by .github/workflows/android-test.yml). Everything is logged to
# android-test/log.txt with screenshots, for reading afterwards; a short list of results at the end
# (PASS/FAIL) makes the job fail if something didn't work, after all steps have run.
OUT=android-test; mkdir -p $OUT
log() { echo "== $*" | tee -a $OUT/log.txt; }
shot() { adb exec-out screencap -p > "$OUT/$1.png"; log "screenshot $1"; }
run() { log "\$ $*"; "$@" 2>&1 | tee -a $OUT/log.txt; }
# the whole system log, from the start (the emulator's log buffer is too small to read afterwards)
adb logcat -c
adb logcat -v threadtime > $OUT/logcat.txt 2>&1 &
LOGCAT=$!
# is the app still running, and what is on top?
alive() { log "app pid: '$(adb shell pidof "$PKG" | tr -d '\r')' top: $(adb shell dumpsys activity activities | tr -d '\r' | grep -m1 -o 'topResumedActivity=[^}]*' )"; }
# attach the DevTools forward to the app's current process (after a restart too)
connect() {
  PID=$(adb shell pidof "$PKG" | tr -d '\r' | awk '{print $1}')
  SOCK=$(adb shell cat /proc/net/unix | tr -d '\r' | grep -o "webview_devtools_remote_$PID" | head -1)
  log "pid $PID devtools socket: ${SOCK:-none}"
  [ -n "$SOCK" ] && adb forward tcp:9222 "localabstract:$SOCK" >/dev/null
}
# if the app is gone, note it and start it again so the remaining checks still run
ensure_app() {
  if [ -z "$(adb shell pidof "$PKG" | tr -d '\r')" ]; then
    log "!! the app was not running: starting it again"
    run adb shell am start -W -n "$PKG/.MainActivity"
    sleep 8
    connect
  fi
}

APK=$(ls apk/*.apk | head -1)
run adb install -r "$APK"
PKG=$(adb shell pm list packages | tr -d '\r' | sed 's/^package://' | grep -i leanoutliner | head -1)
log "package: $PKG"
TODAY=$(python3 scripts/make_test_vault.py /tmp/vault)
log "today's journal: $TODAY"
run adb push /tmp/vault /sdcard/
run adb shell ls /sdcard/vault /sdcard/vault/Diary

# 1. first start without file access: the app explains and offers a button (no automatic jump)
run adb shell am start -W -n "$PKG/.MainActivity"
sleep 10; shot 01-first-start-explains-access
run python3 scripts/ui_tap.py "Open the setting"
sleep 4; shot 02-android-all-files-access
run adb shell appops set --uid "$PKG" MANAGE_EXTERNAL_STORAGE allow
run adb shell input keyevent KEYCODE_BACK
sleep 5; shot 03-back-in-app-folder-picker

# 2. drive the page over the DevTools protocol (debug build only)
connect
CDP="node scripts/android_cdp.mjs"
if [ -n "$SOCK" ]; then
  run $CDP eval "(async () => { const s = (ms) => new Promise(r => setTimeout(r, ms)); const b = [...document.querySelectorAll('.picker li button')].find(x => x.textContent.trim().startsWith('vault')); if (!b) return 'no vault folder listed: ' + (document.querySelector('#main')?.innerText || '').slice(0, 400); b.click(); await s(1000); const u = document.querySelector('.picker [data-use]'); if (!u || u.disabled) return 'Use this folder is disabled'; u.click(); await s(3000); return { hash: location.hash, days: [...document.querySelectorAll('.sheet .page-title')].map(e => e.textContent), err: document.querySelector('.err')?.textContent || null }; })()"
else
  log "no DevTools socket; tapping through the picker instead"
  run python3 scripts/ui_tap.py vault; sleep 2
  run python3 scripts/ui_tap.py "Use this folder"; sleep 4
fi
for i in 1 2 3 4 5 6; do sleep 1; alive; done
shot 04-journals
ensure_app
# 2b. scrolling down the journals keeps loading older days (like Logseq)
if [ -n "$SOCK" ]; then
  BEFORE=$($CDP eval "document.querySelectorAll('.sheet').length" | tr -d '\r')
  # swipe up the middle of the screen, from 80% to 25% of its height (whatever size the emulator is)
  read -r SW SH <<< "$(adb shell wm size | grep -o '[0-9]*x[0-9]*' | tail -1 | tr 'x' ' ')"
  SW=${SW:-320}; SH=${SH:-640}
  for i in 1 2 3 4 5 6 7 8 9 10; do adb shell input swipe $((SW / 2)) $((SH * 8 / 10)) $((SW / 2)) $((SH / 4)) 250; sleep 1; done
  sleep 2; shot 04b-journals-scrolled
  AFTER=$($CDP eval "document.querySelectorAll('.sheet').length" | tr -d '\r')
  log "journal days shown: $BEFORE before scrolling, $AFTER after"
  run $CDP eval "(async () => { window.scrollTo(0, 0); await new Promise(r => setTimeout(r, 500)); return { sched: document.querySelector('.sched')?.innerText.slice(0, 200) || null }; })()"
  sleep 1; shot 04c-today-scheduled
fi

ensure_app
# 3. edit: tap a block (opens the keyboard + toolbar), type, let autosave run
run python3 scripts/ui_tap.py "cold-proving"
sleep 2
run adb shell input keyevent KEYCODE_MOVE_END
run adb shell input text "%styped%son%sandroid"
sleep 2; shot 05-editing-keyboard
sleep 2
log "today's file after typing:"
run adb shell "cat '/sdcard/vault/Diary/$TODAY.md'"

ensure_app
# 4. a page with linked references, in another look
if [ -n "$SOCK" ]; then
  run $CDP eval "(async () => { const a = window.leanApp; a.setSkin('grimoire'); a.go('page', 'Sourdough Bread'); await new Promise(r => setTimeout(r, 2000)); return { title: document.querySelector('h1.page-title')?.textContent, refs: document.querySelectorAll('.refgrp').length, blocks: document.querySelectorAll('.outline .blk').length }; })()"
  sleep 1; shot 06-page-grimoire
  run $CDP eval "(async () => { window.leanApp.setSkin('sticker'); window.leanApp.go('journals'); await new Promise(r => setTimeout(r, 2000)); return document.querySelectorAll('.sheet').length; })()"
  sleep 1; shot 07-journals-sticker
fi

# 5. share text from another app into today's journal
run adb shell am start -n "$PKG/.QuickCaptureActivity" -a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT "'Shared from another app'"
sleep 4; shot 08-quick-capture
run python3 scripts/ui_tap.py Add --exact
sleep 3; shot 09-after-add
log "today's file after sharing:"
run adb shell "cat '/sdcard/vault/Diary/$TODAY.md'"

log "the capture page after sharing:"
run adb shell "cat '/sdcard/vault/pages/quick capture.md'"

# 6. share a picture: copied into assets/ and linked; then shown in the app
python3 -c "
import struct, zlib
def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
raw = b''.join(b'\x00' + bytes([200, 60, 40] * 32) for _ in range(32))
png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 32, 32, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')
open('/tmp/shared.png', 'wb').write(png)
"
run adb push /tmp/shared.png /sdcard/Download/shared.png
run adb shell am start -n "$PKG/.QuickCaptureActivity" -a android.intent.action.SEND -t image/png --eu android.intent.extra.STREAM file:///sdcard/Download/shared.png
sleep 4; shot 10-share-picture
run python3 scripts/ui_tap.py Add --exact
sleep 3
run adb shell ls /sdcard/vault/assets
run adb shell "cat '/sdcard/vault/pages/quick capture.md'"
ensure_app
if [ -n "$SOCK" ]; then
  run $CDP eval "(async () => { const s = (ms) => new Promise(r => setTimeout(r, ms)); await window.leanApp.rescan(); window.leanApp.go('page', 'quick capture'); await s(2500); const im = document.querySelector('.outline img'); return { blocks: [...document.querySelectorAll('.outline .bc')].map(e => e.textContent.slice(0, 80)), img: im ? { src: im.getAttribute('src'), loaded: im.complete && im.naturalWidth > 0 } : null }; })()"
  sleep 1; shot 11-picture-in-app

  # 7. the look picker in the phone's drawer
  LOOKS=$($CDP eval "(async () => { const s = (ms) => new Promise(r => setTimeout(r, ms)); document.querySelector('#topbar [data-a=menu]').click(); await s(600); document.querySelector('#side [data-a=looks]').click(); await s(600); const p = document.querySelector('.pop.looks'); if (!p) return 'no list'; const r = p.getBoundingClientRect(); return { rows: p.querySelectorAll('[data-look]').length, top: Math.round(r.top), bottom: Math.round(r.bottom), height: innerHeight }; })()" | tr -d '\r')
  log "look list: $LOOKS"
  sleep 1; shot 12-look-picker
  run $CDP eval "(async () => { document.querySelector('.pop.looks [data-look=plain]')?.click(); await new Promise(r => setTimeout(r, 500)); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); document.body.classList.remove('drawer'); return document.documentElement.dataset.skin; })()"

  # 8. Android's back button goes back inside the app
  run $CDP eval "(async () => { const s = (ms) => new Promise(r => setTimeout(r, ms)); window.leanApp.go('journals'); await s(1000); window.leanApp.go('page', 'Sourdough Bread'); await s(1500); return location.hash; })()"
  run adb shell input keyevent KEYCODE_BACK
  sleep 2; shot 13-after-back
  BACKHASH=$($CDP eval "location.hash" | tr -d '\r')
  log "hash after Back: $BACKHASH"

  # 9. print / save as PDF opens Android's print screen
  run $CDP eval "window.LeanAndroid.print('Sourdough Bread'); 'asked'"
  sleep 5; shot 14-print-screen
  run adb shell input keyevent KEYCODE_BACK
  sleep 2

  # 10. Back closes what's open first (here the menu drawer) and stays on the page; with nothing
  #     open it goes back a page; at the start it leaves the app (to the home screen), still running
  ensure_app
  run $CDP eval "(async () => { const s = (ms) => new Promise(r => setTimeout(r, ms)); window.leanApp.go('journals'); await s(1000); window.leanApp.go('page', 'Sourdough Bread'); await s(1500); document.querySelector('#topbar [data-a=menu]').click(); await s(600); return document.body.classList.contains('drawer'); })()"
  sleep 1; shot 15-drawer-open
  run adb shell input keyevent KEYCODE_BACK
  sleep 2; shot 16-after-back-drawer
  DRAWER=$($CDP eval "({ drawer: document.body.classList.contains('drawer'), hash: decodeURIComponent(location.hash) })" | tr -d '\r')
  log "after Back with the menu drawer open: $DRAWER"
  run $CDP eval "(async () => { history.go(-window.leanApp.histN); await new Promise(r => setTimeout(r, 1500)); return { n: window.leanApp.histN, hash: location.hash }; })()"
  run adb shell input keyevent KEYCODE_BACK
  sleep 3; shot 17-after-back-at-start
  TOP=$(adb shell dumpsys activity activities | tr -d '\r' | grep -m1 -o 'topResumedActivity=[^}]*')
  log "after Back at the start: $TOP"
fi

# 11. the widgets (today's journal, and the one-tap +) are offered to the home screen
run bash -c "adb shell dumpsys appwidget | grep -i -A2 'journalwidget\|quickaddwidget' | head -12"
log "crashes (none expected):"
run adb logcat -b crash -d
log "the app's own problems log:"
run adb shell "run-as $PKG sh -c 'ls -la cache; cat cache/problems.log'"
kill $LOGCAT 2>/dev/null
log "app processes that ended (from the full log):"
run bash -c "grep -E 'Process $PKG|has died|Killing [0-9]+:$PKG|Force finishing|ANR in|Fatal signal|FATAL|crash detected|wasn.t handled' $OUT/logcat.txt | head -40"

# 12. results, one line each, so a run where something didn't work can't look fine
FAILED=0
result() { if eval "$2" >/dev/null 2>&1; then log "PASS $1"; else log "FAIL $1"; FAILED=1; fi; }
dev() { adb shell "cat '$1'" 2>/dev/null | tr -d '\r'; }
result "the app kept running (never had to be started again)" "! grep -q 'the app was not running' $OUT/log.txt"
result "the app didn't crash" "! adb logcat -b crash -d | grep -q '$PKG'"
result "nothing in the app's problems log" "! adb shell \"run-as $PKG sh -c 'cat cache/problems.log 2>/dev/null'\" | grep -q ."
result "choosing the folder opened the notes" "grep -q '\"hash\": \"#/journals\"' $OUT/log.txt"
result "typing on the phone was saved" "dev '/sdcard/vault/Diary/$TODAY.md' | grep -q 'typed on android'"
result "a page with linked references opened" "grep -q '\"title\": \"Sourdough Bread\"' $OUT/log.txt"
result "text shared from another app was added" "{ dev '/sdcard/vault/Diary/$TODAY.md'; dev '/sdcard/vault/pages/quick capture.md'; } | grep -q 'Shared from another app'"
result "a shared picture was saved and linked" "adb shell ls /sdcard/vault/assets | grep -q . && { dev '/sdcard/vault/Diary/$TODAY.md'; dev '/sdcard/vault/pages/quick capture.md'; } | grep -q 'assets/'"
result "the picture shows in the app" "grep -q '\"loaded\": true' $OUT/log.txt"
result "the look list fits the screen" "python3 -c 'import json,sys; d=json.loads(sys.argv[1]); sys.exit(0 if d[\"rows\"] >= 9 and d[\"top\"] >= 0 and d[\"bottom\"] <= d[\"height\"] else 1)' '$LOOKS'"
result "scrolling the journals loads older days" "[ -n '$BEFORE' ] && [ -n '$AFTER' ] && [ '$AFTER' -gt '$BEFORE' ]"
result "Android's back button goes back inside the app" "[ '$BACKHASH' = '\"#/journals\"' ]"
result "Back closes the menu drawer first and stays on the page" "python3 -c 'import json,sys; d=json.loads(sys.argv[1]); sys.exit(0 if d[\"drawer\"] is False and d[\"hash\"].endswith(\"Sourdough Bread\") else 1)' '$DRAWER'"
result "Back at the start leaves the app for the home screen" "[ -n '$TOP' ] && ! echo '$TOP' | grep -q '$PKG'"
result "the app keeps running after leaving" "[ -n \"\$(adb shell pidof $PKG | tr -d '\r')\" ]"
result "both widgets are offered to the home screen" "adb shell dumpsys appwidget | grep -qi journalwidget && adb shell dumpsys appwidget | grep -qi quickaddwidget"
gzip -9 $OUT/logcat.txt
log "done: $([ $FAILED = 0 ] && echo 'everything passed' || echo 'SOMETHING FAILED, see the FAIL lines')"
exit $FAILED
