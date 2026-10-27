//! A check of the shortcut key's helper on a real Windows: `lean-outliner --hotkey-selftest <folder>`
//! (CI runs it on GitHub's Windows machine). It works only in a fresh folder of its own,
//! <folder>\hotkey-selftest (an earlier run's is replaced; any other folder of that name is left
//! alone and the check doesn't run), with a made-up notes folder and cache there (LOCALAPPDATA
//! points the helper and the boxes it starts at them), its own Start-menu shortcut file there, and
//! a Run entry of its own name (`TEST_RUN_VALUE`, removed at the end). It doesn't run while a helper
//! is running (on a computer you use: it never replaces yours). It presses keys (SendInput), so it's not for a
//! laptop. It writes result.txt there: the ms from a key press to the box on screen, the helper's
//! memory and CPU, NOTE lines, then PASS/FAIL lines. The part with the real Start menu and Explorer
//! (`start_menu`) runs only on GitHub's machine (GITHUB_ACTIONS).

use super::imp::*;
use super::{helper_pids, read_key, write_key, Place, KEY_FILE, STATUS_FILE};
use crate::capture_box::ffi::*;
use outline_core::hotkey as rules;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

/// The file that marks a folder as this check's own (only such a folder is ever replaced).
const MARK: &str = "hotkey-selftest.txt";
/// The check's own Run entry (never the app's).
const TEST_RUN_VALUE: &str = "Lean Outliner shortcut key (self-test)";
/// The check's own shortcut in the real Start menu (GitHub's machine only).
const TEST_LNK: &str = "Lean Outliner hotkey self-test.lnk";
const BOX_CLASS: &str = "LeanOutlinerCaptureBox";
const BOX_TITLE: &str = "Add to journal";
const CONFIG: &str = "{:journal/page-title-format \"MMMM do, yyyy\"}";

struct Log(Vec<String>);

impl Log {
    fn line(&mut self, s: impl Into<String>) {
        self.0.push(s.into());
    }
    fn check(&mut self, ok: bool, what: &str, detail: impl AsRef<str>) {
        if ok {
            self.line(format!("PASS {what}"));
        } else {
            self.line(format!("FAIL {what}: {}", detail.as_ref()));
        }
    }
    fn fails(&self) -> usize {
        self.0.iter().filter(|l| l.starts_with("FAIL")).count()
    }
}

fn sleep(ms: u64) {
    std::thread::sleep(Duration::from_millis(ms));
}

/// Press `key` with its modifiers, as a keyboard would (SendInput).
fn press(key: &str) -> bool {
    let Some((mods, vk)) = rules::parse(key).ok().and_then(|k| vk_of(&k)) else { return false };
    let held: Vec<u16> = [(rules::MOD_CONTROL, VK_CONTROL), (rules::MOD_ALT, VK_MENU), (rules::MOD_SHIFT, VK_SHIFT), (rules::MOD_WIN, VK_LWIN)]
        .into_iter()
        .filter(|(flag, _)| mods & flag != 0)
        .map(|(_, vk)| vk as u16)
        .collect();
    let input = |vk: u16, up: bool| INPUT {
        kind: INPUT_KEYBOARD,
        ki: KEYBDINPUT { vk, scan: unsafe { MapVirtualKeyW(vk as u32, 0) } as u16, flags: if up { KEYEVENTF_KEYUP } else { 0 }, time: 0, extra: 0 },
        pad: [0; 8],
    };
    let mut seq: Vec<INPUT> = held.iter().map(|&k| input(k, false)).collect();
    seq.push(input(vk as u16, false));
    seq.push(input(vk as u16, true));
    seq.extend(held.iter().rev().map(|&k| input(k, true)));
    let n = unsafe { SendInput(seq.len() as u32, seq.as_ptr(), std::mem::size_of::<INPUT>() as i32) };
    n as usize == seq.len()
}

/// The boxes on screen now: (window, process id).
fn boxes() -> Vec<(isize, u32)> {
    let (class, title) = (wide(BOX_CLASS), wide(BOX_TITLE));
    let mut out = Vec::new();
    let mut h = 0;
    for _ in 0..16 {
        h = unsafe { FindWindowExW(0, h, class.as_ptr(), title.as_ptr()) };
        if h == 0 {
            break;
        }
        if unsafe { IsWindowVisible(h) } != 0 {
            let mut pid = 0;
            unsafe { GetWindowThreadProcessId(h, &mut pid) };
            out.push((h, pid));
        }
    }
    out
}

/// Press `key`: how many ms until a box is on screen (None: not within `limit` ms).
fn box_after(key: &str, limit: u64) -> Option<u64> {
    let t = Instant::now();
    if !press(key) {
        return None;
    }
    while t.elapsed() < Duration::from_millis(limit) {
        if !boxes().is_empty() {
            return Some(t.elapsed().as_millis() as u64);
        }
        sleep(5);
    }
    None
}

/// Close the boxes (as Alt+F4 does) and wait until their programs have ended.
fn close_boxes() -> bool {
    let list = boxes();
    let procs: Vec<isize> = list.iter().map(|&(_, pid)| unsafe { OpenProcess(SYNCHRONIZE, 0, pid) }).collect();
    for &(h, _) in &list {
        unsafe { PostMessageW(h, WM_CLOSE, 0, 0) };
    }
    let mut ok = true;
    for p in procs {
        if p == 0 || unsafe { WaitForSingleObject(p, 5000) } != WAIT_OBJECT_0 {
            ok = false;
        }
        close(p);
    }
    ok && boxes().is_empty()
}

/// Press `key`, see the box open within a second (noted as `name`=ms), close it.
fn key_opens(log: &mut Log, key: &str, name: &str) {
    match box_after(key, 3000) {
        Some(ms) => {
            if !name.is_empty() {
                log.line(format!("{name}={ms}"));
            }
            log.check(ms <= 1000, &format!("{key} opens the box within a second"), format!("{ms} ms"));
        }
        None => log.check(false, &format!("{key} opens the box"), "no box within 3 s"),
    }
    log.check(close_boxes(), "…and it closes again", "still open");
}

/// A program's memory in KB (in RAM now, its own) and the names of the libraries it has loaded.
fn memory(pid: u32) -> Option<(usize, usize, Vec<String>)> {
    unsafe {
        let p = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, 0, pid);
        if p == 0 {
            return None;
        }
        let cb = std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
        let mut c = PROCESS_MEMORY_COUNTERS { cb, ..Default::default() };
        let ok = K32GetProcessMemoryInfo(p, &mut c, cb) != 0;
        let mut mods = vec![0isize; 512];
        let mut needed = 0u32;
        let mut names = Vec::new();
        if K32EnumProcessModules(p, mods.as_mut_ptr(), (mods.len() * std::mem::size_of::<isize>()) as u32, &mut needed) != 0 {
            let n = (needed as usize / std::mem::size_of::<isize>()).min(mods.len());
            for &m in &mods[..n] {
                let mut buf = [0u16; 260];
                let len = K32GetModuleBaseNameW(p, m, buf.as_mut_ptr(), 260) as usize;
                names.push(String::from_utf16_lossy(&buf[..len.min(260)]));
            }
        }
        close(p);
        ok.then_some((c.working_set / 1024, c.pagefile_usage / 1024, names))
    }
}

/// A program's CPU time so far, in ms.
fn cpu_ms(pid: u32) -> Option<u64> {
    unsafe {
        let p = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if p == 0 {
            return None;
        }
        let (mut a, mut b, mut kernel, mut user) = (FILETIME::default(), FILETIME::default(), FILETIME::default(), FILETIME::default());
        let ok = GetProcessTimes(p, &mut a, &mut b, &mut kernel, &mut user) != 0;
        close(p);
        ok.then(|| (kernel.ticks() + user.ticks()) / 10_000)
    }
}

/// The helper's memory (and the libraries it loaded: no web engine), as `name`_ws_kb / _private_kb.
fn mem(log: &mut Log, pid: u32, name: &str, libraries: bool) {
    let Some((ws, private, mods)) = memory(pid) else {
        log.line(format!("NOTE {name}: its memory couldn't be read"));
        return;
    };
    log.line(format!("{name}_ws_kb={ws}"));
    log.line(format!("{name}_private_kb={private}"));
    if libraries {
        log.line(format!("NOTE the helper's libraries ({}): {}", mods.len(), mods.join(", ")));
        let web: Vec<String> = mods.iter().filter(|m| m.to_lowercase().contains("webview")).cloned().collect();
        log.check(!mods.is_empty() && web.is_empty(), "The helper doesn't load the web engine", web.join(", "));
    }
}

/// Is `key` free (no program holds it)? Taken and let go at once.
fn free(key: &str) -> bool {
    let Some((m, v)) = rules::parse(key).ok().and_then(|k| vk_of(&k)) else { return false };
    unsafe {
        if RegisterHotKey(0, 90, m, v) != 0 {
            UnregisterHotKey(0, 90);
            true
        } else {
            false
        }
    }
}

/// A Windows shortcut file's fixed header with key `hotkey` (all the helper reads of one).
fn fake_lnk(hotkey: u16) -> Vec<u8> {
    let mut b = vec![0u8; 0x4C];
    b[0] = 0x4C;
    b[4..20].copy_from_slice(&[0x01, 0x14, 0x02, 0x00, 0, 0, 0, 0, 0xC0, 0, 0, 0, 0, 0, 0, 0x46]);
    b[0x40..0x42].copy_from_slice(&hotkey.to_le_bytes());
    b
}

/// Every file under `dir`, relative, with `/`.
fn files_in(dir: &Path) -> Vec<String> {
    let mut out = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        for e in std::fs::read_dir(&d).into_iter().flatten().flatten() {
            let p = e.path();
            if p.is_dir() {
                stack.push(p);
            } else if let Ok(r) = p.strip_prefix(dir) {
                out.push(r.to_string_lossy().replace('\\', "/"));
            }
        }
    }
    out.sort();
    out
}

/// Make `dir` a new, empty folder of this check's own. One left by an earlier run (it has the
/// mark) is replaced; any other folder of that name is left alone, and the check doesn't run.
fn fresh(dir: &Path) -> Result<(), String> {
    if !dir.parent().is_some_and(Path::is_dir) {
        return Err(format!("{} isn't there", dir.parent().unwrap_or(dir).display()));
    }
    if std::fs::symlink_metadata(dir).is_ok() {
        if !dir.join(MARK).is_file() || std::fs::symlink_metadata(dir).is_ok_and(|m| !m.is_dir()) {
            return Err(format!("{} is there and isn't this check's own folder", dir.display()));
        }
        std::fs::remove_dir_all(dir).map_err(|e| format!("couldn't clear {}: {e}", dir.display()))?;
    }
    std::fs::create_dir(dir).map_err(|e| format!("couldn't make {}: {e}", dir.display()))?;
    std::fs::write(dir.join(MARK), "The shortcut key check's own folder (lean-outliner --hotkey-selftest).\n").map_err(|e| e.to_string())
}

fn test_lnk() -> Option<PathBuf> {
    Some(crate::win::capture_shortcut_path()?.parent()?.join(TEST_LNK))
}

/// Run the checks in `<base>\hotkey-selftest`; returns how many failed (the program's exit code),
/// or 100 when that folder couldn't be made fresh (nothing was started or written).
pub fn selftest(base: &Path) -> i32 {
    let dir = base.join("hotkey-selftest");
    if fresh(&dir).is_err() {
        return 100;
    }
    let mut log = Log(Vec::new());
    let before = !helpers().is_empty();
    if before {
        log.check(false, "No shortcut-key helper runs here yet", "one does, and this check never replaces it");
    } else if std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| run(&mut log, &dir))).is_err() {
        log.line("FAIL The check crashed");
    }
    // tidy up: the check's own helpers (never one that ran before it), boxes, Run entry, shortcut
    if !before {
        close_and_wait(&helpers());
    }
    close_boxes();
    run_remove(TEST_RUN_VALUE);
    if let Some(l) = test_lnk().filter(|l| l.exists()) {
        let _ = std::fs::remove_file(l);
    }
    let fails = log.fails();
    let _ = std::fs::write(dir.join("result.txt"), log.0.join("\n") + "\n");
    fails as i32
}

fn run(log: &mut Log, dir: &Path) {
    let appdata = dir.join("appdata");
    let cache = appdata.join("com.srikanth.leanoutliner");
    let notes = dir.join("notes");
    for d in [&cache, &notes.join("pages"), &notes.join("journals"), &notes.join("logseq"), &dir.join("start-menu")] {
        let _ = std::fs::create_dir_all(d);
    }
    let _ = std::fs::write(notes.join("logseq/config.edn"), CONFIG);
    let _ = std::fs::write(cache.join("last-vault.txt"), notes.display().to_string());
    // the helper and the boxes it starts find their cache folder through LOCALAPPDATA (main.rs)
    std::env::set_var("LOCALAPPDATA", &appdata);
    outline_core::app::set_cache_dir(cache.clone());
    if outline_core::app::cache_dir().as_deref() != Some(cache.as_path()) {
        log.check(false, "The check's own cache folder is used", "it couldn't be, so nothing was started");
        return;
    }
    let place = Place { cache: cache.clone(), lnk: Some(dir.join("start-menu").join("Lean Outliner capture.lnk")), run_value: TEST_RUN_VALUE.into() };

    // 1. a key is saved: the helper starts and takes it
    let k1 = "Ctrl+Alt+Shift+F7";
    let t = Instant::now();
    let r = turn_on(&place, "CTRL+ALT+SHIFT+F7");
    log.line(format!("on_ms={}", t.elapsed().as_millis()));
    let hs = helpers();
    log.check(r.as_deref() == Ok(k1), "Saving a key starts the helper, which takes the key", format!("{r:?}"));
    log.check(hs.len() == 1 && held_key(hs[0].0) == k1, "One helper runs, with that key", format!("{hs:?}"));
    log.check(read_key(&cache).as_deref() == Some(k1), "The key is kept in hotkey.txt, in one spelling", format!("{:?}", read_key(&cache)));
    log.check(run_command().is_some() && run_get(TEST_RUN_VALUE) == run_command(), "It's set to start with Windows (a Run entry, the check's own)", format!("{:?}", run_get(TEST_RUN_VALUE)));
    log.check(crate::update::other_copies() == Ok(0), "An update doesn't count it as another open copy", format!("{:?}", crate::update::other_copies()));
    let Some(&(_, pid1)) = hs.first() else { return };
    sleep(500);
    mem(log, pid1, "helper", true);
    let c0 = cpu_ms(pid1);
    sleep(2000);
    let c1 = cpu_ms(pid1);
    log.check(matches!((c0, c1), (Some(a), Some(b)) if b.saturating_sub(a) <= 16), "Waiting for the key, it uses no CPU", format!("{c0:?} → {c1:?} ms"));

    // 2. the key opens the box (a program of its own)
    key_opens(log, k1, "box_ms");
    sleep(300);
    mem(log, pid1, "helper_after_box", false);

    // 3. another key: a new helper takes over and the old one quits
    let old = unsafe { OpenProcess(SYNCHRONIZE, 0, pid1) };
    let k2 = "Ctrl+Alt+Shift+K";
    let r = turn_on(&place, k2);
    let gone = old != 0 && unsafe { WaitForSingleObject(old, 3000) } == WAIT_OBJECT_0;
    close(old);
    let hs = helpers();
    log.check(r.as_deref() == Ok(k2) && gone && hs.len() == 1 && held_key(hs[0].0) == k2, "Another key: a new helper takes over, the old one quits", format!("{r:?}, old gone: {gone}, {hs:?}"));
    key_opens(log, k2, "box2_ms");
    log.check(box_after(k1, 1000).is_none(), "The old key doesn't open it any more", "it does");
    close_boxes();
    let pid2 = hs.first().map_or(0, |h| h.1);

    // 4. a key another program has
    taken(log, &place, pid2, k2);

    // 5. the first start after this update: an older Start-menu shortcut's key moves to the helper
    moved(log, &place);

    // 6. the same with Windows' real Start menu, where Explorer holds the shortcut's key
    if std::env::var("GITHUB_ACTIONS").as_deref() == Ok("true") {
        start_menu(log, &place, dir);
    } else {
        log.line("NOTE the real Start menu part runs only on GitHub's machine");
    }

    // 7. Remove: the helper stops, nothing starts with Windows, the key does nothing
    let last = helpers();
    let key = last.first().map(|h| held_key(h.0)).unwrap_or_default();
    let procs: Vec<isize> = last.iter().map(|&(_, pid)| unsafe { OpenProcess(SYNCHRONIZE, 0, pid) }).collect();
    let r = turn_off(&place);
    let gone = procs.iter().all(|&p| p != 0 && unsafe { WaitForSingleObject(p, 3000) } == WAIT_OBJECT_0);
    procs.into_iter().for_each(close);
    log.check(r.is_ok() && gone && helpers().is_empty(), "Removing the key stops the helper", format!("{r:?}, gone: {gone}"));
    log.check(run_get(TEST_RUN_VALUE).is_none(), "…and it no longer starts with Windows", format!("{:?}", run_get(TEST_RUN_VALUE)));
    log.check(read_key(&cache).as_deref() == Some(""), "…and hotkey.txt says it's off", format!("{:?}", read_key(&cache)));
    log.check(!key.is_empty() && box_after(&key, 1000).is_none(), "…and the key does nothing", format!("{key:?}"));
    close_boxes();
    let files = files_in(&notes);
    log.check(files == ["logseq/config.edn"], "Nothing was written in the notes folder", files.join(", "));
}

/// A key another program has (this check holds it): refused with why; what was there stays.
fn taken(log: &mut Log, place: &Place, pid2: u32, k2: &str) {
    let k3 = "Ctrl+Alt+Shift+F8";
    let Some((m, v)) = rules::parse(k3).ok().and_then(|k| vk_of(&k)) else { return };
    if unsafe { RegisterHotKey(0, 77, m, v) } == 0 {
        log.line(format!("NOTE {k3} was taken already: its checks were skipped"));
        return;
    }
    let r = turn_on(place, k3);
    let hs = helpers();
    log.check(r.as_ref().is_err_and(|e| e.contains("Another program already uses Ctrl+Alt+Shift+F8")), "A key another program has is refused, saying why", format!("{r:?}"));
    log.check(hs.len() == 1 && hs[0].1 == pid2 && held_key(hs[0].0) == k2, "…and the helper keeps the key it had", format!("{hs:?}"));
    log.check(read_key(&place.cache).as_deref() == Some(k2), "…and so does hotkey.txt", format!("{:?}", read_key(&place.cache)));
    let problems = std::fs::read_to_string(place.cache.join("problems.log")).unwrap_or_default();
    log.check(problems.contains("Ctrl+Alt+Shift+F8 can’t be used"), "…and the problems log says so", &problems);
    // the first start after the update, when another program has the old shortcut's key: the
    // shortcut stays, key and all (it's what still works)
    if let Some(lnk) = &place.lnk {
        let bytes = fake_lnk(0x0700 | 0x77);
        let _ = std::fs::write(lnk, &bytes);
        let _ = std::fs::remove_file(place.cache.join(KEY_FILE));
        let r = ensure(place);
        log.check(
            r.is_err() && std::fs::read(lnk).ok().as_deref() == Some(&bytes[..]) && read_key(&place.cache).is_none(),
            "An older shortcut whose key the helper can't have stays, key and all",
            format!("{r:?}, {:?}", read_key(&place.cache)),
        );
        log.check(helpers().iter().any(|h| h.1 == pid2), "…and the running helper is left alone", format!("{:?}", helpers()));
        let st = status(place, true);
        log.check(st["fallback"] == true && st["running"] == false && st["key"] == k3, "Settings: the key still works the old, slow way for now", st.to_string());
        let _ = std::fs::remove_file(lnk);
    }
    // a helper still starting (here: still trying for the key this check holds) is known as one:
    // an update doesn't count it as another open copy, Settings says it's starting, and asked to
    // quit, it does at once
    let _ = write_key(&place.cache, k3);
    match start_self("--hotkey", false) {
        Ok(p) => {
            sleep(600);
            let others = crate::update::other_copies();
            log.check(helper_pids().contains(&p.pid) && others == Ok(0), "A helper still starting is known as one (an update doesn't count it)", format!("{:?}, {others:?}", helper_pids()));
            let st = status(place, true);
            log.check(st["starting"] == true && st["running"] == false, "…and Settings says the key is starting", st.to_string());
            let t = Instant::now();
            let mine: Vec<(isize, u32)> = helpers().into_iter().filter(|h| h.1 == p.pid).collect();
            let gone = !mine.is_empty() && close_and_wait(&mine);
            log.check(gone && t.elapsed() < Duration::from_millis(1000), "…and asked to quit, it does at once", format!("gone: {gone}, {:?}", t.elapsed()));
        }
        Err(e) => log.check(false, "(the check started a helper)", e),
    }
    // the key a helper couldn't take (as when another program took it while Windows started):
    // Settings shows it isn't working, and why
    let st = status(place, true);
    log.check(
        st["running"] == false && st["starting"] == false && st["fallback"] == false && st["why"].as_str().is_some_and(|w| w.contains("Another program already uses Ctrl+Alt+Shift+F8")),
        "Settings: a saved key no helper holds shows as not working, with why",
        st.to_string(),
    );
    unsafe { UnregisterHotKey(0, 77) };
    // Try again, once the other program has let go of it
    let r = turn_on(place, k3);
    let st = status(place, true);
    log.check(r.as_deref() == Ok(k3) && st["running"] == true && st["why"] == "" && !place.cache.join(STATUS_FILE).exists(), "Try again then works, and Settings shows it working", format!("{r:?}, {st}"));
}

/// The first start after this update: the older shortcut's key moves to the helper, the shortcut goes.
fn moved(log: &mut Log, place: &Place) {
    let Some(lnk) = &place.lnk else { return };
    let k = "Ctrl+Alt+Shift+J";
    let _ = std::fs::write(lnk, fake_lnk(0x0700 | 0x4A));
    let _ = std::fs::remove_file(place.cache.join(KEY_FILE));
    let r = ensure(place);
    let hs = helpers();
    log.check(r.is_ok() && hs.len() == 1 && held_key(hs[0].0) == k && read_key(&place.cache).as_deref() == Some(k), "First start after the update: an older shortcut's key moves to the helper", format!("{r:?}, {hs:?}"));
    log.check(!lnk.exists(), "…and the shortcut is removed", "it's still there");
    log.check(run_get(TEST_RUN_VALUE) == run_command(), "…and the helper starts with Windows", format!("{:?}", run_get(TEST_RUN_VALUE)));
    key_opens(log, k, "");
    // the next start: nothing to do
    let pid = hs.first().map(|h| h.1);
    let r = ensure(place);
    log.check(r.is_ok() && helpers().first().map(|h| h.1) == pid, "The next start leaves the running helper alone", format!("{r:?}"));
}

/// The real Start menu (GitHub's machine only): a shortcut with a key, which Explorer takes; its
/// key moves to the helper, the shortcut goes, and Windows' own (slow) way doesn't fire as well.
fn start_menu(log: &mut Log, place: &Place, dir: &Path) {
    let explorer = std::process::Command::new("tasklist")
        .args(["/FI", "IMAGENAME eq explorer.exe", "/NH"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_lowercase().contains("explorer.exe"))
        .unwrap_or(false);
    log.line(format!("NOTE explorer.exe running: {explorer}"));
    let Some(lnk) = test_lnk() else {
        log.line("NOTE no Start menu here: skipped");
        return;
    };
    let key = "Ctrl+Alt+Shift+F9";
    let fired = dir.join("explorer-fired.txt");
    let cmd = std::env::var_os("ComSpec").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\Windows\System32\cmd.exe"));
    let made = crate::win::make_shortcut(&lnk, &cmd, &format!("/c type nul > \"{}\"", fired.display()), "CTRL+ALT+SHIFT+F9", "Lean Outliner self-test");
    let read = rules::lnk_key(&std::fs::read(&lnk).unwrap_or_default());
    log.check(made.is_ok() && read.as_deref() == Some(key), "A real shortcut's key is read from its file", format!("{made:?}, {read:?}"));
    if made.is_err() {
        return;
    }
    sleep(3000); // Explorer takes the shortcut's key
    log.line(format!("NOTE Explorer held the shortcut's key: {}", !free(key)));
    // the first start after the update: no hotkey.txt yet
    let _ = std::fs::remove_file(place.cache.join(KEY_FILE));
    let p = Place { cache: place.cache.clone(), lnk: Some(lnk.clone()), run_value: place.run_value.clone() };
    let t = Instant::now();
    let r = ensure(&p);
    log.line(format!("start_menu_move_ms={}", t.elapsed().as_millis()));
    let hs = helpers();
    log.check(r.is_ok() && hs.len() == 1 && held_key(hs[0].0) == key, "A Start-menu shortcut's key moves to the helper, from Explorer", format!("{r:?}, {hs:?}"));
    log.check(!lnk.exists(), "…and the shortcut is removed from the Start menu", "it's still there");
    key_opens(log, key, "start_menu_box_ms");
    sleep(4000); // Windows' own way took ~3 s
    log.check(!fired.exists(), "Windows' own (slow) way doesn't open anything as well", "the shortcut's program ran");
}
