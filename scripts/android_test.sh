#!/bin/bash
# Android emulator smoke test (run by .github/workflows/android-test.yml). Never fails the job:
# everything is logged to android-test/log.txt with screenshots, for reading afterwards.
OUT=android-test; mkdir -p $OUT
log() { echo "== $*" | tee -a $OUT/log.txt; }
shot() { adb exec-out screencap -p > "$OUT/$1.png"; log "screenshot $1"; }
run() { log "\$ $*"; "$@" 2>&1 | tee -a $OUT/log.txt; }

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
PID=$(adb shell pidof "$PKG" | tr -d '\r')
SOCK=$(adb shell cat /proc/net/unix | tr -d '\r' | grep -o "webview_devtools_remote_$PID" | head -1)
log "pid $PID devtools socket: ${SOCK:-none}"
CDP="node scripts/android_cdp.mjs"
if [ -n "$SOCK" ]; then
  run adb forward tcp:9222 "localabstract:$SOCK"
  run $CDP eval "(async () => { const s = (ms) => new Promise(r => setTimeout(r, ms)); const b = [...document.querySelectorAll('.picker li button')].find(x => x.textContent.trim().startsWith('vault')); if (!b) return 'no vault folder listed: ' + (document.querySelector('#main')?.innerText || '').slice(0, 400); b.click(); await s(1000); const u = document.querySelector('.picker [data-use]'); if (!u || u.disabled) return 'Use this folder is disabled'; u.click(); await s(3000); return { hash: location.hash, days: [...document.querySelectorAll('.sheet .page-title')].map(e => e.textContent), err: document.querySelector('.err')?.textContent || null }; })()"
else
  log "no DevTools socket; tapping through the picker instead"
  run python3 scripts/ui_tap.py vault; sleep 2
  run python3 scripts/ui_tap.py "Use this folder"; sleep 4
fi
sleep 2; shot 04-journals

# 3. edit: tap a block (opens the keyboard + toolbar), type, let autosave run
run python3 scripts/ui_tap.py "cold-proving"
sleep 2
run adb shell input keyevent KEYCODE_MOVE_END
run adb shell input text "%styped%son%sandroid"
sleep 2; shot 05-editing-keyboard
sleep 2
log "today's file after typing:"
run adb shell "cat '/sdcard/vault/Diary/$TODAY.md'"

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

# 6. the widget is registered with the launcher
run bash -c "adb shell dumpsys appwidget | grep -i -A2 journalwidget | head -8"
run bash -c "adb logcat -d | grep -iE 'leanoutliner|tauri|chromium|AndroidRuntime' | tail -60"
log "done"
exit 0
