#!/bin/bash
# Android emulator smoke test (run by .github/workflows/android-test.yml). Everything is logged to
# android-test/log.txt with screenshots, for reading afterwards; a short list of results at the end
# (PASS/FAIL) makes the job fail if something didn't work, after all steps have run.
OUT=android-test; mkdir -p $OUT
log() { echo "== $*" | tee -a $OUT/log.txt; }
shot() { adb exec-out screencap -p > "$OUT/$1.png"; log "screenshot $1"; }
run() { log "\$ $*"; "$@" 2>&1 | tee -a $OUT/log.txt; }
log "test script started $(date -u +%H:%M:%S); device: $(timeout 20 adb get-state 2>&1)"
# the whole system log, from the start (the emulator's log buffer is too small to read afterwards)
timeout 30 adb logcat -c || log "!! clearing the system log timed out"
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

# 1. first start without file access: the welcome screen explains and offers a button (no automatic jump)
run adb shell am start -W -n "$PKG/.MainActivity"
sleep 10; shot 01-first-start-explains-access
run python3 scripts/ui_tap.py "Open the setting"
sleep 4; shot 02-android-all-files-access
run adb shell appops set --uid "$PKG" MANAGE_EXTERNAL_STORAGE allow
run adb shell input keyevent KEYCODE_BACK
sleep 5; shot 03-back-in-app-welcome

# 2. drive the page over the DevTools protocol (debug build only)
connect
CDP="timeout 120 node scripts/android_cdp.mjs" # (never waits forever: a stuck step must not eat the whole run)
if [ -n "$SOCK" ]; then
  # (the welcome screen first: "Open an existing notes folder" shows the folder picker)
  run $CDP eval "(async () => { const s = (ms) => new Promise(r => setTimeout(r, ms)); const w = document.querySelector('[data-w=open]'); if (w) { w.click(); await s(1500); } const b = [...document.querySelectorAll('.picker li button')].find(x => x.textContent.trim().startsWith('vault')); if (!b) return 'no vault folder listed: ' + (document.querySelector('#main')?.innerText || '').slice(0, 400); b.click(); await s(1000); const u = document.querySelector('.picker [data-use]'); if (!u || u.disabled) return 'Use this folder is disabled'; u.click(); await s(3000); return { hash: location.hash, days: [...document.querySelectorAll('.sheet .page-title')].map(e => e.textContent), err: document.querySelector('.err')?.textContent || null }; })()"
else
  log "no DevTools socket; tapping through the welcome screen and the picker instead"
  run python3 scripts/ui_tap.py "Open an existing notes folder"; sleep 2
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
# 3b. the round "+" (phones): a new note at the end of today's journal, the keyboard up, typing goes in
if [ -n "$SOCK" ]; then
  run $CDP eval "(async () => { const a = window.leanApp; a.outlines.forEach((o) => { o.stopEdit(); o.clearSel(); }); document.activeElement?.blur(); a.updateToolbar(); a.go('journals'); await new Promise(r => setTimeout(r, 1500)); window.scrollTo(0, 0); return { plus: !!document.querySelector('#addnote:not([hidden])') }; })()"
  sleep 2 # (the keyboard goes down meanwhile; to the top again after that, then where the + is, in page pixels)
  PLUSAT=$($CDP eval "(async () => { window.scrollTo(0, 0); await new Promise(r => setTimeout(r, 500)); window.scrollTo(0, 0); const b = document.querySelector('#addnote'), r = b.getBoundingClientRect(); return { shown: getComputedStyle(b).display !== 'none', x: r.left + r.width / 2, y: r.top + r.height / 2, dpr: devicePixelRatio, top: scrollY }; })()" | tr -d '\r')
  log "the + on the page: $PLUSAT"
  sleep 1
  # by its name; else by its place (the page's pixels, from the web view's place on the screen)
  python3 scripts/ui_tap.py "add a note" --exact 2>&1 | tee -a $OUT/log.txt | grep -q tapped || python3 - "$PLUSAT" <<'PY' 2>&1 | tee -a $OUT/log.txt
import json, re, subprocess, sys
p = json.loads(sys.argv[1])
subprocess.run(["adb", "shell", "uiautomator", "dump", "/sdcard/ui.xml"], capture_output=True)
xml = subprocess.run(["adb", "shell", "cat", "/sdcard/ui.xml"], capture_output=True, text=True).stdout
m = re.search(r'class="android\.webkit\.WebView"[^>]*bounds="\[(\d+),(\d+)\]', xml)
x0, y0 = (int(m.group(1)), int(m.group(2))) if m else (0, 0)
x, y = round(x0 + p["x"] * p["dpr"]), round(y0 + p["y"] * p["dpr"])
subprocess.run(["adb", "shell", "input", "tap", str(x), str(y)])
print(f"tapped the + by its place at {x},{y} (web view from {x0},{y0}; shown: {p['shown']})")
PY
  sleep 2
  PLUSKB=$(adb shell dumpsys input_method | tr -d '\r' | grep -m1 -o -E 'mInputShown=[a-z]+')
  log "keyboard after the +: $PLUSKB"
  run adb shell input text "from%sthe%splus"
  sleep 3; shot 05b-plus-button
fi

ensure_app
# 4. a page with linked references, in another look
if [ -n "$SOCK" ]; then
  run $CDP eval "(async () => { const a = window.leanApp; a.setSkin('automaton'); a.go('page', 'Sourdough Bread'); await new Promise(r => setTimeout(r, 2000)); return { title: document.querySelector('h1.page-title')?.textContent, refs: document.querySelectorAll('.refgrp').length, blocks: document.querySelectorAll('.outline .blk').length }; })()"
  sleep 1; shot 06-page-automaton
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
run adb push /tmp/shared.png /sdcard/Pictures/shared.png
# shared the way a gallery app does: a content:// address from the phone's picture library (the
# pop-up refuses file:// addresses: it would open them with the app's own rights)
adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Pictures/shared.png >/dev/null 2>&1
SHARE_URI=""
for i in 1 2 3 4 5 6 7 8 9 10; do
  ID=$(adb shell content query --uri content://media/external/images/media --projection _id --where "_display_name=\'shared.png\'" 2>/dev/null | tr -d '\r' | grep -o '_id=[0-9]*' | head -1 | cut -d= -f2)
  [ -n "$ID" ] && { SHARE_URI="content://media/external/images/media/$ID"; break; }
  sleep 1
done
log "the shared picture's address: $SHARE_URI"
run adb shell am start -n "$PKG/.QuickCaptureActivity" -a android.intent.action.SEND -t image/png --eu android.intent.extra.STREAM "$SHARE_URI"
sleep 4; shot 10-share-picture
run python3 scripts/ui_tap.py Add --exact
sleep 3
# the same picture shared again: a file of its own, the first never written over
run adb shell am start -n "$PKG/.QuickCaptureActivity" -a android.intent.action.SEND -t image/png --eu android.intent.extra.STREAM "$SHARE_URI"
sleep 4
run python3 scripts/ui_tap.py Add --exact
sleep 3
# a file:// address (another app pointing the pop-up at a file) is refused: no picture shown
run adb push /tmp/shared.png /sdcard/Download/shared.png
run adb shell am start -n "$PKG/.QuickCaptureActivity" -a android.intent.action.SEND -t image/png --eu android.intent.extra.STREAM file:///sdcard/Download/shared.png
sleep 3
adb shell uiautomator dump /sdcard/ui-fileshare.xml >/dev/null 2>&1; adb exec-out cat /sdcard/ui-fileshare.xml > $OUT/ui-fileshare.xml 2>/dev/null
shot 10b-file-share-refused
adb shell input keyevent KEYCODE_BACK; sleep 1
run adb shell ls -l /sdcard/vault/assets
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

  # 7b. the widgets follow the look, light and dark ones: for each look, the journal widget's
  #     background, title, "+", empty line and a note's row, and the one-tap "+" (drawn), as the
  #     test-build-only LeanAndroid.testWidgetColors() makes them from the same RemoteViews the home
  #     screen gets, against the look's own colours (--surface, --ink, --ink-faint, --accent)
  WIDGET=$($CDP eval "(async () => { const s = (ms) => new Promise(r => setTimeout(r, ms)); const out = []; for (const id of ['plainnight', 'plainteal', 'paper', 'automaton', 'plain']) { window.leanApp.setSkin(id); await s(500); const css = getComputedStyle(document.documentElement); const want = (k) => css.getPropertyValue(k).trim().toLowerCase(); out.push({ id, want: { bg: want('--surface'), ink: want('--ink'), faint: want('--ink-faint'), accent: want('--accent') }, got: JSON.parse(window.LeanAndroid.testWidgetColors()) }); } return out; })()" | tr -d '\r')
  log "widget colours, per look: $WIDGET"

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
  LEFT=$(adb shell pidof "$PKG" | tr -d '\r') # (step 13 stops and restarts the app on purpose)
fi

# 11. one-click update (Settings → About → "Update now"), the real thing: Android's "Install unknown
#     apps" screen first; once allowed, the newest release is downloaded from the public repo's
#     releases (skipped before its first, Build 34) and checked (this test build is 0.1.0, so any release is newer). The release is signed
#     with the real key and this test build with a debug key, so the app itself must refuse it, before
#     Android's installer. Then the steps after a good download (a test-build-only path hands Android's
#     installer the app's own APK): Android asks to go ahead, the test cancels, and the app says so.
LATEST=$(curl -sS -o /dev/null -w '%{redirect_url}' https://github.com/srikanth-iyer/thinky/releases/latest | grep -o 'build-[0-9]*$')
log "newest release on the public repo: ${LATEST:-none yet}"
if [ -n "$SOCK" ] && [ -n "$LATEST" ]; then
  ensure_app
  run adb shell am start -W -n "$PKG/.MainActivity" # back to the front (Back at the start left it)
  sleep 3
  connect
  # as if today's check had just found that release (no GitHub API call needed)
  UPD=$($CDP eval "(async () => { const s = (ms) => new Promise(r => setTimeout(r, ms)); localStorage.setItem('updateCheck', JSON.stringify({ at: Date.now(), latest: { tag: '$LATEST', url: 'https://github.com/srikanth-iyer/thinky/releases/tag/$LATEST' } })); await window.leanApp.checkUpdate(); location.hash = '#/settings/about'; await s(2500); const b = document.querySelector('.upd [data-a=update]'); if (!b) return { stage: document.querySelector('.upd')?.dataset.stage || null, about: document.querySelector('.set-panel:not([hidden])')?.innerText.slice(0, 300) }; b.click(); await s(3000); return { stage: document.querySelector('.upd')?.dataset.stage, text: document.querySelector('.upd-out')?.textContent }; })()" | tr -d '\r')
  log "after Update now: $UPD"
  shot 18-update-install-unknown-apps
  UNKNOWN=$(adb shell dumpsys activity activities | tr -d '\r' | grep -m1 -o 'topResumedActivity=[^}]*')
  log "on top after Update now: $UNKNOWN"
  run adb shell appops set "$PKG" REQUEST_INSTALL_PACKAGES allow
  run adb shell input keyevent KEYCODE_BACK
  # the download (~8 MB) and the app's checks
  ST=""
  for i in $(seq 90); do
    sleep 2
    ST=$($CDP eval "document.querySelector('.upd')?.dataset.stage || ''" 2>/dev/null | tr -d '\r"')
    case "$ST" in confirm|error|done) break;; esac
  done
  REFUSED=$($CDP eval "document.querySelector('.upd-out')?.textContent || ''" 2>/dev/null | tr -d '\r')
  log "update stage: $ST; the app says: $REFUSED"
  shot 19-update-refused-by-the-app
  # the steps after a good download: Android's installer asks; cancelled, the app says so
  run $CDP eval "window.LeanAndroid.testInstallSelf(); 'handed over'"
  ASKED=""
  for i in $(seq 15); do
    sleep 2
    ASKED=$(adb shell dumpsys activity activities | tr -d '\r' | grep -m1 -o 'topResumedActivity=[^}]*')
    echo "$ASKED" | grep -qi packageinstaller && break
  done
  log "on top after handing over: $ASKED"
  shot 20-update-android-asks
  run adb shell input keyevent KEYCODE_BACK
  CANCELLED=""
  for i in $(seq 15); do
    sleep 2
    CANCELLED=$($CDP eval "document.querySelector('.upd-out')?.textContent || ''" 2>/dev/null | tr -d '\r')
    echo "$CANCELLED" | grep -q cancelled && break
  done
  log "after cancelling, the app says: $CANCELLED"
  shot 21-update-cancelled
  # (also as a notice: readable from the job's annotations even after another run replaced the results branch)
  echo "::notice title=One-click update on the emulator::Update now -> $(echo "$UPD" | tr -d '\n' | cut -c1-160) | on top: ${UNKNOWN#topResumedActivity=} | allowed -> stage $ST: $REFUSED | handed over -> on top: ${ASKED#topResumedActivity=} | cancelled -> $CANCELLED"
  run adb shell am start -W -n "$PKG/.MainActivity"
  sleep 2
fi

# 12. the widgets (today's journal, and the one-tap +) are offered to the home screen
run bash -c "adb shell dumpsys appwidget | grep -i -A2 'journalwidget\|quickaddwidget' | head -12"

# 13. the app icon's long-press shortcuts (Today, Add note, Search), which the app sets when it starts:
#     press and hold the icon on the home screen (else in the list of all apps), pick one from its menu
SIZE=$(adb shell wm size | tr -d '\r' | grep -o '[0-9]*x[0-9]*' | tail -1); W=${SIZE%x*}; H=${SIZE#*x}
adb shell dumpsys shortcut | tr -d '\r' | awk -v p="Package: $PKG" 'index($0, p) { on = 1; print; next } /Package: / { on = 0 } on' > $OUT/shortcuts.txt
log "the app's shortcuts (dumpsys shortcut):"
run grep -E 'id=|shortLabel=|intents=' $OUT/shortcuts.txt
shortcut() { # $1: the shortcut's name; $2: name for a screenshot of the menu
  #   each menu that opens is saved (icon-menu-<n>.xml): the check passes when one of them shows all three
  adb shell input keyevent KEYCODE_HOME; sleep 2
  if ! python3 scripts/ui_tap.py "thinky" --exact --long >> $OUT/log.txt; then
    log "no app icon on the home screen: trying the list of all apps"
    local try found=
    for try in 1 2; do # the list sometimes opens without the app in view: look again from the home screen
      adb shell input swipe $((W / 2)) $((H * 4 / 5)) $((W / 2)) $((H / 5)) 300; sleep 3
      if python3 scripts/ui_tap.py "thinky" --exact --long >> $OUT/log.txt; then found=1; break; fi
      shot "18x-all-apps-$MENUS-$try"; adb shell input keyevent KEYCODE_HOME; sleep 2
    done
    [ -n "$found" ] || return 1
  fi
  sleep 2
  MENUS=$((MENUS + 1)); adb shell uiautomator dump /sdcard/menu.xml >/dev/null 2>&1; adb shell cat /sdcard/menu.xml > $OUT/icon-menu-$MENUS.xml
  if [ -n "$2" ]; then shot "$2"; fi
  python3 scripts/ui_tap.py "$1" --exact --last >> $OUT/log.txt # the menu is drawn on top: the last match
}
MENUS=0
menu_shown() { local f; for f in $OUT/icon-menu-*.xml; do [ -f "$f" ] && grep -q 'text="Today"' "$f" && grep -q 'text="Add note"' "$f" && grep -q 'text="Search"' "$f" && return 0; done; return 1; }
if [ -n "$SOCK" ]; then
  # 13a. "Today" with the app open in the background (Back left it above): today's journal page
  shortcut "Today" 18-icon-menu || { log "!! couldn't use the launcher: sending the shortcut's request instead"; run adb shell am start -n "$PKG/.MainActivity" -a android.intent.action.MAIN --es open today; }
  sleep 4; connect; shot 19-shortcut-today
  SC_TODAY=$($CDP eval "decodeURIComponent(location.hash)" | tr -d '\r')
  log "after the Today shortcut: $SC_TODAY"
  # 13b. "Search" with the app not running (stopped here on purpose): it starts with the search box open
  run adb shell am force-stop "$PKG"
  shortcut "Search" || { log "!! couldn't use the launcher: sending the shortcut's request instead"; run adb shell am start -n "$PKG/.MainActivity" -a android.intent.action.MAIN --es open search; }
  sleep 10; connect; shot 20-shortcut-search
  SC_SEARCH=$($CDP eval "({ open: !document.querySelector('#search').hidden, focused: document.activeElement === document.querySelector('#search input'), hash: location.hash })" | tr -d '\r')
  log "after the Search shortcut: $SC_SEARCH"
  KEYBOARD=$(adb shell dumpsys input_method | tr -d '\r' | grep -m1 -o -E 'mInputShown=[a-z]+')
  log "keyboard: $KEYBOARD"
  # 13d. a leanoutliner://page/… link (the app's "Copy link"), opened from elsewhere while the app is
  #      open: Android hands it to the app (the manifest's VIEW filter), which shows that page
  run adb shell "am start -W -a android.intent.action.VIEW -d 'leanoutliner://page/Sourdough%20Bread'"
  sleep 4; connect; shot 20b-page-link
  SC_LINK=$($CDP eval "decodeURIComponent(location.hash)" | tr -d '\r')
  log "after the page link: $SC_LINK"
fi
# 13c. "Add note": the pop-up for a new note (as from the widget's +); Back twice closes keyboard and pop-up
shortcut "Add note"
sleep 3; shot 21-shortcut-add-note
SC_ADD=$(adb shell dumpsys activity activities | tr -d '\r' | grep -m1 -o 'topResumedActivity=[^}]*')
log "after the Add note shortcut: $SC_ADD"
adb shell input keyevent KEYCODE_BACK; sleep 1; adb shell input keyevent KEYCODE_BACK; sleep 1

# 14. the Quick Settings tile "Add note": offered with the other tiles; a tap opens the pop-up and closes
#     the pull-down shade
QS=$(adb shell cmd package query-services --components -a android.service.quicksettings.action.QS_TILE | tr -d '\r')
log "Quick Settings tiles that apps offer: $(echo $QS)"
run adb shell cmd statusbar add-tile "$PKG/.AddNoteTile"
sleep 2
log "tiles in the shade: $(adb shell settings get secure sysui_qs_tiles | tr -d '\r')"
adb shell input keyevent KEYCODE_HOME; sleep 1
run adb shell cmd statusbar expand-settings
sleep 3; shot 22-quick-settings
if ! python3 scripts/ui_tap.py "add note" --last >> $OUT/log.txt; then
  log "the tile isn't on screen: clicking it with cmd statusbar click-tile"
  run adb shell cmd statusbar click-tile "$PKG/.AddNoteTile"
fi
sleep 4; shot 23-tile-add-note
TILE_TOP=$(adb shell dumpsys activity activities | tr -d '\r' | grep -m1 -o 'topResumedActivity=[^}]*')
TILE_FOCUS=$(adb shell dumpsys window | tr -d '\r' | grep -m1 -o 'mCurrentFocus=[^}]*')
log "after tapping the tile: $TILE_TOP; focus: $TILE_FOCUS"
adb shell input keyevent KEYCODE_BACK; sleep 1; adb shell input keyevent KEYCODE_BACK; sleep 1
# 15. the pop-up adds through the app's own code (src-tauri/src/android_capture.rs, loaded by the pop-up
#     itself: the app is stopped first), so it finds the quick capture page as the app does: with the
#     page "Inbox" while pages/inbox.md is the page "Mail" (its title::), the note goes to a new
#     pages/Inbox (2).md, as on Windows and in the app, and Mail's file stays as it was
adb exec-out cat /sdcard/vault/logseq/config.edn > $OUT/config-before.edn
python3 - $OUT/config-before.edn <<'PY'
import sys
c = open(sys.argv[1]).read().rstrip().rstrip('}')
open('/tmp/config-inbox.edn', 'w').write(c + '\n :quick-capture-options {:insert-today? false :default-page "Inbox"}}\n')
open('/tmp/inbox.md', 'w').write('title:: Mail\n- mail, written before the share')
PY
run adb push /tmp/config-inbox.edn /sdcard/vault/logseq/config.edn
run adb push /tmp/inbox.md /sdcard/vault/pages/inbox.md
run adb shell am force-stop "$PKG"
sleep 1; log "app pid after stopping it: '$(adb shell pidof "$PKG" | tr -d '\r')'"
run adb shell am start -n "$PKG/.QuickCaptureActivity" -a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT "'Inbox check from the phone'"
sleep 5; shot 24-share-to-inbox
adb shell uiautomator dump /sdcard/qc.xml >/dev/null 2>&1; adb shell cat /sdcard/qc.xml > $OUT/qc-inbox.xml
INBOX_WHERE=$(grep -o 'text="to [^"]*"' $OUT/qc-inbox.xml | head -1)
log "the pop-up says: $INBOX_WHERE; its error line (none expected): $(grep -o 'text="[^"]*" resource-id="[^"]*qc_error"' $OUT/qc-inbox.xml | head -1)"
run python3 scripts/ui_tap.py Add --exact
sleep 4; shot 25-after-add-to-inbox
log "pop-up's library (logcat):"
run bash -c "grep -a ' LeanCore' $OUT/logcat.txt | tail -5"
log "pages/Inbox (2).md:"; run adb shell "cat '/sdcard/vault/pages/Inbox (2).md'"
log "pages/inbox.md (Mail):"; run adb shell "cat /sdcard/vault/pages/inbox.md"
adb exec-out cat /sdcard/vault/pages/inbox.md > $OUT/inbox-after.md 2>/dev/null
run adb push $OUT/config-before.edn /sdcard/vault/logseq/config.edn
adb shell input keyevent KEYCODE_BACK; sleep 1

# 14b. start-up with the phone in dark mode (he asked, Oct 30: no dark screen first, then cream):
# shots as fast as the emulator gives them from the moment the app is started; each one's light
log "start-up in dark mode: frames from the start"
run adb shell cmd uimode night yes
adb shell am force-stop "$PKG"; sleep 2
adb shell am start -W -n "$PKG/.MainActivity" >/dev/null 2>&1 # (-W: back once its window shows, so no frame of the home screen is counted)
for k in 1 2 3 4 5 6 7 8; do adb exec-out screencap -p > "$OUT/start-$k.png" 2>/dev/null; done
STARTUP=$(python3 - "$OUT" <<'PY'
import sys, struct, zlib, glob
def mean(path):  # the mean grey of the middle band of a PNG (8-bit RGB/RGBA, no filters beyond PNG's own)
    d = open(path, 'rb').read()
    if d[:8] != b'\x89PNG\r\n\x1a\n': return None
    i, w, h, ct, raw = 8, 0, 0, 0, b''
    while i < len(d):
        n = struct.unpack('>I', d[i:i+4])[0]; tag = d[i+4:i+8]; body = d[i+8:i+8+n]; i += 12 + n
        if tag == b'IHDR': w, h, bd, ct = struct.unpack('>IIBB', body[:10])
        elif tag == b'IDAT': raw += body
    px = {2: 3, 6: 4}.get(ct)
    if not px: return None
    data = zlib.decompress(raw); stride = w * px; prev = bytearray(stride); out = []
    for y in range(h):
        f = data[y*(stride+1)]; line = bytearray(data[y*(stride+1)+1:(y+1)*(stride+1)])
        for x in range(stride):
            a = line[x-px] if x >= px else 0; b = prev[x]; c = prev[x-px] if x >= px else 0
            if f == 1: line[x] = (line[x] + a) & 255
            elif f == 2: line[x] = (line[x] + b) & 255
            elif f == 3: line[x] = (line[x] + (a + b) // 2) & 255
            elif f == 4:
                p = a + b - c; pa, pb, pc = abs(p-a), abs(p-b), abs(p-c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        prev = line
        if h // 3 <= y < 2 * h // 3 and y % 8 == 0:
            out += [sum(line[x:x+3]) / 3 for x in range(0, stride, px * 8)]
    return sum(out) / len(out)
print(' '.join(str(round(mean(f) or 0)) for f in sorted(glob.glob(sys.argv[1] + '/start-*.png'), key=lambda s: int(s.split('-')[-1][:-4]))))
PY
)
log "start-up frames, mean light of the middle (0 dark – 255 white): $STARTUP"
run adb shell cmd uimode night no
sleep 3

log "crashes (none expected):"
run adb logcat -b crash -d
log "the app's own problems log:"
run adb shell "run-as $PKG sh -c 'ls -la cache; cat cache/problems.log'"
kill $LOGCAT 2>/dev/null
log "app processes that ended (from the full log):"
run bash -c "grep -E 'Process $PKG|has died|Killing [0-9]+:$PKG|Force finishing|ANR in|Fatal signal|FATAL|crash detected|wasn.t handled' $OUT/logcat.txt | head -40"

# 15. results, one line each, so a run where something didn't work can't look fine
FAILED=0
result() { if eval "$2" >/dev/null 2>&1; then log "PASS $1"; else log "FAIL $1"; FAILED=1; fi; }
dev() { adb shell "cat '$1'" 2>/dev/null | tr -d '\r'; }
result "the app kept running (never had to be started again)" "! grep -q 'the app was not running' $OUT/log.txt"
result "the app didn't crash" "! adb logcat -b crash -d | grep -q '$PKG'"
# (Android refusing the test's update, step 11, is expected there)
result "nothing in the app's problems log" "! adb shell \"run-as $PKG sh -c 'cat cache/problems.log 2>/dev/null'\" | grep -v 'update (Android)' | grep -q ."
result "choosing the folder opened the notes" "grep -q '\"hash\": \"#/journals\"' $OUT/log.txt"
result "typing on the phone was saved" "dev '/sdcard/vault/Diary/$TODAY.md' | grep -q 'typed on android'"
result "the + button adds a note to today, the keyboard up, and what's typed is saved" "[ '$PLUSKB' = 'mInputShown=true' ] && dev '/sdcard/vault/Diary/$TODAY.md' | grep -q '^- from the plus'"
result "a page with linked references opened" "grep -q '\"title\": \"Sourdough Bread\"' $OUT/log.txt"
result "text shared from another app was added" "{ dev '/sdcard/vault/Diary/$TODAY.md'; dev '/sdcard/vault/pages/quick capture.md'; } | grep -q 'Shared from another app'"
result "a shared picture was saved and linked" "adb shell ls /sdcard/vault/assets | grep -q . && { dev '/sdcard/vault/Diary/$TODAY.md'; dev '/sdcard/vault/pages/quick capture.md'; } | grep -q 'assets/'"
result "the picture shows in the app" "grep -q '\"loaded\": true' $OUT/log.txt"
adb exec-out cat '/sdcard/vault/pages/quick capture.md' > $OUT/quick-capture.md 2>/dev/null
SHARED=$(adb shell ls /sdcard/vault/assets | tr -d '\r' | grep '^shared_.*\.png$')
NSHARED=$(echo "$SHARED" | grep -c .)
SAME=0
for f in $SHARED; do adb exec-out cat "/sdcard/vault/assets/$f" > $OUT/asset.png 2>/dev/null; cmp -s $OUT/asset.png /tmp/shared.png && SAME=$((SAME + 1)); done
log "shared pictures in assets: $NSHARED, the same as the picture: $SAME"
result "a picture shared twice is kept twice, never written over" "[ '$NSHARED' = 2 ] && [ '$SAME' = 2 ]"
result "a file:// address is never opened by the share pop-up" "[ -s $OUT/ui-fileshare.xml ] && ! grep -q 'Add a picture' $OUT/ui-fileshare.xml && [ '$NSHARED' = 2 ]"
result "adding keeps a page's missing last line break" "python3 -c 'import sys; d=open(sys.argv[1],\"rb\").read(); sys.exit(0 if d.startswith(b\"- written before the share\\n- \") and not d.endswith(b\"\\n\") else 1)' $OUT/quick-capture.md"
result "the look list fits the screen" "python3 -c 'import json,sys; d=json.loads(sys.argv[1]); sys.exit(0 if d[\"rows\"] >= 9 and d[\"top\"] >= 0 and d[\"bottom\"] <= d[\"height\"] else 1)' '$LOOKS'"
result "scrolling the journals loads older days" "[ -n '$BEFORE' ] && [ -n '$AFTER' ] && [ '$AFTER' -gt '$BEFORE' ]"
result "Android's back button goes back inside the app" "[ '$BACKHASH' = '\"#/journals\"' ]"
result "Back closes the menu drawer first and stays on the page" "python3 -c 'import json,sys; d=json.loads(sys.argv[1]); sys.exit(0 if d[\"drawer\"] is False and d[\"hash\"].endswith(\"Sourdough Bread\") else 1)' '$DRAWER'"
result "Back at the start leaves the app for the home screen" "[ -n '$TOP' ] && ! echo '$TOP' | grep -q '$PKG'"
result "the app keeps running after leaving" "[ -n '$LEFT' ]"
result "Update now asks for Android's “Install unknown apps” first" "echo \"\$UPD\" | grep -q '\"permission\"' && echo \"\$UNKNOWN\" | grep -q 'com.android.settings'"
if [ -n "$LATEST" ]; then
result "allowed, the newest release downloads and the app refuses it: not signed like this test build" "[ \"\$ST\" = error ] && echo \"\$REFUSED\" | grep -q 'signed like this app'"
result "handed a good download, Android's installer asks to go ahead; cancelled, the app says so" "echo \"\$ASKED\" | grep -qi 'packageinstaller' && echo \"\$CANCELLED\" | grep -q 'cancelled'"
else
  # (only before this repo's first release, Build 34: the app looks for updates here from then on)
  log "SKIPPED the one-click update: no release on this repo yet"
fi
result "the widgets take each look's colours (journal widget: background, title, +, empty line, rows; the one-tap +)" "python3 -c 'import json,sys; d=json.loads(sys.argv[1]); ok=lambda x: (x[\"got\"].get(\"bg\"), x[\"got\"].get(\"title\"), x[\"got\"].get(\"row\"), x[\"got\"].get(\"empty\"), x[\"got\"].get(\"add\"), x[\"got\"].get(\"circle\")) == (x[\"want\"][\"bg\"], x[\"want\"][\"ink\"], x[\"want\"][\"ink\"], x[\"want\"][\"faint\"], x[\"want\"][\"accent\"], x[\"want\"][\"accent\"]); sys.exit(0 if len(d) == 5 and all(map(ok, d)) else 1)' '$WIDGET'"
result "both widgets are offered to the home screen" "adb shell dumpsys appwidget | grep -qi journalwidget && adb shell dumpsys appwidget | grep -qi quickaddwidget"
result "the app sets up its icon shortcuts Today, Add note and Search" "grep -q '{id=today' $OUT/shortcuts.txt && grep -q '{id=add' $OUT/shortcuts.txt && grep -q '{id=search' $OUT/shortcuts.txt"
result "pressing and holding the app icon shows them" "menu_shown"
result "the Today shortcut opens today's journal page (app open)" "[ '$SC_TODAY' = '\"#/page/$TODAY\"' ]"
result "the Search shortcut starts the app with the search box open" "python3 -c 'import json,sys; d=json.loads(sys.argv[1]); sys.exit(0 if d[\"open\"] and d[\"focused\"] else 1)' '$SC_SEARCH'"
result "the keyboard comes up for the search" "[ '$KEYBOARD' = 'mInputShown=true' ]"
result "a leanoutliner://page/… link opens that page in the open app" "[ '$SC_LINK' = '\"#/page/Sourdough Bread\"' ]"
result "the Add note shortcut opens the pop-up" "echo '$SC_ADD' | grep -q QuickCaptureActivity"
result "the pop-up (app closed) adds through the app's code: quick capture page Inbox → a new pages/Inbox (2).md" "dev '/sdcard/vault/pages/Inbox (2).md' | head -1 | grep -qx 'title:: Inbox' && dev '/sdcard/vault/pages/Inbox (2).md' | grep -q '^- .*Inbox check from the phone'"
result "pages/inbox.md (the page Mail, by its title::) is left byte for byte" "cmp -s $OUT/inbox-after.md /tmp/inbox.md"
result "the pop-up says where the note goes, as config.edn says now: to Inbox" "[ '$INBOX_WHERE' = 'text=\"to Inbox\"' ]"
result "the Add note tile is offered in Quick Settings" "echo '$QS' | grep -q AddNoteTile"
result "tapping the tile opens the pop-up and closes the shade" "echo '$TILE_TOP' | grep -q QuickCaptureActivity && echo '$TILE_FOCUS' | grep -q QuickCaptureActivity"
result "starting in dark mode: no dark frame before the app (cream from the first moment)" "python3 -c 'import sys; v=[int(x) for x in sys.argv[1].split()]; sys.exit(0 if len(v) >= 4 and min(v) > 150 else 1)' '$STARTUP'"
gzip -9 $OUT/logcat.txt
log "done: $([ $FAILED = 0 ] && echo 'everything passed' || echo 'SOMETHING FAILED, see the FAIL lines')"
exit $FAILED
