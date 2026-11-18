//! The optional AI features' keys (Build 51): kept by Windows, never in the notes folder (which
//! Google Drive syncs and a backup may push to GitHub) and never in the page. Windows' Credential
//! Manager holds one per service ("thinky AI key: claude"…), for this Windows user only; the page
//! can only save, remove or ask whether there is one, never read it back. Requests are sent here
//! (`send`), with Windows' own curl.exe (ai.rs `send_with_curl`). On Android, MainActivity does both.

use outline_core::ai::{key_ok, provider, send_with_curl, Request};

fn target(service: &str) -> Result<String, String> {
    provider(service).map(|p| format!("thinky AI key: {}", p.id)).ok_or_else(|| "unknown AI service".to_string())
}

/// Save (or, with an empty key, remove) the key for one service.
pub fn set(service: &str, key: &str) -> Result<bool, String> {
    let t = target(service)?;
    let key = key.trim();
    if key.is_empty() {
        imp::delete(&t);
        return Ok(false);
    }
    if !key_ok(key) {
        return Err("That key has spaces, quotes or line breaks in it. Copy it again from the service's page.".into());
    }
    imp::write(&t, key)?;
    Ok(true)
}

pub fn has(service: &str) -> Result<bool, String> {
    Ok(imp::read(&target(service)?).is_some())
}

/// Send one request (built by ai.rs) with this service's key, if it needs one.
pub fn send(service: &str, req: &Request) -> Result<(u16, String), String> {
    let key = if req.auth.is_some() { imp::read(&target(service)?) } else { None };
    let tmp = outline_core::app::cache_dir().map(|c| c.join("ai")).unwrap_or_else(|| std::env::temp_dir().join("thinky-ai"));
    send_with_curl(&imp::curl(), req, key.as_deref(), &tmp)
}

#[cfg(windows)]
mod imp {
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;

    #[repr(C)]
    struct Credential {
        flags: u32,
        kind: u32,
        target: *mut u16,
        comment: *mut u16,
        written: [u32; 2],
        blob_size: u32,
        blob: *mut u8,
        persist: u32,
        attr_count: u32,
        attrs: *mut c_void,
        alias: *mut u16,
        user: *mut u16,
    }
    #[link(name = "advapi32")]
    extern "system" {
        fn CredWriteW(c: *const Credential, flags: u32) -> i32;
        fn CredReadW(target: *const u16, kind: u32, flags: u32, out: *mut *mut Credential) -> i32;
        fn CredDeleteW(target: *const u16, kind: u32, flags: u32) -> i32;
        fn CredFree(c: *mut c_void);
    }
    const GENERIC: u32 = 1;
    const PERSIST_LOCAL_MACHINE: u32 = 2; // this Windows user, on this computer (not roaming)

    fn wide(s: &str) -> Vec<u16> {
        std::ffi::OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
    }

    pub fn write(target: &str, key: &str) -> Result<(), String> {
        let mut t = wide(target);
        let mut user = wide("thinky");
        let mut blob = key.as_bytes().to_vec();
        let c = Credential {
            flags: 0,
            kind: GENERIC,
            target: t.as_mut_ptr(),
            comment: std::ptr::null_mut(),
            written: [0, 0],
            blob_size: blob.len() as u32,
            blob: blob.as_mut_ptr(),
            persist: PERSIST_LOCAL_MACHINE,
            attr_count: 0,
            attrs: std::ptr::null_mut(),
            alias: std::ptr::null_mut(),
            user: user.as_mut_ptr(),
        };
        if unsafe { CredWriteW(&c, 0) } == 0 {
            return Err(format!("Windows couldn't keep the key ({}).", std::io::Error::last_os_error()));
        }
        Ok(())
    }

    pub fn read(target: &str) -> Option<String> {
        let t = wide(target);
        let mut out: *mut Credential = std::ptr::null_mut();
        if unsafe { CredReadW(t.as_ptr(), GENERIC, 0, &mut out) } == 0 || out.is_null() {
            return None;
        }
        let key = unsafe {
            let c = &*out;
            let bytes = std::slice::from_raw_parts(c.blob, c.blob_size as usize);
            String::from_utf8(bytes.to_vec()).ok()
        };
        unsafe { CredFree(out as *mut c_void) };
        key.filter(|k| !k.is_empty())
    }

    pub fn delete(target: &str) {
        let t = wide(target);
        unsafe { CredDeleteW(t.as_ptr(), GENERIC, 0) };
    }

    pub fn curl() -> std::path::PathBuf {
        crate::update::imp::curl()
    }
}

#[cfg(not(windows))]
mod imp {
    // (Android keeps its keys in MainActivity, and the page sends through it there)
    pub fn write(_: &str, _: &str) -> Result<(), String> {
        Err("Keys are kept by the phone's own settings here.".into())
    }
    pub fn read(_: &str) -> Option<String> {
        None
    }
    pub fn delete(_: &str) {}
    pub fn curl() -> std::path::PathBuf {
        std::path::PathBuf::from("/usr/bin/curl")
    }
}
