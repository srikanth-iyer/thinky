//! Notice changed note files right away (Drive sync, the widget, Claude), instead of
//! checking on a timer. One sleeping thread per open vault; the app still re-checks when
//! it comes back to the front, in case a notification is missed (e.g. on a cloud drive).

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;

static GEN: AtomicUsize = AtomicUsize::new(0);

/// Watch `root` (its pages and journals) and call `changed` (at most every 400 ms) when a
/// `.md` file appears, changes, moves or goes. Replaces any earlier watch.
pub fn start(root: PathBuf, dirs: Vec<PathBuf>, changed: impl Fn() + Send + Sync + 'static) {
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
    let _ = std::thread::Builder::new().name("watch".into()).spawn(move || platform::run(root, dirs, gen, signal));
}

fn current(gen: usize) -> bool {
    GEN.load(Ordering::SeqCst) == gen
}

/// A note file we care about (not our own hidden temp files).
fn interesting(name: &str) -> bool {
    let file = name.rsplit(['/', '\\']).next().unwrap_or(name);
    file.ends_with(".md") && !file.starts_with('.')
}

#[cfg(windows)]
mod platform {
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;
    use std::path::PathBuf;

    #[link(name = "kernel32")]
    extern "system" {
        fn CreateFileW(name: *const u16, access: u32, share: u32, sa: *const c_void, disp: u32, flags: u32, template: *mut c_void) -> *mut c_void;
        fn ReadDirectoryChangesW(dir: *mut c_void, buf: *mut c_void, len: u32, subtree: i32, filter: u32, ret: *mut u32, ov: *mut c_void, done: *const c_void) -> i32;
        fn CloseHandle(h: *mut c_void) -> i32;
    }
    const FILE_LIST_DIRECTORY: u32 = 1;
    const SHARE_ALL: u32 = 1 | 2 | 4;
    const OPEN_EXISTING: u32 = 3;
    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
    // file name, directory name, size, last write
    const FILTER: u32 = 0x1 | 0x2 | 0x8 | 0x10;

    /// One recursive watch on each folder (ReadDirectoryChangesW, blocking).
    pub fn run(_root: PathBuf, dirs: Vec<PathBuf>, gen: usize, signal: impl Fn() + Send + Sync + 'static) {
        let signal = std::sync::Arc::new(signal);
        for dir in dirs {
            let signal = signal.clone();
            std::thread::spawn(move || watch(dir, gen, move || signal()));
        }
    }

    fn watch(dir: PathBuf, gen: usize, signal: impl Fn()) {
        let wide: Vec<u16> = dir.as_os_str().encode_wide().chain(Some(0)).collect();
        let h = unsafe { CreateFileW(wide.as_ptr(), FILE_LIST_DIRECTORY, SHARE_ALL, std::ptr::null(), OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, std::ptr::null_mut()) };
        if h.is_null() || h as isize == -1 {
            return;
        }
        let mut buf = vec![0u32; 16 * 1024]; // 64 KB, DWORD-aligned as the API needs
        while super::current(gen) {
            let mut got = 0u32;
            let ok = unsafe {
                ReadDirectoryChangesW(h, buf.as_mut_ptr().cast(), (buf.len() * 4) as u32, 1, FILTER, &mut got, std::ptr::null_mut(), std::ptr::null())
            };
            if ok == 0 || !super::current(gen) {
                break;
            }
            if got == 0 {
                signal(); // too many changes to list: just look again
                continue;
            }
            // FILE_NOTIFY_INFORMATION records: next offset, action, name length (bytes), name
            let bytes = unsafe { std::slice::from_raw_parts(buf.as_ptr() as *const u8, got as usize) };
            let mut at = 0usize;
            loop {
                if at + 12 > bytes.len() {
                    break;
                }
                let rd = |o: usize| u32::from_le_bytes([bytes[at + o], bytes[at + o + 1], bytes[at + o + 2], bytes[at + o + 3]]);
                let (next, len) = (rd(0) as usize, rd(8) as usize);
                let end = (at + 12 + len).min(bytes.len());
                let units: Vec<u16> = bytes[at + 12..end].chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
                if super::interesting(&String::from_utf16_lossy(&units)) {
                    signal();
                    break;
                }
                if next == 0 {
                    break;
                }
                at += next;
            }
        }
        unsafe { CloseHandle(h) };
    }
}

#[cfg(any(target_os = "linux", target_os = "android"))]
mod platform {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    use std::path::{Path, PathBuf};

    const MASK: u32 = libc::IN_CLOSE_WRITE | libc::IN_MOVED_TO | libc::IN_MOVED_FROM | libc::IN_DELETE | libc::IN_CREATE;

    fn add(fd: i32, dir: &Path) {
        if let Ok(c) = CString::new(dir.as_os_str().as_bytes()) {
            unsafe { libc::inotify_add_watch(fd, c.as_ptr(), MASK) };
        }
        // inotify isn't recursive: watch sub-folders too (namespaces in subfolders are rare)
        if let Ok(rd) = std::fs::read_dir(dir) {
            for e in rd.flatten() {
                if e.file_type().is_ok_and(|t| t.is_dir()) && !e.file_name().to_string_lossy().starts_with('.') {
                    add(fd, &e.path());
                }
            }
        }
    }

    pub fn run(_root: PathBuf, dirs: Vec<PathBuf>, gen: usize, signal: impl Fn() + Send + Sync + 'static) {
        let fd = unsafe { libc::inotify_init1(libc::IN_CLOEXEC) };
        if fd < 0 {
            return;
        }
        let mut wds: Vec<PathBuf> = vec![];
        for d in &dirs {
            add(fd, d);
            wds.push(d.clone());
        }
        let mut buf = vec![0u8; 16 * 1024];
        while super::current(gen) {
            let n = unsafe { libc::read(fd, buf.as_mut_ptr().cast(), buf.len()) };
            if n <= 0 || !super::current(gen) {
                break;
            }
            let n = n as usize;
            let mut at = 0;
            let mut hit = false;
            while at + 16 <= n {
                let mask = u32::from_ne_bytes([buf[at + 4], buf[at + 5], buf[at + 6], buf[at + 7]]);
                let len = u32::from_ne_bytes([buf[at + 12], buf[at + 13], buf[at + 14], buf[at + 15]]) as usize;
                let name_end = (at + 16 + len).min(n);
                let raw = &buf[at + 16..name_end];
                let name = String::from_utf8_lossy(&raw[..raw.iter().position(|&b| b == 0).unwrap_or(raw.len())]).into_owned();
                if mask & libc::IN_ISDIR != 0 && mask & libc::IN_CREATE != 0 {
                    // a new folder: watch it as well
                    for d in &wds {
                        let p = d.join(&name);
                        if p.is_dir() {
                            add(fd, &p);
                        }
                    }
                }
                if mask & libc::IN_Q_OVERFLOW != 0 || super::interesting(&name) {
                    hit = true;
                }
                at += 16 + len;
            }
            if hit {
                signal();
            }
        }
        unsafe { libc::close(fd) };
    }
}

#[cfg(not(any(windows, target_os = "linux", target_os = "android")))]
mod platform {
    pub fn run(_root: std::path::PathBuf, _dirs: Vec<std::path::PathBuf>, _gen: usize, _signal: impl Fn() + Send + Sync + 'static) {}
}
