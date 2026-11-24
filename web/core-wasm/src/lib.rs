//! thinky's core in a web browser: the same `dispatch` the app and the dev server call, with the
//! notes folder held in the page's memory (the page gives the program a pretend file system).
//! The page talks to it through three plain functions: get memory, call, free memory.
use outline_core::app::{dispatch, App};
use std::cell::RefCell;

thread_local! {
    // the open notes folder, as the dev server keeps it (one page, one folder)
    static STATE: RefCell<Option<App>> = const { RefCell::new(None) };
    // the last answer, kept until the next call (the page copies it out straight away)
    static ANSWER: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

/// Room for `len` bytes, for the page to write a command or its arguments into.
#[no_mangle]
pub extern "C" fn thinky_alloc(len: usize) -> *mut u8 {
    let mut v = Vec::<u8>::with_capacity(len.max(1));
    let p = v.as_mut_ptr();
    std::mem::forget(v); // the page frees it with thinky_free
    p
}

/// Give back what thinky_alloc took.
#[no_mangle]
pub unsafe extern "C" fn thinky_free(p: *mut u8, len: usize) {
    drop(Vec::from_raw_parts(p, 0, len.max(1)));
}

/// Run one command: `cmd` and its JSON arguments in, an answer out. The answer is 4 bytes of length
/// then JSON: {"ok": result} or {"error": message}, as the dev server answers.
#[no_mangle]
pub unsafe extern "C" fn thinky_call(cp: *const u8, cl: usize, ap: *const u8, al: usize) -> *mut u8 {
    let cmd = std::str::from_utf8(std::slice::from_raw_parts(cp, cl)).unwrap_or("");
    let args = serde_json::from_slice(std::slice::from_raw_parts(ap, al)).unwrap_or(serde_json::Value::Null);
    let out = STATE.with(|s| match dispatch(&mut s.borrow_mut(), cmd, args) {
        Ok(v) => serde_json::json!({ "ok": v }),
        Err(e) => serde_json::json!({ "error": e }),
    });
    let bytes = out.to_string().into_bytes();
    let mut buf = Vec::with_capacity(4 + bytes.len());
    buf.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
    buf.extend_from_slice(&bytes);
    ANSWER.with(|a| {
        *a.borrow_mut() = buf;
        a.borrow_mut().as_mut_ptr()
    })
}
