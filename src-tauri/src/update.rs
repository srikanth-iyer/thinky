//! One-click updates on Windows (Settings → About → "Update now"), without Tauri's updater plugin
//! (+1 MB, ~40% of the installer): Windows' own curl.exe downloads the new installer and its
//! signature file from the public downloads page, Windows' own cryptography (CNG, bcrypt.dll)
//! checks the signature against the key built into the app, and the installer then runs in its
//! small "passive" mode, which closes the app, updates it and starts it again. The page only ever
//! passes a build number: addresses and file paths are made here. The rules (files, the signed
//! text, which versions are accepted) are in outline_core::update, with tests. CI checks that the
//! app it builds accepts its own installer and refuses a changed one (`--verify-update`, build.yml).
//! Android updates itself in android/MainActivity.kt.

use outline_core::update as rules;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

/// The key update signatures are checked against: base64 of the P-256 point X‖Y, built in by CI
/// (LEAN_UPDATE_KEY, from the key kept locked in ci/update-key.pem). Without it (a build made
/// anywhere else) the app can't update itself, and About shows the downloads page instead.
const KEY: Option<&str> = option_env!("LEAN_UPDATE_KEY");

fn key() -> Option<[u8; 64]> {
    KEY.and_then(rules::base64_decode).and_then(|b| b.try_into().ok())
}

/// A download underway (`busy`), or done: build `n` in `dir`, and whether it passed the check.
struct Pending {
    busy: bool,
    got: Option<Got>,
}
#[derive(Clone)]
struct Got {
    n: u32,
    dir: PathBuf,
    checked: bool,
}
static PENDING: Mutex<Pending> = Mutex::new(Pending { busy: false, got: None });

fn lock() -> MutexGuard<'static, Pending> {
    PENDING.lock().unwrap_or_else(|p| p.into_inner())
}

/// Where downloads go: the app's own cache folder (never a path from the page).
fn folder() -> Option<PathBuf> {
    Some(outline_core::app::cache_dir()?.join("update"))
}

/// Installed with the installer (which puts uninstall.exe beside the program), not the portable copy.
fn installed() -> bool {
    std::env::current_exe().ok().and_then(|e| Some(e.parent()?.join("uninstall.exe").is_file())).unwrap_or(false)
}

/// Can this copy update itself? None = yes; otherwise a short code for the page and why, in words.
fn why_not() -> Option<(&'static str, &'static str)> {
    if !cfg!(windows) {
        return Some(("os", "Updating from inside the app works on Windows and Android."));
    }
    if key().is_none() {
        return Some(("key", "This copy was built without the update key, so it can’t update itself."));
    }
    if !installed() {
        return Some(("portable", "This is the portable copy (it isn’t installed), so it can’t update itself."));
    }
    if !imp::curl().is_file() {
        return Some(("curl", "Windows’ download tool (curl.exe) is missing, so the app can’t download the update itself."));
    }
    None
}

/// The page's update commands, except installing (lib.rs `call`, which then closes the app).
pub fn command(cmd: &str, tag: &str, own: &str) -> Result<Value, String> {
    let r = match cmd {
        "update_status" => {
            return Ok(match why_not() {
                None => json!({ "can": true }),
                Some((why, msg)) => json!({ "can": false, "why": why, "msg": msg }),
            })
        }
        "update_download" => download(tag, own),
        _ => check(own),
    };
    r.map(|_| json!(true)).inspect_err(|e| outline_core::log::record(&format!("{cmd}: {e}")))
}

/// The installer closes every running copy of the program (Windows' Restart Manager), and a copy
/// closed that way can't save first: so the update waits until he has closed the others.
const OTHER_COPIES: &str = "Lean Outliner is also open in another window, or the Add to journal box is open. Close it, then press Update now again.";

fn own_version(own: &str) -> Result<rules::Version, String> {
    rules::parse_version(own).ok_or_else(|| format!("This app’s version ({own}) can’t be read."))
}

/// Download build `tag`'s installer and signature file into the app's cache folder.
fn download(tag: &str, own: &str) -> Result<(), String> {
    if let Some((_, msg)) = why_not() {
        return Err(msg.into());
    }
    let n = rules::build_number(tag).ok_or("That isn’t a build of Lean Outliner.")?;
    if n <= own_version(own)?.2 {
        return Err("You already have this version (or a newer one).".into());
    }
    if imp::other_copies()? > 0 {
        return Err(OTHER_COPIES.into()); // said now, before downloading (install checks again)
    }
    let dir = folder().ok_or("The app’s own folder isn’t known.")?;
    {
        let mut p = lock();
        if p.busy {
            return Err("The update is already downloading.".into());
        }
        // downloaded already (pressed again after closing another window): checked again anyway
        if p.got.as_ref().is_some_and(|g| g.n == n && g.dir.join(rules::SETUP_FILE).is_file() && g.dir.join(rules::SIG_FILE).is_file()) {
            return Ok(());
        }
        p.busy = true;
        p.got = None;
    }
    let r = (|| -> Result<(), String> {
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).map_err(|e| format!("Couldn’t make a folder for the download ({e})."))?;
        // the small signature file first: without it there's no point fetching the installer
        for file in [rules::SIG_FILE, rules::SETUP_FILE] {
            imp::fetch(&rules::asset_url(n, file), &dir.join(file))?;
        }
        Ok(())
    })();
    let mut p = lock();
    p.busy = false;
    match r {
        Ok(()) => p.got = Some(Got { n, dir, checked: false }),
        Err(_) => {
            let _ = std::fs::remove_dir_all(&dir);
        }
    }
    r
}

/// Is the download genuine, for the build asked for and newer than this app? If not, it's deleted.
fn check(own: &str) -> Result<(), String> {
    let mut p = lock();
    let got = p.got.clone().ok_or("Download the update first.")?;
    match verify_files(&got.dir.join(rules::SETUP_FILE), &got.dir.join(rules::SIG_FILE), got.n, Some(own_version(own)?)) {
        Ok(()) => {
            p.got = Some(Got { checked: true, ..got });
            Ok(())
        }
        Err(e) => {
            let _ = std::fs::remove_dir_all(&got.dir);
            p.got = None;
            Err(format!("The download didn’t pass the check that it’s genuine ({e}), so it was deleted and nothing was installed."))
        }
    }
}

/// Start the checked installer in its passive mode: a small progress window that updates the app
/// and starts it again (/R), with no new desktop shortcut (/UPDATE). It closes every running copy
/// of the app, so not while another one is open. The installer is checked once more, through a
/// handle that stays open until it has started: nothing can change or swap it in between (others
/// may only read it meanwhile). The caller exits the app straight after.
pub fn install(own: &str) -> Result<(), String> {
    let mut p = lock();
    let got = p.got.clone().filter(|g| g.checked).ok_or("Download the update and check it first.")?;
    let setup = got.dir.join(rules::SETUP_FILE);
    if imp::other_copies()? > 0 {
        return Err(OTHER_COPIES.into()); // (the download stays: pressed again, it goes straight on)
    }
    let r = (|| -> Result<(), String> {
        let (held, bytes) = imp::open_held(&setup)?;
        verify_bytes(&bytes, &got.dir.join(rules::SIG_FILE), got.n, Some(own_version(own)?))?;
        imp::run_installer(&setup)?;
        drop(held);
        Ok(())
    })();
    if let Err(e) = &r {
        outline_core::log::record(&format!("update_install: {e}"));
    }
    p.got = None;
    r
}

/// The whole check of an installer and its signature file for build `n`: the rules in
/// outline_core::update, then the signature itself, with Windows' own cryptography. `own` = the
/// running app's version (None for CI's check of the app it just built: `--verify-update`).
pub fn verify_files(setup: &Path, sig: &Path, n: u32, own: Option<rules::Version>) -> Result<(), String> {
    let bytes = std::fs::read(setup).map_err(|e| format!("the installer can’t be read: {e}"))?;
    verify_bytes(&bytes, sig, n, own)
}

fn verify_bytes(bytes: &[u8], sig: &Path, n: u32, own: Option<rules::Version>) -> Result<(), String> {
    let key = key().ok_or("this copy has no update key")?;
    let sig = rules::parse_sig_file(&std::fs::read_to_string(sig).map_err(|e| format!("the signature file can’t be read: {e}"))?)?;
    let text = rules::text_to_verify(&sig, rules::SETUP_FILE, n, own, &rules::hex(&imp::sha256(bytes)?))?;
    if imp::verify(&key, &imp::sha256(text.as_bytes())?, &sig.sig)? {
        Ok(())
    } else {
        Err("its signature isn’t from Lean Outliner’s key".into())
    }
}

/// The last update's installer isn't needed once it has run: remove it when the app starts, if
/// it's more than ten minutes old (the installer that started this app may still be finishing,
/// and another window of the app may be in the middle of an update).
pub fn tidy() {
    let Some(dir) = folder() else { return };
    let Ok(entries) = std::fs::read_dir(&dir) else { return };
    let fresh = entries.flatten().any(|e| e.metadata().and_then(|m| m.modified()).is_ok_and(|t| t.elapsed().map_or(true, |a| a.as_secs() < 600)));
    let p = lock();
    if !fresh && !p.busy && p.got.is_none() {
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[cfg(windows)]
mod imp {
    use std::ffi::c_void;
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    use std::path::{Path, PathBuf};
    use std::process::{Command, Stdio};

    type Handle = *mut c_void;
    #[link(name = "bcrypt")]
    extern "system" {
        fn BCryptOpenAlgorithmProvider(alg: *mut Handle, id: *const u16, implementation: *const u16, flags: u32) -> i32;
        fn BCryptCloseAlgorithmProvider(alg: Handle, flags: u32) -> i32;
        fn BCryptHash(alg: Handle, secret: *const u8, secret_len: u32, input: *const u8, input_len: u32, out: *mut u8, out_len: u32) -> i32;
        fn BCryptImportKeyPair(alg: Handle, import_key: Handle, blob_type: *const u16, key: *mut Handle, input: *const u8, input_len: u32, flags: u32) -> i32;
        fn BCryptVerifySignature(key: Handle, padding: *const c_void, hash: *const u8, hash_len: u32, sig: *const u8, sig_len: u32, flags: u32) -> i32;
        fn BCryptDestroyKey(key: Handle) -> i32;
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GetSystemDirectoryW(buf: *mut u16, size: u32) -> u32;
        fn CreateToolhelp32Snapshot(flags: u32, pid: u32) -> Handle;
        fn Process32FirstW(snap: Handle, entry: *mut ProcessEntry) -> i32;
        fn Process32NextW(snap: Handle, entry: *mut ProcessEntry) -> i32;
        fn CloseHandle(h: Handle) -> i32;
    }
    /// PROCESSENTRY32W
    #[repr(C)]
    struct ProcessEntry {
        size: u32,
        usage: u32,
        pid: u32,
        heap: usize,
        module: u32,
        threads: u32,
        parent: u32,
        priority: i32,
        flags: u32,
        exe: [u16; 260],
    }
    #[link(name = "shell32")]
    extern "system" {
        fn ShellExecuteW(hwnd: *mut c_void, op: *const u16, file: *const u16, params: *const u16, dir: *const u16, show: i32) -> isize;
    }

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(Some(0)).collect()
    }

    /// A CNG algorithm provider, closed again when dropped.
    struct Alg(Handle);
    impl Alg {
        fn open(id: &str) -> Result<Alg, String> {
            let (name, mut h) = (wide(id), std::ptr::null_mut());
            let st = unsafe { BCryptOpenAlgorithmProvider(&mut h, name.as_ptr(), std::ptr::null(), 0) };
            if st != 0 {
                return Err(format!("Windows’ {id} isn’t available ({:#010x})", st as u32));
            }
            Ok(Alg(h))
        }
    }
    impl Drop for Alg {
        fn drop(&mut self) {
            unsafe { BCryptCloseAlgorithmProvider(self.0, 0) };
        }
    }

    pub fn sha256(data: &[u8]) -> Result<[u8; 32], String> {
        let alg = Alg::open("SHA256")?;
        let len = u32::try_from(data.len()).map_err(|_| "the file is too big".to_string())?;
        let mut out = [0u8; 32];
        let st = unsafe { BCryptHash(alg.0, std::ptr::null(), 0, data.as_ptr(), len, out.as_mut_ptr(), 32) };
        if st != 0 {
            return Err(format!("Windows couldn’t work out a checksum ({:#010x})", st as u32));
        }
        Ok(out)
    }

    /// Is `sig` (r‖s) a valid ECDSA P-256 signature of `hash` by the key X‖Y?
    pub fn verify(key: &[u8; 64], hash: &[u8; 32], sig: &[u8; 64]) -> Result<bool, String> {
        let alg = Alg::open("ECDSA_P256")?;
        // BCRYPT_ECCKEY_BLOB: magic "ECS1" (BCRYPT_ECDSA_PUBLIC_P256_MAGIC), key size 32, then X, Y
        let mut blob = Vec::with_capacity(72);
        blob.extend_from_slice(&0x3153_4345u32.to_le_bytes());
        blob.extend_from_slice(&32u32.to_le_bytes());
        blob.extend_from_slice(key);
        let (kind, mut k) = (wide("ECCPUBLICBLOB"), std::ptr::null_mut());
        let st = unsafe { BCryptImportKeyPair(alg.0, std::ptr::null_mut(), kind.as_ptr(), &mut k, blob.as_ptr(), blob.len() as u32, 0) };
        if st != 0 {
            return Err(format!("the update key can’t be used ({:#010x})", st as u32));
        }
        let st = unsafe { BCryptVerifySignature(k, std::ptr::null(), hash.as_ptr(), 32, sig.as_ptr(), 64, 0) };
        unsafe { BCryptDestroyKey(k) };
        Ok(st == 0)
    }

    /// How many other copies of this program are running (another window, the "Add to journal"
    /// box, a note being added from the browser), by Windows' list of running programs.
    pub fn other_copies() -> Result<usize, String> {
        let me = std::env::current_exe().ok().and_then(|e| e.file_name().map(|n| n.to_string_lossy().to_lowercase())).ok_or("this program’s name isn’t known")?;
        let snap = unsafe { CreateToolhelp32Snapshot(0x2, 0) }; // TH32CS_SNAPPROCESS
        if snap.is_null() || snap as isize == -1 {
            return Err("Windows didn’t say which programs are running, so the update can’t go ahead safely.".into());
        }
        // SAFETY: PROCESSENTRY32W is plain numbers; zeroed is valid
        let mut e: ProcessEntry = unsafe { std::mem::zeroed() };
        e.size = std::mem::size_of::<ProcessEntry>() as u32;
        let mut found = 0;
        let mut more = unsafe { Process32FirstW(snap, &mut e) } != 0;
        while more {
            let len = e.exe.iter().position(|&c| c == 0).unwrap_or(e.exe.len());
            if e.pid != std::process::id() && String::from_utf16_lossy(&e.exe[..len]).to_lowercase() == me {
                found += 1;
            }
            more = unsafe { Process32NextW(snap, &mut e) } != 0;
        }
        unsafe { CloseHandle(snap) };
        Ok(found)
    }

    /// The installer, opened so that until the handle is dropped nothing else can change, rename or
    /// delete it (others may only read it, as starting it does), and its bytes read through it.
    pub fn open_held(path: &Path) -> Result<(std::fs::File, Vec<u8>), String> {
        use std::io::Read;
        use std::os::windows::fs::OpenOptionsExt;
        let mut f = std::fs::OpenOptions::new().read(true).share_mode(0x1).open(path).map_err(|e| format!("the installer can’t be opened: {e}"))?; // FILE_SHARE_READ
        let mut bytes = Vec::new();
        f.read_to_end(&mut bytes).map_err(|e| format!("the installer can’t be read: {e}"))?;
        Ok((f, bytes))
    }

    /// Windows' own curl.exe (Windows 10 1803 and later), by its full path.
    pub fn curl() -> PathBuf {
        let mut buf = [0u16; 260];
        let n = unsafe { GetSystemDirectoryW(buf.as_mut_ptr(), buf.len() as u32) } as usize;
        let dir = if n > 0 && n < buf.len() { PathBuf::from(std::ffi::OsString::from_wide(&buf[..n])) } else { PathBuf::from(r"C:\Windows\System32") };
        dir.join("curl.exe")
    }

    /// Download `url` to `to` with curl.exe: https only (redirects too), retried, within limits.
    /// `-q` first: no settings file (.curlrc) can change what it does.
    pub fn fetch(url: &str, to: &Path) -> Result<(), String> {
        use std::os::windows::process::CommandExt;
        let run = |extra: &[&str]| {
            Command::new(curl())
                .args(["-q", "-fsSL", "--proto", "=https", "--proto-redir", "=https", "--retry", "2", "--connect-timeout", "30", "--max-time", "900", "--max-filesize", "300000000"])
                .args(extra)
                .arg("-o")
                .arg(to)
                .arg(url)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::piped())
                .creation_flags(0x0800_0000) // no console window
                .output()
                .map_err(|e| format!("Windows’ download tool (curl.exe) didn’t start ({e})."))
        };
        // a certificate-revocation server that can't be reached is treated as browsers do; an older
        // curl.exe that doesn't know that option stops at once with code 2: then without it
        let mut out = run(&["--ssl-revoke-best-effort"])?;
        if out.status.code() == Some(2) {
            out = run(&[])?;
        }
        if out.status.success() {
            return Ok(());
        }
        let code = out.status.code().unwrap_or(-1);
        outline_core::log::record(&format!("update download {url}: curl.exe {code}: {}", String::from_utf8_lossy(&out.stderr).trim()));
        Err(match code {
            6 | 7 | 28 | 35 | 52 | 56 => "Couldn’t reach GitHub to download the update. Are you online?".into(),
            22 => "The update isn’t on the downloads page (yet).".into(),
            _ => format!("The download didn’t work (curl.exe stopped with code {code})."),
        })
    }

    /// Start the installer in its passive mode and return at once. Through ShellExecute, as Tauri's
    /// own updater does (it would also ask Windows for permission if an installer needed it).
    pub fn run_installer(setup: &Path) -> Result<(), String> {
        let file: Vec<u16> = setup.as_os_str().encode_wide().chain(Some(0)).collect();
        let (op, params) = (wide("open"), wide("/P /R /UPDATE"));
        let r = unsafe { ShellExecuteW(std::ptr::null_mut(), op.as_ptr(), file.as_ptr(), params.as_ptr(), std::ptr::null(), 5) }; // SW_SHOW
        if r <= 32 {
            return Err(format!("The installer didn’t start (Windows said {r})."));
        }
        Ok(())
    }
}

#[cfg(not(windows))]
mod imp {
    use std::path::{Path, PathBuf};
    const ONLY: &str = "updating from inside the app works on Windows and Android";
    pub fn curl() -> PathBuf {
        PathBuf::new()
    }
    pub fn other_copies() -> Result<usize, String> {
        Ok(0)
    }
    pub fn open_held(path: &Path) -> Result<(std::fs::File, Vec<u8>), String> {
        let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
        Ok((std::fs::File::open(path).map_err(|e| e.to_string())?, bytes))
    }
    pub fn fetch(_url: &str, _to: &Path) -> Result<(), String> {
        Err(ONLY.into())
    }
    pub fn sha256(_data: &[u8]) -> Result<[u8; 32], String> {
        Err(ONLY.into())
    }
    pub fn verify(_key: &[u8; 64], _hash: &[u8; 32], _sig: &[u8; 64]) -> Result<bool, String> {
        Err(ONLY.into())
    }
    pub fn run_installer(_setup: &Path) -> Result<(), String> {
        Err(ONLY.into())
    }
}
