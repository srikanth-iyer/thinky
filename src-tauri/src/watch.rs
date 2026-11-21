//! Notice changed note files right away (Drive sync, the widget, Claude), instead of
//! checking on a timer. One watching thread per open vault (Windows: one per folder); the app still
//! re-checks when it comes back to the front, in case a notification is missed (e.g. on a cloud drive).
//!
//! A watch ends by itself within about a second once a newer one has started (`GEN`): it waits for
//! changes at most WAKE_MS at a time and then looks whether it is still the current one, so opening
//! another vault or reloading the settings never leaves the old thread and its inotify descriptor or
//! folder handle behind (the outside review's claim 13: a blocking read never woke up, and each switch
//! kept one more). An interrupted wait is simply started again, a folder made or moved in later is
//! watched too (inotify isn't recursive), and on Windows a folder that can't be read is opened again
//! after a pause instead of being given up.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;

static GEN: AtomicUsize = AtomicUsize::new(0);

/// How long one wait for changes lasts before a watch looks whether it is still the current one.
const WAKE_MS: u32 = 1000;

/// Watch `root` (its pages and journals) and call `changed` (at most every 400 ms) when a
/// `.md` file appears, changes, moves or goes, or `config` (the `logseq` folder, only its own files,
/// not bak/ or the bin) gets a changed `config.edn` (Build 49: a sync's change to the settings went
/// unseen while the window stayed in front). Replaces any earlier watch (it stops within WAKE_MS).
pub fn start(root: PathBuf, dirs: Vec<PathBuf>, config: PathBuf, changed: impl Fn() + Send + Sync + 'static) {
    let gen = GEN.fetch_add(1, Ordering::SeqCst) + 1;
    let pending = Arc::new(AtomicBool::new(false));
    let changed = Arc::new(changed);
    let signal = move || {
        if GEN.load(Ordering::SeqCst) != gen || pending.swap(true, Ordering::SeqCst) {
            return;
        }
        let pending = pending.clone();
        let changed = changed.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(400));
            pending.store(false, Ordering::SeqCst);
            if GEN.load(Ordering::SeqCst) == gen {
                changed();
            }
        });
    };
    let _ = std::thread::Builder::new().name("watch".into()).spawn(move || platform::run(root, dirs, config, gen, signal));
}

fn current(gen: usize) -> bool {
    GEN.load(Ordering::SeqCst) == gen
}

/// A note file we care about (not our own hidden temp files).
fn interesting(name: &str) -> bool {
    let file = name.rsplit(['/', '\\']).next().unwrap_or(name);
    file.ends_with(".md") && !file.starts_with('.')
}

/// In the `logseq` folder only the settings file counts (bak/, the bin and safety copies are written
/// by the app and by Logseq all the time).
fn is_config(name: &str) -> bool {
    name.eq_ignore_ascii_case("config.edn")
}

/// A folder the watch leaves alone, as Logseq does: ".git", a sync app's ".stfolder", the bin…
#[cfg_attr(not(any(target_os = "linux", target_os = "android")), allow(dead_code))]
fn hidden(name: &str) -> bool {
    name.starts_with('.')
}

/// The file names in what one ReadDirectoryChangesW gave (Windows' FILE_NOTIFY_INFORMATION records:
/// the next record's offset, the action, the name's length in bytes, then the name in UTF-16). A record
/// that runs past the end is cut there; a record whose "next" is 0 is the last.
#[cfg(any(windows, test))]
fn notify_names(bytes: &[u8]) -> Vec<String> {
    let mut out = vec![];
    let mut at = 0usize;
    while at.checked_add(12).is_some_and(|e| e <= bytes.len()) {
        let rd = |o: usize| u32::from_le_bytes([bytes[at + o], bytes[at + o + 1], bytes[at + o + 2], bytes[at + o + 3]]) as usize;
        let (next, len) = (rd(0), rd(8));
        let end = (at + 12).saturating_add(len).min(bytes.len());
        let units: Vec<u16> = bytes[at + 12..end].chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
        out.push(String::from_utf16_lossy(&units));
        match (next, at.checked_add(next)) {
            (0, _) | (_, None) => break,
            (_, Some(a)) => at = a,
        }
    }
    out
}

/// Seconds to wait before opening a folder again after its `tries`-th failure: 1, 2, 4, 8, 16, then 30.
#[cfg(any(windows, test))]
fn backoff(tries: u32) -> u64 {
    (1u64 << tries.saturating_sub(1).min(5)).min(30)
}

#[cfg(windows)]
mod platform {
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;
    use std::path::{Path, PathBuf};

    type Handle = *mut c_void;

    /// Windows' OVERLAPPED (the two offsets are unused for folders).
    #[repr(C)]
    struct Overlapped {
        internal: usize,
        internal_high: usize,
        offset: u32,
        offset_high: u32,
        event: Handle,
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn CreateFileW(name: *const u16, access: u32, share: u32, sa: *const c_void, disp: u32, flags: u32, template: Handle) -> Handle;
        fn ReadDirectoryChangesW(dir: Handle, buf: *mut c_void, len: u32, subtree: i32, filter: u32, ret: *mut u32, ov: *mut Overlapped, done: *const c_void) -> i32;
        fn CreateEventW(sa: *const c_void, manual_reset: i32, initial: i32, name: *const u16) -> Handle;
        fn ResetEvent(h: Handle) -> i32;
        fn WaitForSingleObject(h: Handle, ms: u32) -> u32;
        fn GetOverlappedResult(h: Handle, ov: *mut Overlapped, got: *mut u32, wait: i32) -> i32;
        fn CancelIoEx(h: Handle, ov: *mut Overlapped) -> i32;
        fn GetLastError() -> u32;
        fn CloseHandle(h: Handle) -> i32;
    }
    const FILE_LIST_DIRECTORY: u32 = 1;
    const SHARE_ALL: u32 = 1 | 2 | 4;
    const OPEN_EXISTING: u32 = 3;
    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
    const FILE_FLAG_OVERLAPPED: u32 = 0x4000_0000;
    const WAIT_OBJECT_0: u32 = 0;
    const WAIT_TIMEOUT: u32 = 0x102;
    /// More changes than the buffer holds: look at everything again.
    const ERROR_NOTIFY_ENUM_DIR: u32 = 1022;
    // file name, directory name, size, last write
    const FILTER: u32 = 0x1 | 0x2 | 0x8 | 0x10;

    /// One recursive watch on each folder, and one on the `logseq` folder itself.
    pub fn run(_root: PathBuf, dirs: Vec<PathBuf>, config: PathBuf, gen: usize, signal: impl Fn() + Send + Sync + 'static) {
        let signal = std::sync::Arc::new(signal);
        for dir in dirs {
            let signal = signal.clone();
            std::thread::spawn(move || watch(dir, gen, true, super::interesting, move || signal()));
        }
        // (the logseq folder itself, not what's under it: only config.edn)
        let signal = signal.clone();
        std::thread::spawn(move || watch(config, gen, false, super::is_config, move || signal()));
    }

    /// An open folder and the event its reads finish on; both are closed when it goes.
    struct Folder {
        h: Handle,
        event: Handle,
    }

    impl Folder {
        fn open(dir: &Path) -> Option<Folder> {
            let wide: Vec<u16> = dir.as_os_str().encode_wide().chain(Some(0)).collect();
            let flags = FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OVERLAPPED;
            let h = unsafe { CreateFileW(wide.as_ptr(), FILE_LIST_DIRECTORY, SHARE_ALL, std::ptr::null(), OPEN_EXISTING, flags, std::ptr::null_mut()) };
            if h.is_null() || h as isize == -1 {
                return None;
            }
            let event = unsafe { CreateEventW(std::ptr::null(), 1, 0, std::ptr::null()) };
            if event.is_null() {
                unsafe { CloseHandle(h) };
                return None;
            }
            Some(Folder { h, event })
        }
    }

    impl Drop for Folder {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.event);
                CloseHandle(self.h);
            }
        }
    }

    /// What one read of a folder's changes came to.
    enum Got {
        Bytes(usize),
        TooMany,
        Stale,
        Failed,
    }

    /// Follows `dir` while this is the current watch. When the folder can't be opened or read (gone,
    /// renamed, a network or cloud drive that dropped out), it is opened again after a pause (backoff:
    /// 1 s at first, at most 30 s), and the page is told to look once it is back.
    fn watch(dir: PathBuf, gen: usize, subtree: bool, wanted: fn(&str) -> bool, signal: impl Fn()) {
        let mut tries = 0u32;
        while super::current(gen) {
            if let Some(f) = Folder::open(&dir) {
                if tries > 0 {
                    signal(); // changes made while it was out of reach weren't seen
                }
                let mut worked = false;
                if follow(&f, gen, subtree, wanted, &signal, &mut worked) {
                    return; // a newer watch took over
                }
                if worked {
                    tries = 0;
                }
            }
            tries += 1;
            for _ in 0..super::backoff(tries) {
                if !super::current(gen) {
                    return;
                }
                std::thread::sleep(std::time::Duration::from_secs(1));
            }
        }
    }

    /// Reads `f`'s changes until a newer watch starts (true) or a read fails (false); `worked` is set
    /// once a read succeeded.
    fn follow(f: &Folder, gen: usize, subtree: bool, wanted: fn(&str) -> bool, signal: &impl Fn(), worked: &mut bool) -> bool {
        let mut buf = vec![0u32; 16 * 1024]; // 64 KB, DWORD-aligned as the API needs
        loop {
            if !super::current(gen) {
                return true;
            }
            let mut ov = Overlapped { internal: 0, internal_high: 0, offset: 0, offset_high: 0, event: f.event };
            unsafe { ResetEvent(f.event) };
            let started = unsafe {
                ReadDirectoryChangesW(f.h, buf.as_mut_ptr().cast(), (buf.len() * 4) as u32, subtree as i32, FILTER, std::ptr::null_mut(), &mut ov, std::ptr::null())
            };
            if started == 0 {
                return false;
            }
            match finish(f, &mut ov, gen) {
                Got::Stale => return true,
                Got::Failed => return false,
                Got::TooMany => {
                    *worked = true;
                    signal(); // too many changes to list: just look again
                }
                Got::Bytes(n) => {
                    *worked = true;
                    let bytes = unsafe { std::slice::from_raw_parts(buf.as_ptr() as *const u8, n.min(buf.len() * 4)) };
                    if super::notify_names(bytes).iter().any(|name| wanted(name)) {
                        signal();
                    }
                }
            }
        }
    }

    /// Waits for the read started with `ov`, WAKE_MS at a time, looking in between whether this is
    /// still the current watch. A stale watch cancels the read and waits until Windows has let go of
    /// the buffer before it goes.
    fn finish(f: &Folder, ov: &mut Overlapped, gen: usize) -> Got {
        loop {
            let waited = unsafe { WaitForSingleObject(f.event, super::WAKE_MS) };
            if waited == WAIT_OBJECT_0 {
                let mut n = 0u32;
                if unsafe { GetOverlappedResult(f.h, ov, &mut n, 0) } != 0 {
                    return if n == 0 { Got::TooMany } else { Got::Bytes(n as usize) };
                }
                return if unsafe { GetLastError() } == ERROR_NOTIFY_ENUM_DIR { Got::TooMany } else { Got::Failed };
            }
            if waited == WAIT_TIMEOUT && super::current(gen) {
                continue;
            }
            // stale (or the wait itself failed): stop the read and let it end before the buffer goes
            unsafe {
                CancelIoEx(f.h, ov);
                let mut n = 0u32;
                GetOverlappedResult(f.h, ov, &mut n, 1);
            }
            return if waited == WAIT_TIMEOUT { Got::Stale } else { Got::Failed };
        }
    }
}

#[cfg(any(target_os = "linux", target_os = "android"))]
mod platform {
    use std::collections::HashMap;
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    use std::path::{Path, PathBuf};

    const MASK: u32 = libc::IN_CLOSE_WRITE | libc::IN_MOVED_TO | libc::IN_MOVED_FROM | libc::IN_DELETE | libc::IN_CREATE | libc::IN_DELETE_SELF;
    /// Folders inside the watched ones are followed this deep at most.
    const DEPTH: usize = 32;

    /// One inotify event: the watch it came from, what happened, and the name in that folder.
    #[derive(Debug, PartialEq)]
    pub struct Event {
        pub wd: i32,
        pub mask: u32,
        pub name: String,
    }

    /// The events in what one read of an inotify descriptor gave (struct inotify_event: wd, mask,
    /// cookie, len, then a name of `len` bytes ending in zeros). A record cut short ends the list.
    pub fn parse(buf: &[u8]) -> Vec<Event> {
        let mut out = vec![];
        let mut at = 0usize;
        while at + 16 <= buf.len() {
            let word = |o: usize| [buf[at + o], buf[at + o + 1], buf[at + o + 2], buf[at + o + 3]];
            let len = u32::from_ne_bytes(word(12)) as usize;
            let Some(end) = (at + 16).checked_add(len).filter(|&e| e <= buf.len()) else { break };
            let raw = &buf[at + 16..end];
            let name = String::from_utf8_lossy(&raw[..raw.iter().position(|&b| b == 0).unwrap_or(raw.len())]).into_owned();
            out.push(Event { wd: i32::from_ne_bytes(word(0)), mask: u32::from_ne_bytes(word(4)), name });
            at = end;
        }
        out
    }

    /// What to do after a read of the (non-blocking) descriptor returned `n`, with `errno` when it failed.
    #[derive(Debug, PartialEq)]
    pub enum Next {
        /// `n` bytes of events
        Got(usize),
        /// nothing more for now: wait again
        Drained,
        /// interrupted by a signal: read again (claim 13: this used to end the watch for good)
        Again,
        /// the descriptor is broken: the watch ends
        Stop,
    }

    pub fn after_read(n: isize, errno: i32) -> Next {
        if n > 0 {
            Next::Got(n as usize)
        } else if n == 0 || errno == libc::EAGAIN || errno == libc::EWOULDBLOCK {
            Next::Drained
        } else if errno == libc::EINTR {
            Next::Again
        } else {
            Next::Stop
        }
    }

    fn errno() -> i32 {
        std::io::Error::last_os_error().raw_os_error().unwrap_or(0)
    }

    /// The inotify descriptor and what each of its watches is (closed, with every watch, when it goes).
    pub struct Watches {
        pub fd: i32,
        /// watch → folder, for the note folders and every folder inside them
        pub paths: HashMap<i32, PathBuf>,
        tops: Vec<PathBuf>,
        config: PathBuf,
        /// the `logseq` folder's own watch (not in `paths`: only config.edn counts there), -1 when none
        pub config_wd: i32,
    }

    impl Drop for Watches {
        fn drop(&mut self) {
            unsafe { libc::close(self.fd) };
        }
    }

    impl Watches {
        pub fn new(dirs: Vec<PathBuf>, config: PathBuf) -> Option<Watches> {
            let fd = unsafe { libc::inotify_init1(libc::IN_NONBLOCK | libc::IN_CLOEXEC) };
            if fd < 0 {
                return None;
            }
            let mut w = Watches { fd, paths: HashMap::new(), tops: dirs, config, config_wd: -1 };
            w.add_all();
            Some(w)
        }

        /// Every folder (at the start, and again after the kernel dropped events: a folder made then
        /// wasn't seen). Watching a folder twice gives the same watch.
        fn add_all(&mut self) {
            for d in self.tops.clone() {
                self.add_tree(&d, 0);
            }
            // (the logseq folder itself, not its sub-folders: only config.edn counts there)
            if let Some(wd) = self.add_one(&self.config, libc::IN_ONLYDIR) {
                self.config_wd = wd;
            }
        }

        fn add_one(&self, dir: &Path, flags: u32) -> Option<i32> {
            let c = CString::new(dir.as_os_str().as_bytes()).ok()?;
            let wd = unsafe { libc::inotify_add_watch(self.fd, c.as_ptr(), MASK | flags) };
            (wd >= 0).then_some(wd)
        }

        /// `dir` and the folders in it (inotify isn't recursive), not hidden ones and not links to
        /// folders elsewhere (a link can't make it watch in a circle).
        fn add_tree(&mut self, dir: &Path, depth: usize) {
            let flags = libc::IN_ONLYDIR | if depth > 0 { libc::IN_DONT_FOLLOW } else { 0 };
            let Some(wd) = self.add_one(dir, flags) else { return };
            self.paths.insert(wd, dir.to_path_buf());
            if depth >= DEPTH {
                return;
            }
            if let Ok(rd) = std::fs::read_dir(dir) {
                for e in rd.flatten() {
                    if e.file_type().is_ok_and(|t| t.is_dir()) && !super::hidden(&e.file_name().to_string_lossy()) {
                        self.add_tree(&e.path(), depth + 1);
                    }
                }
            }
        }

        /// A folder moved away: its watches (and those inside it) stop; if it moved within the notes,
        /// the IN_MOVED_TO that follows watches it again under its new name.
        fn forget_tree(&mut self, dir: &Path) {
            let gone: Vec<i32> = self.paths.iter().filter(|(_, p)| p.starts_with(dir)).map(|(&wd, _)| wd).collect();
            for wd in gone {
                unsafe { libc::inotify_rm_watch(self.fd, wd as _) }; // (`wd as _`: the watch id is an i32 in Linux's libc, a u32 in Android's)
                self.paths.remove(&wd);
            }
        }

        /// Takes in one batch of events; true when the notes (or the settings) may have changed.
        pub fn take(&mut self, events: &[Event]) -> bool {
            let mut hit = false;
            for e in events {
                if e.mask & libc::IN_Q_OVERFLOW != 0 {
                    // the kernel dropped events: anything may have changed, a new folder too
                    self.add_all();
                    hit = true;
                } else if e.mask & libc::IN_IGNORED != 0 {
                    // a watch ended (its folder went, or forget_tree removed it)
                    self.paths.remove(&e.wd);
                    if e.wd == self.config_wd {
                        self.config_wd = -1;
                    }
                } else if e.wd == self.config_wd {
                    hit |= super::is_config(&e.name);
                } else if e.mask & libc::IN_DELETE_SELF != 0 {
                    hit = true; // a watched folder went (its notes with it)
                } else if e.mask & libc::IN_ISDIR != 0 {
                    if super::hidden(&e.name) {
                        continue;
                    }
                    if let Some(parent) = self.paths.get(&e.wd).cloned() {
                        let p = parent.join(&e.name);
                        if e.mask & libc::IN_MOVED_FROM != 0 {
                            self.forget_tree(&p);
                        }
                        if e.mask & (libc::IN_CREATE | libc::IN_MOVED_TO) != 0 {
                            self.add_tree(&p, 1);
                        }
                    }
                    hit = true; // notes may have come or gone with the folder
                } else {
                    hit |= super::interesting(&e.name);
                }
            }
            hit
        }
    }

    /// Waits for changes WAKE_MS at a time until a newer watch starts, then closes the descriptor.
    pub fn run(_root: PathBuf, dirs: Vec<PathBuf>, config: PathBuf, gen: usize, signal: impl Fn() + Send + Sync + 'static) {
        let Some(mut w) = Watches::new(dirs, config) else { return };
        let mut buf = vec![0u8; 64 * 1024];
        while super::current(gen) {
            let mut p = libc::pollfd { fd: w.fd, events: libc::POLLIN, revents: 0 };
            let r = unsafe { libc::poll(&mut p, 1, super::WAKE_MS as i32) };
            if r < 0 {
                if errno() == libc::EINTR {
                    continue;
                }
                break;
            }
            if r == 0 || !super::current(gen) {
                continue;
            }
            let mut hit = false;
            let mut stop = false;
            loop {
                let n = unsafe { libc::read(w.fd, buf.as_mut_ptr().cast(), buf.len()) };
                match after_read(n, if n < 0 { errno() } else { 0 }) {
                    Next::Got(n) => hit |= w.take(&parse(&buf[..n])),
                    Next::Again => continue,
                    Next::Drained => break,
                    Next::Stop => {
                        stop = true;
                        break;
                    }
                }
            }
            if hit {
                signal();
            }
            if stop {
                break;
            }
        }
    }
}

#[cfg(not(any(windows, target_os = "linux", target_os = "android")))]
mod platform {
    pub fn run(_root: std::path::PathBuf, _dirs: Vec<std::path::PathBuf>, _config: std::path::PathBuf, _gen: usize, _signal: impl Fn() + Send + Sync + 'static) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(next: u32, name: &str) -> Vec<u8> {
        let units: Vec<u8> = name.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
        let mut r = vec![];
        r.extend(next.to_le_bytes());
        r.extend(1u32.to_le_bytes()); // FILE_ACTION_ADDED
        r.extend((units.len() as u32).to_le_bytes());
        r.extend(units);
        r
    }

    #[test]
    fn windows_records_are_read_one_after_another() {
        let a = record(0, "x");
        // the first record ("next" = 36: its 12 + 20 bytes, then 4 bytes of padding to a DWORD)
        let mut buf = record(36, "pages\\a.md");
        buf.resize(36, 0);
        buf.extend(record(0, "journals\\2026_11_21.md"));
        assert_eq!(notify_names(&buf), vec!["pages\\a.md", "journals\\2026_11_21.md"]);
        assert_eq!(notify_names(&a), vec!["x"]);
        assert!(notify_names(&buf).iter().any(|n| interesting(n)));
        // non-English names come through
        assert_eq!(notify_names(&record(0, "pages\\café ü.md")), vec!["pages\\café ü.md"]);
    }

    #[test]
    fn broken_windows_records_never_read_past_the_end() {
        assert!(notify_names(&[]).is_empty());
        assert!(notify_names(&[0; 11]).is_empty());
        // a name longer than what came: cut at the end
        let mut r = record(0, "abc.md");
        r[8..12].copy_from_slice(&1000u32.to_le_bytes());
        assert_eq!(notify_names(&r), vec!["abc.md"]);
        // an odd byte count: the last half unit is left out
        let mut r = record(0, "ab");
        r[8..12].copy_from_slice(&3u32.to_le_bytes());
        assert_eq!(notify_names(&r), vec!["a"]);
        // "next" past the end or huge: stops there
        let mut r = record(0, "a.md");
        r[0..4].copy_from_slice(&u32::MAX.to_le_bytes());
        assert_eq!(notify_names(&r), vec!["a.md"]);
        let mut r = record(0, "a.md");
        r[0..4].copy_from_slice(&4u32.to_le_bytes()); // points inside itself: the rest is too short
        assert_eq!(notify_names(&r).first().map(String::as_str), Some("a.md"));
    }

    #[test]
    fn a_folder_that_failed_waits_longer_each_time() {
        assert_eq!((1..=8).map(backoff).collect::<Vec<_>>(), vec![1, 2, 4, 8, 16, 30, 30, 30]);
        assert_eq!(backoff(0), 1);
        assert_eq!(backoff(u32::MAX), 30);
    }

    #[test]
    fn which_names_count() {
        assert!(interesting("a.md") && interesting("pages/sub/b.md") && interesting("pages\\c.md"));
        assert!(!interesting(".a.md") && !interesting("pages/.capture-1.tmp") && !interesting("a.md.tmp") && !interesting("pages\\.b.md"));
        assert!(is_config("config.edn") && is_config("CONFIG.EDN") && !is_config("config.edn.bak") && !is_config("custom.css"));
        assert!(hidden(".git") && hidden(".stfolder") && !hidden("sub"));
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    mod inotify {
        use super::super::platform::{after_read, parse, run, Event, Next, Watches};
        use super::super::*;
        use std::path::{Path, PathBuf};
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::{mpsc, Arc, Mutex, MutexGuard};
        use std::time::{Duration, Instant};

        /// GEN is shared: the tests that start watches run one at a time.
        static ONE: Mutex<()> = Mutex::new(());
        fn one() -> MutexGuard<'static, ()> {
            ONE.lock().unwrap_or_else(|p| p.into_inner())
        }

        struct Dir(PathBuf);
        impl Dir {
            fn new(name: &str) -> Dir {
                static N: AtomicUsize = AtomicUsize::new(0);
                let p = std::env::temp_dir().join(format!("thinky-watch-{}-{}-{}", std::process::id(), N.fetch_add(1, Ordering::SeqCst), name));
                let _ = std::fs::remove_dir_all(&p);
                std::fs::create_dir_all(&p).unwrap();
                Dir(p)
            }
        }
        impl Drop for Dir {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }

        /// A watch on `dirs` and `config` on its own thread, counting what it reports (no 400 ms wait).
        struct Watching {
            gen: usize,
            hits: Arc<AtomicUsize>,
            ended: mpsc::Receiver<()>,
        }
        fn watching(dirs: Vec<PathBuf>, config: PathBuf) -> Watching {
            let gen = GEN.fetch_add(1, Ordering::SeqCst) + 1;
            let hits = Arc::new(AtomicUsize::new(0));
            let h = hits.clone();
            let (tx, ended) = mpsc::channel();
            let (ready_tx, ready) = mpsc::channel();
            std::thread::spawn(move || {
                let _ = ready_tx.send(());
                run(PathBuf::new(), dirs, config, gen, move || {
                    h.fetch_add(1, Ordering::SeqCst);
                });
                let _ = tx.send(());
            });
            ready.recv().unwrap();
            std::thread::sleep(Duration::from_millis(150)); // its watches are in place
            Watching { gen, hits, ended }
        }
        impl Watching {
            fn hits(&self) -> usize {
                self.hits.load(Ordering::SeqCst)
            }
            /// Waits (up to 3 s) for a report after `since` of them; true when one came.
            fn reports_after(&self, since: usize) -> bool {
                let t = Instant::now();
                while t.elapsed() < Duration::from_secs(3) {
                    if self.hits() > since {
                        return true;
                    }
                    std::thread::sleep(Duration::from_millis(20));
                }
                false
            }
            /// Nothing reported for a while after `since`.
            fn quiet_after(&self, since: usize) -> bool {
                std::thread::sleep(Duration::from_millis(600));
                self.hits() == since
            }
            /// Waits until reports stop coming (a burst of events may take a few reads).
            fn settled(&self) -> usize {
                let mut n = self.hits();
                loop {
                    std::thread::sleep(Duration::from_millis(300));
                    let m = self.hits();
                    if m == n {
                        return m;
                    }
                    n = m;
                }
            }
        }
        impl Drop for Watching {
            fn drop(&mut self) {
                if current(self.gen) {
                    GEN.fetch_add(1, Ordering::SeqCst);
                }
                let _ = self.ended.recv_timeout(Duration::from_secs(3));
            }
        }

        fn write(p: &Path, text: &str) {
            std::fs::write(p, text).unwrap();
        }

        /// The inotify descriptors this process has open.
        fn inotify_fds() -> usize {
            std::fs::read_dir("/proc/self/fd")
                .map(|rd| rd.flatten().filter(|e| std::fs::read_link(e.path()).is_ok_and(|l| l.to_string_lossy().contains("inotify"))).count())
                .unwrap_or(0)
        }

        fn event(wd: i32, mask: u32, name: &str) -> Vec<u8> {
            let mut padded = name.as_bytes().to_vec();
            if !name.is_empty() {
                padded.resize((name.len() + 1).div_ceil(16) * 16, 0);
            }
            let mut b = vec![];
            b.extend(wd.to_ne_bytes());
            b.extend(mask.to_ne_bytes());
            b.extend(0u32.to_ne_bytes());
            b.extend((padded.len() as u32).to_ne_bytes());
            b.extend(padded);
            b
        }

        #[test]
        fn events_are_read_one_after_another() {
            let mut buf = event(1, libc::IN_CLOSE_WRITE, "a.md");
            buf.extend(event(2, libc::IN_CREATE | libc::IN_ISDIR, "a folder with a long name"));
            buf.extend(event(-1, libc::IN_Q_OVERFLOW, ""));
            assert_eq!(
                parse(&buf),
                vec![
                    Event { wd: 1, mask: libc::IN_CLOSE_WRITE, name: "a.md".into() },
                    Event { wd: 2, mask: libc::IN_CREATE | libc::IN_ISDIR, name: "a folder with a long name".into() },
                    Event { wd: -1, mask: libc::IN_Q_OVERFLOW, name: "".into() },
                ]
            );
            // a record cut short ends the list; nothing is read past the end
            let mut cut = event(1, libc::IN_CLOSE_WRITE, "a.md");
            cut.extend(&event(3, libc::IN_CLOSE_WRITE, "b.md")[..20]);
            assert_eq!(parse(&cut).len(), 1);
            let mut huge = event(1, libc::IN_CLOSE_WRITE, "a.md");
            huge[12..16].copy_from_slice(&u32::MAX.to_ne_bytes());
            assert!(parse(&huge).is_empty());
            assert!(parse(&[0; 15]).is_empty());
        }

        #[test]
        fn an_interrupted_read_is_tried_again() {
            assert_eq!(after_read(32, 0), Next::Got(32));
            assert_eq!(after_read(-1, libc::EINTR), Next::Again);
            assert_eq!(after_read(-1, libc::EAGAIN), Next::Drained);
            assert_eq!(after_read(0, 0), Next::Drained);
            assert_eq!(after_read(-1, libc::EBADF), Next::Stop);
            assert_eq!(after_read(-1, libc::EINVAL), Next::Stop);
        }

        #[test]
        fn every_folder_inside_is_watched_but_not_hidden_ones_or_links() {
            let d = Dir::new("tree");
            let pages = d.0.join("pages");
            std::fs::create_dir_all(pages.join("a/b/c")).unwrap();
            std::fs::create_dir_all(pages.join(".git/objects")).unwrap();
            std::fs::create_dir_all(d.0.join("elsewhere")).unwrap();
            std::os::unix::fs::symlink(d.0.join("elsewhere"), pages.join("link")).unwrap();
            let w = Watches::new(vec![pages.clone()], d.0.join("logseq")).unwrap();
            let mut watched: Vec<_> = w.paths.values().map(|p| p.strip_prefix(&pages).unwrap().to_string_lossy().into_owned()).collect();
            watched.sort();
            assert_eq!(watched, vec!["", "a", "a/b", "a/b/c"]);
            assert_eq!(w.config_wd, -1, "no logseq folder: no watch for it");
        }

        #[test]
        fn events_count_only_for_notes_and_the_settings() {
            let d = Dir::new("take");
            let pages = d.0.join("pages");
            std::fs::create_dir_all(&pages).unwrap();
            std::fs::create_dir_all(d.0.join("logseq")).unwrap();
            let mut w = Watches::new(vec![pages.clone()], d.0.join("logseq")).unwrap();
            let top = *w.paths.keys().next().unwrap();
            let cfg = w.config_wd;
            assert!(cfg >= 0 && cfg != top);
            let ev = |wd, mask, name: &str| Event { wd, mask, name: name.into() };
            assert!(w.take(&[ev(top, libc::IN_CLOSE_WRITE, "a.md")]));
            assert!(!w.take(&[ev(top, libc::IN_CLOSE_WRITE, ".a.md"), ev(top, libc::IN_CREATE, ".capture-1.tmp")]));
            assert!(!w.take(&[ev(top, libc::IN_CREATE | libc::IN_ISDIR, ".hidden")]));
            assert!(w.take(&[ev(cfg, libc::IN_CLOSE_WRITE, "config.edn")]));
            assert!(!w.take(&[ev(cfg, libc::IN_CLOSE_WRITE, "custom.css"), ev(cfg, libc::IN_CREATE | libc::IN_ISDIR, "bak")]));
            // events dropped by the kernel: look again
            assert!(w.take(&[ev(-1, libc::IN_Q_OVERFLOW, "")]));
            // a folder made: watched, and counted (notes may already be in it)
            std::fs::create_dir_all(pages.join("new/inner")).unwrap();
            assert!(w.take(&[ev(top, libc::IN_CREATE | libc::IN_ISDIR, "new")]));
            assert!(w.paths.values().any(|p| p.ends_with("new/inner")));
            // moved away: no longer watched
            std::fs::rename(pages.join("new"), d.0.join("gone")).unwrap();
            assert!(w.take(&[ev(top, libc::IN_MOVED_FROM | libc::IN_ISDIR, "new")]));
            assert!(!w.paths.values().any(|p| p.starts_with(pages.join("new"))));
            // a watch that ended is forgotten; the settings' one too
            assert!(!w.take(&[ev(top, libc::IN_IGNORED, "")]));
            assert!(!w.paths.contains_key(&top));
            assert!(!w.take(&[ev(cfg, libc::IN_IGNORED, "")]));
            assert_eq!(w.config_wd, -1);
        }

        #[test]
        fn a_note_in_a_nested_folder_is_seen() {
            let _one = one();
            let d = Dir::new("nested");
            let pages = d.0.join("pages");
            std::fs::create_dir_all(pages.join("a/b")).unwrap();
            let w = watching(vec![pages.clone()], d.0.join("logseq"));
            write(&pages.join("a/b/deep.md"), "- hi");
            assert!(w.reports_after(0), "a note two folders down");
        }

        #[test]
        fn a_folder_made_later_is_watched() {
            let _one = one();
            let d = Dir::new("made");
            let pages = d.0.join("pages");
            std::fs::create_dir_all(&pages).unwrap();
            let w = watching(vec![pages.clone()], d.0.join("logseq"));
            std::fs::create_dir_all(pages.join("new/deeper")).unwrap();
            assert!(w.reports_after(0), "a new folder counts");
            let n = w.settled();
            write(&pages.join("new/deeper/n.md"), "- hi");
            assert!(w.reports_after(n), "a note in a folder made after the watch started");
        }

        #[test]
        fn a_folder_moved_in_is_watched_and_one_moved_out_is_not() {
            let _one = one();
            let d = Dir::new("moved");
            let pages = d.0.join("pages");
            std::fs::create_dir_all(&pages).unwrap();
            std::fs::create_dir_all(d.0.join("outside/inner")).unwrap();
            std::fs::create_dir_all(pages.join("leaving/inner")).unwrap();
            let w = watching(vec![pages.clone()], d.0.join("logseq"));
            std::fs::rename(d.0.join("outside"), pages.join("arrived")).unwrap();
            assert!(w.reports_after(0), "a folder moved in counts");
            let n = w.settled();
            write(&pages.join("arrived/inner/n.md"), "- hi");
            assert!(w.reports_after(n), "a note in a folder moved in");
            let n = w.settled();
            std::fs::rename(pages.join("leaving"), d.0.join("left")).unwrap();
            assert!(w.reports_after(n), "a folder moved out counts (its notes went)");
            let n = w.settled();
            write(&d.0.join("left/inner/x.md"), "- not a note any more");
            assert!(w.quiet_after(n), "a folder moved out of the notes isn't followed");
            // moved within the notes: followed under its new name
            std::fs::create_dir_all(pages.join("one/two")).unwrap();
            let n = w.settled();
            std::fs::rename(pages.join("one"), pages.join("renamed")).unwrap();
            assert!(w.reports_after(n));
            let n = w.settled();
            write(&pages.join("renamed/two/y.md"), "- hi");
            assert!(w.reports_after(n), "a folder renamed inside the notes");
        }

        #[test]
        fn only_config_edn_counts_in_the_logseq_folder() {
            let _one = one();
            let d = Dir::new("config");
            let pages = d.0.join("pages");
            let config = d.0.join("logseq");
            std::fs::create_dir_all(&pages).unwrap();
            std::fs::create_dir_all(config.join("bak")).unwrap();
            let w = watching(vec![pages.clone()], config.clone());
            write(&config.join("custom.css"), "a {}");
            write(&config.join("bak/config.edn"), "{}");
            write(&config.join("bak/x.md"), "- copy");
            write(&pages.join(".hidden.md"), "- temp");
            assert!(w.quiet_after(0), "safety copies, other settings files and hidden files don't count");
            write(&config.join("config.edn"), "{:preferred-workflow :now}");
            assert!(w.reports_after(0), "config.edn counts");
        }

        #[test]
        fn a_watch_that_was_interrupted_keeps_watching() {
            let _one = one();
            extern "C" fn nothing(_: libc::c_int) {}
            unsafe {
                // a handler without SA_RESTART: poll() and read() come back with EINTR
                let mut sa: libc::sigaction = std::mem::zeroed();
                sa.sa_sigaction = nothing as *const () as usize;
                libc::sigemptyset(&mut sa.sa_mask);
                libc::sigaction(libc::SIGUSR1, &sa, std::ptr::null_mut());
            }
            let d = Dir::new("eintr");
            let pages = d.0.join("pages");
            std::fs::create_dir_all(&pages).unwrap();
            let gen = GEN.fetch_add(1, Ordering::SeqCst) + 1;
            let hits = Arc::new(AtomicUsize::new(0));
            let h = hits.clone();
            let (tid_tx, tid) = mpsc::channel();
            let (end_tx, ended) = mpsc::channel();
            let p = pages.clone();
            std::thread::spawn(move || {
                tid_tx.send(unsafe { libc::pthread_self() }).unwrap();
                run(PathBuf::new(), vec![p], PathBuf::from("/nonexistent"), gen, move || {
                    h.fetch_add(1, Ordering::SeqCst);
                });
                let _ = end_tx.send(());
            });
            let t = tid.recv().unwrap();
            std::thread::sleep(Duration::from_millis(150));
            for _ in 0..5 {
                unsafe { libc::pthread_kill(t, libc::SIGUSR1) };
                std::thread::sleep(Duration::from_millis(30));
            }
            assert!(ended.try_recv().is_err(), "an interrupted wait doesn't end the watch");
            write(&pages.join("after.md"), "- hi");
            let t0 = Instant::now();
            while hits.load(Ordering::SeqCst) == 0 && t0.elapsed() < Duration::from_secs(3) {
                std::thread::sleep(Duration::from_millis(20));
            }
            assert!(hits.load(Ordering::SeqCst) > 0, "a note after the interruptions is still seen");
            GEN.fetch_add(1, Ordering::SeqCst);
            assert!(ended.recv_timeout(Duration::from_secs(3)).is_ok());
        }

        #[test]
        fn an_older_watch_ends_and_closes_its_descriptor() {
            let _one = one();
            let d = Dir::new("stale");
            let pages = d.0.join("pages");
            std::fs::create_dir_all(&pages).unwrap();
            let old = watching(vec![pages.clone()], d.0.join("logseq"));
            let new = watching(vec![pages.clone()], d.0.join("logseq"));
            let t = Instant::now();
            assert!(old.ended.recv_timeout(Duration::from_millis(2500)).is_ok(), "the older watch ends once a newer one starts");
            assert!(t.elapsed() < Duration::from_millis(2500));
            write(&pages.join("n.md"), "- hi");
            assert!(new.reports_after(0), "the newer one still watches");
            assert_eq!(old.hits(), 0, "the older one reported nothing after it ended");
        }

        #[test]
        fn switching_vaults_many_times_leaves_one_descriptor() {
            let _one = one();
            let d = Dir::new("switch");
            let pages = d.0.join("pages");
            std::fs::create_dir_all(&pages).unwrap();
            let seen = Arc::new(AtomicUsize::new(0));
            let started = |seen: &Arc<AtomicUsize>| {
                let s = seen.clone();
                start(d.0.clone(), vec![pages.clone()], d.0.join("logseq"), move || {
                    s.fetch_add(1, Ordering::SeqCst);
                })
            };
            started(&seen);
            std::thread::sleep(Duration::from_millis(1500)); // earlier tests' watches have ended
            let before = inotify_fds();
            assert!(before >= 1, "the watch has its descriptor");
            for _ in 0..20 {
                started(&seen);
            }
            std::thread::sleep(Duration::from_millis(2500));
            assert_eq!(inotify_fds(), before, "only the newest watch keeps a descriptor");
            write(&pages.join("n.md"), "- hi");
            let t = Instant::now();
            while seen.load(Ordering::SeqCst) == 0 && t.elapsed() < Duration::from_secs(3) {
                std::thread::sleep(Duration::from_millis(20));
            }
            assert_eq!(seen.load(Ordering::SeqCst), 1, "reported once (400 ms apart), by the newest watch only");
            GEN.fetch_add(1, Ordering::SeqCst);
        }
    }
}
