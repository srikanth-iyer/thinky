//! The optional AI features' keys (Build 51): kept by Windows, never in the notes folder (which
//! Google Drive syncs and a backup may push to GitHub) and never in the page. Windows' Credential
//! Manager holds one per service ("thinky AI key: claude"…), for this Windows user only; the page
//! can only save, remove or ask whether there is one, never read it back. Requests are sent here
//! (`send`), with Windows' own curl.exe (ai.rs `send_with_curl`). On Android, MainActivity does both.
//!
//! A key goes only to its own service (review claim 1): the page hands over the whole request, so
//! `send` hands it to the core's `ai::send_keyed`, which checks its address (`ai::key_may_go`) and
//! names the key's header from the service (`ai::key_header`), never from the page; the dev server
//! sends the same way (audit finding 15: each had its own copy; their tests are in core/tests/ai_keys.rs).
//! "Other" has no fixed address: the one typed when its key was saved is kept beside it ("thinky AI
//! base: other") and is the only place that key may go.

use outline_core::ai::{check_base, key_header, key_ok, provider, send_keyed, Request};

fn target(service: &str) -> Result<String, String> {
    provider(service).map(|p| format!("thinky AI key: {}", p.id)).ok_or_else(|| "unknown AI service".to_string())
}

/// "Other"'s web address, saved with its key.
const OTHER_BASE: &str = "thinky AI base: other";

/// What saving keeps: None = remove the key (an empty one); else the key and, for "Other", its
/// address as `check_base` gives it (refused when it isn't one the requests may use).
fn to_keep(service: &str, key: &str, base: &str) -> Result<Option<(String, Option<String>)>, String> {
    let key = key.trim();
    if key.is_empty() {
        return Ok(None);
    }
    if !key_ok(key) {
        return Err("That key has spaces, quotes or line breaks in it. Copy it again from the service's page.".into());
    }
    let base = if service == "other" { Some(check_base(base)?.0) } else { None };
    Ok(Some((key.to_string(), base)))
}

/// Save (or, with an empty key, remove) the key for one service; for "Other", with the address it
/// belongs to (`base`, what Settings shows; ignored for the others, whose address is fixed).
pub fn set(service: &str, key: &str, base: &str) -> Result<bool, String> {
    let t = target(service)?;
    match to_keep(service, key, base)? {
        None => {
            imp::delete(&t);
            if service == "other" {
                imp::delete(OTHER_BASE);
            }
            Ok(false)
        }
        Some((key, base)) => {
            // the address first: a key is never kept without the one place it may go
            if let Some(b) = base {
                imp::write(OTHER_BASE, &b)?;
            }
            imp::write(&t, &key)?;
            Ok(true)
        }
    }
}

pub fn has(service: &str) -> Result<bool, String> {
    Ok(imp::read(&target(service)?).is_some())
}

/// Send one request (built by ai.rs) with this service's key, if it takes one and the address is its
/// own: the core's `send_keyed` checks both (else refused, nothing sent).
pub fn send(service: &str, req: &Request) -> Result<(u16, String), String> {
    let t = target(service)?; // the key's name in Windows' Credential Manager (an unknown service: refused)
    let key = if key_header(service).is_some() { imp::read(&t) } else { None }; // only a service that takes a key
    // "Other"'s key may go only to the address saved with it
    let other_base = if service == "other" && key.is_some() { imp::read(OTHER_BASE) } else { None };
    // the request's file goes in the app's cache folder (else the system's temporary folder)
    let tmp = outline_core::app::cache_dir().map(|c| c.join("ai")).unwrap_or_else(|| std::env::temp_dir().join("thinky-ai"));
    send_keyed(&imp::curl(), service, req, key.as_deref(), other_base.as_deref(), &tmp)
}

/// A credential's saved bytes: None for no blob (a null pointer, or none at all: review 16a, where
/// making a slice from a null pointer would be undefined behaviour).
///
/// # Safety
/// When `p` isn't null it must point at `n` readable bytes that outlive the slice.
unsafe fn blob_bytes<'a>(p: *const u8, n: u32) -> Option<&'a [u8]> {
    if p.is_null() || n == 0 {
        return None;
    }
    Some(std::slice::from_raw_parts(p, n as usize))
}

/// The key in a credential's bytes (text, not empty).
fn key_of(bytes: Option<&[u8]>) -> Option<String> {
    bytes.and_then(|b| String::from_utf8(b.to_vec()).ok()).filter(|k| !k.is_empty())
}

#[cfg(windows)]
mod imp {
    use crate::capture_box::ffi::wide; // text as Windows takes it (one converter for the app)
    use std::ffi::c_void;

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
        let held = Held(out); // freed by Windows when done, whatever happens
        let c = unsafe { &*held.0 };
        super::key_of(unsafe { super::blob_bytes(c.blob, c.blob_size) })
    }

    /// A credential Windows gave us, handed back (CredFree) when dropped.
    struct Held(*mut Credential);
    impl Drop for Held {
        fn drop(&mut self) {
            unsafe { CredFree(self.0 as *mut c_void) };
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn req(url: &str, auth: Option<&str>) -> Request {
        Request { method: "POST".into(), url: url.into(), auth: auth.map(str::to_string), headers: vec![], body: Some("{}".into()), local: false, key_required: false }
    }

    #[test]
    fn saving_keeps_others_address_with_its_key() {
        assert_eq!(to_keep("claude", "  sk-1  ", "https://attacker.example/v1").unwrap(), Some(("sk-1".into(), None)));
        assert_eq!(to_keep("other", "sk-2", "https://ai.example.org/v1/").unwrap(), Some(("sk-2".into(), Some("https://ai.example.org/v1".into()))));
        // "Other" with no address, or one the requests may not use: refused, nothing kept
        assert!(to_keep("other", "sk-2", "").is_err());
        assert!(to_keep("other", "sk-2", "http://attacker.example/v1").is_err());
        assert!(to_keep("other", "sk-2", "ftp://ai.example.org").is_err());
        // an empty key removes it (whatever the address)
        assert_eq!(to_keep("other", "   ", "").unwrap(), None);
        assert_eq!(to_keep("claude", "", "").unwrap(), None);
        // a key that can't go in a header
        assert!(to_keep("openai", "sk 1", "").is_err());
        assert!(to_keep("openai", "sk\"1", "").is_err());
        assert!(to_keep("openai", "sk-1\nX-Evil: 1", "").is_err());
    }

    #[test]
    fn an_empty_or_missing_credential_is_no_key() {
        unsafe {
            assert_eq!(blob_bytes(std::ptr::null(), 0), None);
            assert_eq!(blob_bytes(std::ptr::null(), 12), None); // never a slice from a null pointer
            let b = b"sk-abc";
            assert_eq!(blob_bytes(b.as_ptr(), 0), None);
            assert_eq!(blob_bytes(b.as_ptr(), 6), Some(&b[..]));
            assert_eq!(key_of(blob_bytes(b.as_ptr(), 6)).as_deref(), Some("sk-abc"));
        }
        assert_eq!(key_of(None), None);
        assert_eq!(key_of(Some(b"")), None);
        assert_eq!(key_of(Some(&[0xff, 0xfe])), None);
    }

    #[test]
    fn this_system_keeps_no_keys_itself() {
        // (on Windows the Credential Manager does; elsewhere set refuses and has says no)
        if !cfg!(windows) {
            assert!(set("claude", "sk-1", "").is_err());
            assert!(!has("claude").unwrap());
            assert!(!set("claude", "", "").unwrap());
        }
        assert!(set("nope", "sk-1", "").is_err());
        assert!(has("nope").is_err());
        assert!(send("nope", &req("https://api.anthropic.com/v1/models", None)).is_err());
        // send goes through the core's send_keyed: Claude needs a key and none is kept here, so it is
        // refused before anything is sent, though the page said none was needed
        if !cfg!(windows) {
            let e = send("claude", &req("https://api.anthropic.com/v1/models", None)).unwrap_err();
            assert!(e.starts_with("No key is saved"), "{e}");
        }
    }
}
