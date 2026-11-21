//! The optional AI features' keys (Build 51): kept by Windows, never in the notes folder (which
//! Google Drive syncs and a backup may push to GitHub) and never in the page. Windows' Credential
//! Manager holds one per service ("thinky AI key: claude"…), for this Windows user only; the page
//! can only save, remove or ask whether there is one, never read it back. Requests are sent here
//! (`send`), with Windows' own curl.exe (ai.rs `send_with_curl`). On Android, MainActivity does both.
//!
//! A key goes only to its own service (review claim 1): the page hands over the whole request, so
//! `send` checks its address (`ai::key_may_go`) and names the key's header from the service
//! (`ai::key_header`), never from the page. "Other" has no fixed address: the one typed when its key
//! was saved is kept beside it ("thinky AI base: other") and is the only place that key may go.

use outline_core::ai::{check_base, key_header, key_may_go, key_ok, provider, send_with_curl, Request};

fn target(service: &str) -> Result<String, String> {
    provider(service).map(|p| format!("thinky AI key: {}", p.id)).ok_or_else(|| "unknown AI service".to_string())
}

/// "Other"'s web address, saved with its key.
const OTHER_BASE: &str = "thinky AI base: other";

/// The refusal when a request would take a key somewhere else (the same words on every system).
pub const NOT_ITS_ADDRESS: &str = "That address isn't the one this service's key belongs to, so the key wasn't sent.";

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

/// The request as it goes out, with the key or without: the header named by the service (never the
/// page's `auth`), whether a key is needed by the service's own preset, and the key only when the
/// address is that service's own (else refused, nothing sent). A service that takes no key never
/// gets one.
fn prepared(service: &str, req: &Request, key: Option<String>, other_base: Option<&str>) -> Result<(Request, Option<String>), String> {
    let header = key_header(service);
    let key = key.filter(|_| header.is_some());
    if key.is_some() && !key_may_go(service, &req.url, other_base) {
        return Err(NOT_ITS_ADDRESS.into());
    }
    let mut out = req.clone();
    out.auth = header.map(str::to_string);
    out.key_required = provider(service).is_some_and(|p| p.key == "required");
    Ok((out, key))
}

/// Send one request (built by ai.rs) with this service's key, if it takes one and the address is its own.
pub fn send(service: &str, req: &Request) -> Result<(u16, String), String> {
    let t = target(service)?;
    let key = if key_header(service).is_some() { imp::read(&t) } else { None };
    let other_base = if service == "other" && key.is_some() { imp::read(OTHER_BASE) } else { None };
    let (req, key) = prepared(service, req, key, other_base.as_deref())?;
    let tmp = outline_core::app::cache_dir().map(|c| c.join("ai")).unwrap_or_else(|| std::env::temp_dir().join("thinky-ai"));
    send_with_curl(&imp::curl(), &req, key.as_deref(), &tmp)
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

    fn key() -> Option<String> {
        Some("sk-test-123".into())
    }

    #[test]
    fn a_key_goes_to_its_own_service() {
        let (r, k) = prepared("claude", &req("https://api.anthropic.com/v1/messages", Some("x-api-key")), key(), None).unwrap();
        assert_eq!((r.auth.as_deref(), k.as_deref(), r.key_required), (Some("x-api-key"), Some("sk-test-123"), true));
        for (service, url) in [
            ("openai", "https://api.openai.com/v1/chat/completions"),
            ("gemini", "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"),
            ("openrouter", "https://openrouter.ai/api/v1/models"),
        ] {
            let (r, k) = prepared(service, &req(url, Some("bearer")), key(), None).unwrap();
            assert_eq!((r.auth.as_deref(), k.as_deref()), (Some("bearer"), Some("sk-test-123")), "{service}");
            assert_eq!(r.url, url);
        }
    }

    #[test]
    fn a_key_never_goes_to_another_address() {
        // the review's attack: the page asks for Claude's key to be sent to its own server
        for url in [
            "https://attacker.example/v1/messages",
            "https://api.anthropic.com.attacker.example/v1/messages",
            "https://api.anthropic.com@attacker.example/v1/messages",
            "https://api.anthropic.com/v10/messages",
            "https://api.anthropic.com/v1",
            "http://api.anthropic.com/v1/messages",
            "HTTPS://API.ANTHROPIC.COM/v1/messages",
            "https://api.openai.com/v1/chat/completions",
            "http://localhost:11434/v1/chat/completions",
            "",
        ] {
            assert_eq!(prepared("claude", &req(url, Some("x-api-key")), key(), None).unwrap_err(), NOT_ITS_ADDRESS, "{url}");
        }
        // one service's key to another's address
        assert!(prepared("openai", &req("https://openrouter.ai/api/v1/models", Some("bearer")), key(), None).is_err());
        assert!(prepared("gemini", &req("https://generativelanguage.googleapis.com/v1/models", Some("bearer")), key(), None).is_err());
    }

    #[test]
    fn the_header_comes_from_the_service_not_the_page() {
        // the page asks for Claude's key as a Bearer header, or for none at all: still x-api-key
        for auth in [Some("bearer"), None, Some("anything")] {
            let (r, _) = prepared("claude", &req("https://api.anthropic.com/v1/models", auth), key(), None).unwrap();
            assert_eq!(r.auth.as_deref(), Some("x-api-key"));
        }
        // the page says a key isn't needed: Claude's preset says it is (curl then says none is saved)
        let (r, k) = prepared("claude", &req("https://api.anthropic.com/v1/models", None), None, None).unwrap();
        assert!(r.key_required && k.is_none() && r.auth.is_some());
        let mut asked = req("https://example.com/v1/models", Some("bearer"));
        asked.key_required = true;
        let (r, _) = prepared("other", &asked, None, None).unwrap();
        assert!(!r.key_required); // "Other": a key is up to the person
    }

    #[test]
    fn local_programs_never_get_a_key() {
        for service in ["ollama", "lmstudio"] {
            // even if one were somehow saved, and the page asks for a header
            let (r, k) = prepared(service, &req("http://localhost:11434/v1/chat/completions", Some("bearer")), key(), None).unwrap();
            assert_eq!((r.auth, k), (None, None), "{service}");
            let (r, k) = prepared(service, &req("https://attacker.example/v1", Some("x-api-key")), key(), None).unwrap();
            assert_eq!((r.auth, k), (None, None), "{service}");
        }
        // an unknown service: no header, no key
        let (r, k) = prepared("nope", &req("https://api.anthropic.com/v1/messages", Some("x-api-key")), key(), None).unwrap();
        assert_eq!((r.auth, k), (None, None));
    }

    #[test]
    fn others_key_goes_only_to_the_address_saved_with_it() {
        let base = Some("https://ai.example.org/v1");
        let (r, k) = prepared("other", &req("https://ai.example.org/v1/chat/completions", Some("bearer")), key(), base).unwrap();
        assert_eq!((r.auth.as_deref(), k.as_deref()), (Some("bearer"), Some("sk-test-123")));
        for url in ["https://attacker.example/v1/chat/completions", "https://ai.example.org.attacker.example/v1/x", "https://ai.example.org/v2/models", "https://ai.example.org/v1"] {
            assert_eq!(prepared("other", &req(url, Some("bearer")), key(), base).unwrap_err(), NOT_ITS_ADDRESS, "{url}");
        }
        // a key saved before addresses were kept with it (or the address was lost): never sent
        assert_eq!(prepared("other", &req("https://ai.example.org/v1/models", None), key(), None).unwrap_err(), NOT_ITS_ADDRESS);
        // a saved address that isn't one the requests may use: never sent there
        assert!(prepared("other", &req("http://attacker.example/v1/models", None), key(), Some("http://attacker.example/v1")).is_err());
        // a program on this computer, typed as "Other", with a key
        assert!(prepared("other", &req("http://localhost:8080/v1/models", None), key(), Some("http://localhost:8080/v1")).is_ok());
        // no key saved: the request goes as it is (nothing secret in it)
        let (_, k) = prepared("other", &req("https://anything.example/v1/models", None), None, None).unwrap();
        assert!(k.is_none());
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
            assert_eq!(set("claude", "", "").unwrap(), false);
        }
        assert!(set("nope", "sk-1", "").is_err());
        assert!(has("nope").is_err());
        assert!(send("nope", &req("https://api.anthropic.com/v1/models", None)).is_err());
    }
}
