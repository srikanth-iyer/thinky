//! The shell's small decisions, kept apart from Windows and Tauri (only std and outline_core), so
//! their tests run on any computer: `cargo test -p lean-outliner` on Windows, and
//! `src-tauri/pure_tests.sh` (plain rustc, no Tauri) where the shell itself can't be built. The
//! code that talks to Windows (lib.rs, capture_box/, links.rs, update.rs, win.rs) calls these.
#![cfg_attr(not(windows), allow(dead_code))]

use std::io::Read;
use std::path::Path;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

// ----- closing the window (review claim 17a)

/// What a click on a window's × does.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub struct CloseStep {
    /// keep the window open (the page closes it with "quit" once its notes are saved)
    pub prevent: bool,
    /// tell the page to save (`lean-close`) and start the 5 s watchdog: only the first time, so a
    /// second click while it saves neither closes the window mid-save nor starts a second watchdog
    pub ask_page: bool,
}

pub fn close_step(is_main: bool, already_closing: bool) -> CloseStep {
    CloseStep { prevent: is_main, ask_page: is_main && !already_closing }
}

/// Try `f` up to `tries` times, `wait` apart, until it gives something (the clipboard another
/// program holds for a moment; the app's lock while the watchdog waits to save the cache).
pub fn retry<T>(tries: u32, wait: Duration, mut f: impl FnMut() -> Option<T>) -> Option<T> {
    for i in 0..tries {
        if let Some(v) = f() {
            return Some(v);
        }
        if i + 1 < tries {
            std::thread::sleep(wait);
        }
    }
    None
}

// ----- the capture box (capture_box/mod.rs)

fn px(scale: f32, v: f32) -> i32 {
    (v * scale).round() as i32
}

/// Where the bottom strip's message goes: from `left` (after the icon), `avail` wide before the key
/// hints, and the width a problem wraps at. One place for both measuring its height (relayout) and
/// drawing it (draw), so the two always wrap alike. The × button's left edge is worked out as
/// outline_core::capture_box::layout does (tested against it).
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub struct FootMessage {
    pub left: i32,
    pub avail: i32,
    pub wrap_w: i32,
}

pub fn foot_message(scale: f32, keys_w: i32) -> FootMessage {
    let p = |v| px(scale, v);
    let close_l = p(640.0) - p(8.0) - p(26.0);
    let keys_l = close_l - p(14.0) - keys_w;
    let left = p(38.0);
    let avail = keys_l - p(14.0) - left;
    FootMessage { left, avail, wrap_w: avail.max(p(120.0)) }
}

/// Where the box opens (its inside's top left) on a screen whose work area (the screen less the
/// taskbar: MONITORINFO.rcWork) is `work` = (left, top, right, bottom): centred across, a quarter of
/// the way down, and never past the work area's edges (so never behind the taskbar).
pub fn box_origin(work: (i32, i32, i32, i32), w: i32, h: i32) -> (i32, i32) {
    let (l, t, r, b) = work;
    let x = (l + (r - l - w) / 2).min(r - w).max(l);
    let y = (t + (b - t) / 4).min(b - h).max(t);
    (x, y)
}

/// One step of the mouse wheel's scrolling in the page list: Windows sends 120 per notch (three
/// rows), a touchpad many small amounts; they add up in `acc` until a row's worth (40), so slow
/// touchpad scrolling moves too. Turning back starts afresh. Gives the rows to move (down > 0).
pub fn wheel_rows(acc: &mut i32, delta: i32) -> i32 {
    if (*acc > 0 && delta < 0) || (*acc < 0 && delta > 0) {
        *acc = 0;
    }
    *acc = acc.saturating_add(delta);
    let notches = *acc / 40;
    *acc -= notches * 40;
    -notches
}

/// CoInitializeEx's answer: S_OK and S_FALSE both need a CoUninitialize to match; an error (such as
/// RPC_E_CHANGED_MODE, the thread already set up another way) does not.
pub fn com_started(hr: i32) -> bool {
    hr >= 0
}

// ----- links handed over by another copy (links.rs)

/// A link another copy of the program sent (WM_COPYDATA): only a page or note link, in plain
/// UTF-8, not too long. Anything else is dropped without bringing the window forward.
pub fn handed_link(bytes: &[u8]) -> Option<String> {
    use outline_core::link::{parse, Link};
    if bytes.is_empty() || bytes.len() > 64 * 1024 {
        return None;
    }
    let s = std::str::from_utf8(bytes).ok()?;
    match parse(s)? {
        Link::Page { .. } | Link::Note { .. } | Link::App => Some(s.to_string()),
        Link::Capture { .. } => None,
    }
}

/// Are these two Windows paths the same program? (Windows names files without regard to case; a
/// `\\?\` start and `/` for `\` change nothing.)
pub fn same_program(a: &str, b: &str) -> bool {
    let norm = |s: &str| {
        let s = s.trim();
        let s = s.strip_prefix(r"\\?\").unwrap_or(s);
        s.replace('/', "\\").trim_end_matches('\\').to_lowercase()
    };
    let (a, b) = (norm(a), norm(b));
    !a.is_empty() && a == b
}

// ----- files the shell reads (update.rs, the vault:// pictures in lib.rs)

/// The update's signature file is a few hundred bytes: never more than this is downloaded or read.
pub const SIG_MAX: u64 = 64 * 1024;
/// The installer's own limit (curl's --max-filesize).
pub const SETUP_MAX: u64 = 300_000_000;
/// A picture, PDF or video served from the notes folder is read whole: none bigger than this.
pub const ASSET_MAX: u64 = 100 * 1024 * 1024;

/// The most a download of `file` may be.
pub fn max_download(file: &str) -> u64 {
    if file.to_ascii_lowercase().ends_with(".sig") {
        SIG_MAX
    } else {
        SETUP_MAX
    }
}

/// A file's attributes (Windows' FILE_ATTRIBUTE_*) say a plain file: not a folder and not a link
/// or other reparse point, which could lead somewhere else.
pub fn plain_file_attrs(attrs: u32) -> bool {
    const DIRECTORY: u32 = 0x10;
    const REPARSE_POINT: u32 = 0x400;
    attrs & (DIRECTORY | REPARSE_POINT) == 0
}

/// A file's bytes, when it is at most `max` long: its size is checked before anything is read, and
/// no more than `max` bytes are ever read (it may grow meanwhile).
pub fn read_capped(path: &Path, max: u64) -> Result<Vec<u8>, String> {
    let f = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let len = f.metadata().map_err(|e| e.to_string())?.len();
    if len > max {
        return Err(format!("it is too big ({len} bytes; at most {max})"));
    }
    let mut out = Vec::with_capacity(len as usize);
    f.take(max + 1).read_to_end(&mut out).map_err(|e| e.to_string())?;
    if out.len() as u64 > max {
        return Err(format!("it is too big (over {max} bytes)"));
    }
    Ok(out)
}

/// A few threads that take jobs in turn (the vault:// pictures: a page with a hundred pictures asks
/// for them at once, and each would otherwise get a thread of its own). A job that panics doesn't
/// stop its thread.
pub struct Pool {
    tx: mpsc::Sender<Box<dyn FnOnce() + Send>>,
}

impl Pool {
    pub fn new(threads: usize) -> Pool {
        let (tx, rx) = mpsc::channel::<Box<dyn FnOnce() + Send>>();
        let rx = Arc::new(Mutex::new(rx));
        for _ in 0..threads.max(1) {
            let rx = Arc::clone(&rx);
            std::thread::spawn(move || loop {
                let job = match rx.lock().unwrap_or_else(|p| p.into_inner()).recv() {
                    Ok(j) => j,
                    Err(_) => return,
                };
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(job));
            });
        }
        Pool { tx }
    }

    pub fn run(&self, job: impl FnOnce() + Send + 'static) {
        let _ = self.tx.send(Box::new(job));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn the_main_window_always_stays_open_and_the_page_is_asked_once() {
        // first click: kept open, the page asked to save, the watchdog started
        assert_eq!(close_step(true, false), CloseStep { prevent: true, ask_page: true });
        // second click while it saves (review 17a): still kept open, nothing started again
        assert_eq!(close_step(true, true), CloseStep { prevent: true, ask_page: false });
        // other windows close as usual
        assert_eq!(close_step(false, false), CloseStep { prevent: false, ask_page: false });
        assert_eq!(close_step(false, true), CloseStep { prevent: false, ask_page: false });
    }

    #[test]
    fn retry_stops_at_the_first_answer_and_gives_up_after_its_tries() {
        let mut n = 0;
        assert_eq!(retry(10, Duration::from_millis(1), || { n += 1; (n == 3).then_some(n) }), Some(3));
        assert_eq!(n, 3);
        let mut n = 0;
        assert_eq!(retry(4, Duration::from_millis(1), || { n += 1; None::<()> }), None);
        assert_eq!(n, 4);
        let mut n = 0;
        assert_eq!(retry(0, Duration::from_millis(1), || { n += 1; Some(()) }), None);
        assert_eq!(n, 0);
        // the first try that works: no wait at all
        let t = std::time::Instant::now();
        assert_eq!(retry(5, Duration::from_secs(5), || Some(1)), Some(1));
        assert!(t.elapsed() < Duration::from_secs(1));
    }

    fn metrics(scale: f32, foot_h: i32) -> outline_core::capture_box::Metrics {
        outline_core::capture_box::Metrics { scale, line_h: 20, lines: 1, pill_w: 0, rows: 0, list_line_h: 18, foot_h, tool_w: [40, 30, 50] }
    }

    #[test]
    fn the_footer_message_is_measured_and_drawn_in_one_rectangle() {
        for scale in [1.0f32, 1.25, 1.5, 1.75, 2.0, 2.25, 2.5, 3.0] {
            for keys_w in [0, 120, 260, 400] {
                let m = foot_message(scale, keys_w);
                let lay = outline_core::capture_box::layout(&metrics(scale, 20));
                let p = |v| px(scale, v);
                // draw: the key hints start 14 px left of the × button, the message ends 14 px before them
                assert_eq!(m.left + m.avail + p(14.0), lay.close.l - p(14.0) - keys_w, "scale {scale}, keys {keys_w}");
                assert_eq!(m.left, p(38.0));
                assert_eq!(m.wrap_w, m.avail.max(p(120.0)));
                // the × button doesn't move with a taller footer (relayout measures before the layout)
                assert_eq!(lay.close.l, outline_core::capture_box::layout(&metrics(scale, 90)).close.l);
            }
        }
        // the review's 20 px: relayout once wrapped 20 px wider than draw drew (18 for 38)
        let m = foot_message(1.0, 200);
        assert_eq!(m.avail, 640 - 8 - 26 - 14 - 200 - 14 - 38);
        // so many keys there's no room: a problem still wraps at a readable width
        let m = foot_message(1.0, 600);
        assert!(m.avail < 120);
        assert_eq!(m.wrap_w, 120);
    }

    #[test]
    fn the_box_opens_in_the_work_area_not_behind_the_taskbar() {
        // 1920×1080 with a 48 px taskbar at the bottom
        let work = (0, 0, 1920, 1032);
        assert_eq!(box_origin(work, 640, 98), ((1920 - 640) / 2, 1032 / 4));
        // a tall box (the page list open, a long note) on a short screen: pulled up above the taskbar
        let (_, y) = box_origin((0, 0, 1366, 720), 640, 600);
        assert_eq!(y, 120);
        assert!(y + 600 <= 720);
        // a taskbar on the left or top: the work area starts after it
        assert_eq!(box_origin((60, 0, 1920, 1080), 640, 98).0, 60 + (1860 - 640) / 2);
        assert_eq!(box_origin((0, 40, 1920, 1080), 640, 98).1, 40 + 1040 / 4);
        // a second screen left of the first (negative coordinates)
        let (x, y) = box_origin((-1920, 0, 0, 1040), 640, 98);
        assert!((-1920..=-640).contains(&x));
        assert_eq!(y, 260);
        // bigger than the work area: its top left stays on the screen
        assert_eq!(box_origin((0, 0, 500, 400), 640, 600), (0, 0));
    }

    #[test]
    fn small_touchpad_scrolls_add_up_to_rows() {
        let mut acc = 0;
        // a mouse notch: three rows, as before
        assert_eq!(wheel_rows(&mut acc, -120), 3);
        assert_eq!(acc, 0);
        assert_eq!(wheel_rows(&mut acc, 120), -3);
        // a touchpad's small amounts (the review: under 40 each moved nothing at all)
        let mut acc = 0;
        let moved: i32 = (0..10).map(|_| wheel_rows(&mut acc, -12)).sum();
        assert_eq!(moved, 3); // 120 in all
        assert_eq!(acc, 0);
        let mut acc = 0;
        assert_eq!(wheel_rows(&mut acc, -30), 0);
        assert_eq!(wheel_rows(&mut acc, -30), 1);
        assert_eq!(acc, -20);
        // turning back starts afresh: the leftover doesn't eat the other way's first move
        assert_eq!(wheel_rows(&mut acc, 40), -1);
        assert_eq!(acc, 0);
        // huge values never overflow
        let mut acc = i32::MAX - 10;
        let _ = wheel_rows(&mut acc, i32::MAX);
        assert!(acc.abs() < 40);
        let mut acc = 0;
        assert_eq!(wheel_rows(&mut acc, 0), 0);
    }

    #[test]
    fn com_is_put_back_only_when_this_call_set_it_up() {
        assert!(com_started(0)); // S_OK
        assert!(com_started(1)); // S_FALSE (already set up the same way: still counted)
        assert!(!com_started(0x8001_0106u32 as i32)); // RPC_E_CHANGED_MODE
        assert!(!com_started(0x8007_000Eu32 as i32)); // E_OUTOFMEMORY
    }

    #[test]
    fn only_page_and_note_links_are_taken_from_another_copy() {
        assert_eq!(handed_link(b"leanoutliner://page/Groceries").as_deref(), Some("leanoutliner://page/Groceries"));
        assert!(handed_link(b"leanoutliner://note/6650a1b2-0000-4000-8000-000000000001").is_some());
        assert!(handed_link(b"leanoutliner://page/").is_some()); // just opens the app
        // a capture link adds nothing (Build 34), and never brings the window forward
        assert!(handed_link(b"leanoutliner://capture?text=hi&url=https://x.example").is_none());
        // not our link at all, not text, empty, too long
        assert!(handed_link(b"https://example.com/").is_none());
        assert!(handed_link(b"javascript:alert(1)").is_none());
        assert!(handed_link(&[0xff, 0xfe, 0x00]).is_none());
        assert!(handed_link(b"").is_none());
        let mut long = b"leanoutliner://page/".to_vec();
        long.extend(std::iter::repeat_n(b'a', 64 * 1024));
        assert!(handed_link(&long).is_none());
    }

    #[test]
    fn the_running_copy_must_be_this_same_program() {
        let me = r"C:\Users\Sriki\AppData\Local\thinky\lean-outliner.exe";
        assert!(same_program(me, r"c:\users\sriki\appdata\local\THINKY\Lean-Outliner.EXE"));
        assert!(same_program(me, r"\\?\C:\Users\Sriki\AppData\Local\thinky\lean-outliner.exe"));
        assert!(same_program(me, "C:/Users/Sriki/AppData/Local/thinky/lean-outliner.exe"));
        // another program that made a window of the same class
        assert!(!same_program(me, r"C:\Users\Sriki\Downloads\lean-outliner.exe"));
        assert!(!same_program(me, r"C:\Users\Sriki\AppData\Local\thinky\lean-outliner.exe.evil.exe"));
        assert!(!same_program(me, ""));
        assert!(!same_program("", ""));
    }

    #[test]
    fn the_signature_file_has_a_small_limit() {
        assert_eq!(max_download("thinky-update.sig"), SIG_MAX);
        assert_eq!(max_download("LeanOutliner-setup.exe.sig"), SIG_MAX);
        assert_eq!(max_download("THINKY-UPDATE.SIG"), SIG_MAX);
        assert_eq!(max_download("thinky-setup.exe"), SETUP_MAX);
        assert!(SIG_MAX < 1024 * 1024);
    }

    #[test]
    fn links_and_folders_are_not_plain_files() {
        assert!(plain_file_attrs(0x20)); // ARCHIVE
        assert!(plain_file_attrs(0x80)); // NORMAL
        assert!(plain_file_attrs(0x01 | 0x20)); // READONLY
        assert!(!plain_file_attrs(0x400 | 0x20)); // a symbolic link or junction
        assert!(!plain_file_attrs(0x10)); // a folder
        assert!(!plain_file_attrs(0x10 | 0x400));
    }

    fn scratch(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("thinky-shell-rules-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn files_over_the_limit_are_refused_before_they_are_read() {
        let d = scratch("capped");
        let f = d.join("a.sig");
        std::fs::write(&f, b"{\"sig\":\"x\"}").unwrap();
        assert_eq!(read_capped(&f, 64).unwrap(), b"{\"sig\":\"x\"}");
        assert_eq!(read_capped(&f, 11).unwrap().len(), 11); // exactly the limit
        assert!(read_capped(&f, 10).is_err());
        std::fs::write(&f, b"").unwrap();
        assert_eq!(read_capped(&f, 0).unwrap(), b"");
        // a big file (sparse: nothing is written) is refused by its size alone
        let big = d.join("big.png");
        std::fs::File::create(&big).unwrap().set_len(ASSET_MAX + 1).unwrap();
        assert!(read_capped(&big, ASSET_MAX).unwrap_err().contains("too big"));
        assert!(read_capped(&d.join("missing.sig"), 64).is_err());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn the_pool_runs_every_job_on_a_few_threads() {
        let pool = Pool::new(4);
        let (now, most, done) = (Arc::new(AtomicUsize::new(0)), Arc::new(AtomicUsize::new(0)), Arc::new(AtomicUsize::new(0)));
        let (tx, rx) = mpsc::channel();
        for _ in 0..40 {
            let (now, most, done, tx) = (now.clone(), most.clone(), done.clone(), tx.clone());
            pool.run(move || {
                let n = now.fetch_add(1, Ordering::SeqCst) + 1;
                most.fetch_max(n, Ordering::SeqCst);
                std::thread::sleep(Duration::from_millis(3));
                now.fetch_sub(1, Ordering::SeqCst);
                done.fetch_add(1, Ordering::SeqCst);
                let _ = tx.send(());
            });
        }
        for _ in 0..40 {
            rx.recv_timeout(Duration::from_secs(10)).expect("a job never ran");
        }
        assert_eq!(done.load(Ordering::SeqCst), 40);
        assert!(most.load(Ordering::SeqCst) <= 4, "{} at once", most.load(Ordering::SeqCst));
        assert!(most.load(Ordering::SeqCst) >= 1);
    }

    #[test]
    fn a_job_that_panics_doesnt_stop_the_pool() {
        let pool = Pool::new(1);
        pool.run(|| panic!("a bad picture"));
        let (tx, rx) = mpsc::channel();
        pool.run(move || {
            let _ = tx.send(7);
        });
        assert_eq!(rx.recv_timeout(Duration::from_secs(10)), Ok(7));
        // zero threads asked for: still one
        let pool = Pool::new(0);
        let (tx, rx) = mpsc::channel();
        pool.run(move || {
            let _ = tx.send(1);
        });
        assert_eq!(rx.recv_timeout(Duration::from_secs(10)), Ok(1));
    }
}
