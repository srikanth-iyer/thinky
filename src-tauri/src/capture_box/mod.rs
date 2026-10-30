//! The "Add to journal" box as a native Windows window, so it appears at once even when the app
//! isn't running (no WebView2 to start): the Start-menu shortcut key (`--capture-box`), the
//! browser button (`leanoutliner://capture?…&box=1`) and `--capture` when adding straight away
//! fails. It is painted in the look's colours (look.txt, kept by the app), and its "+" button
//! opens a small menu: a picture or file,
//! a to-do, another page. The rules (when Enter adds, when it closes, its sizes) are in
//! outline_core::capture_box; this file draws them and talks to Windows. Nothing stays running:
//! it opens, adds, closes. If its window can't be made, `run` says so (main.rs logs it and opens the app).
//!
//! Re-entrancy: Windows calls back into `wndproc` from inside many calls (moving a window, setting
//! text, focus). The box's state is borrowed only briefly and never across such a call.

pub(crate) mod ffi;
mod files;
mod selftest;
pub use selftest::selftest;

use ffi::*;
use outline_core::app::App;
use outline_core::capture_box::{self as rules, colorref, mix, BoxColors, Canvas, Enter, Layout, Metrics, Rect, Rules};
use outline_core::Config;
use std::cell::RefCell;
use std::path::PathBuf;
use std::sync::atomic::{AtomicIsize, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

const CLASS: &str = "LeanOutlinerCaptureBox";
const ID_NOTE: usize = 1;
const ID_SEARCH: usize = 2;
/// The "+" menu's items (also sent by the self-test as WM_COMMAND).
pub(crate) const ID_FILE: usize = 101;
pub(crate) const ID_TODO: usize = 102;
pub(crate) const ID_PAGE: usize = 103;
const TIMER_CLOSE: usize = 1;
const TIMER_BLUR: usize = 2;
const TIMER_TEST: usize = 3;
const WM_INBOX: u32 = WM_APP + 1;
/// the self-test's "still open?" check (with the box's number)
const WM_TEST_LATE: u32 = WM_APP + 2;
const NOTE_HINT: &str = "Add a note…";
const SEARCH_HINT: &str = "Find a page…";
const PLUS_HINT: &str = "More: a picture or file, a to-do, another page (Alt+↓)";

/// The text boxes' own window procedures (the box listens in on them).
static NOTE_PROC: AtomicIsize = AtomicIsize::new(0);
static SEARCH_PROC: AtomicIsize = AtomicIsize::new(0);
/// Which box is open (a self-test opens several, one after another): late news for an earlier
/// one is dropped.
static GEN: AtomicU32 = AtomicU32::new(0);

/// News from the helper threads (reading the notes folder's settings, opening it, adding the
/// note, turning a pasted picture into PNG).
#[allow(clippy::large_enum_variant)] // one of each per box
enum News {
    Place(Result<(PathBuf, Config), String>),
    /// the result, and the files copied into assets/ on the way: (name in the note, name now)
    Added(Result<String, String>, Vec<(String, String)>),
    Pages(Result<Vec<(String, u64)>, String>),
    Picture(Result<Vec<u8>, String>),
}
static INBOX: Mutex<Vec<(u32, News)>> = Mutex::new(Vec::new());

/// The notes folder opened read-only with the app's own code (its index cache, only changed files
/// read again; the cache is never written): page names exactly as the app shows them, and the file
/// a page's note goes to (`App::page_target`, `App::capture_to_page`). (Which box, the folder.)
static VAULT: Mutex<(u32, Option<Result<App, String>>)> = Mutex::new((0, None));

/// A picture or file added to the note: named (and linked in the note) at once, but only copied
/// into assets/ when the note is added, so a box closed without adding leaves nothing behind.
#[derive(Clone)]
struct Attachment {
    /// its own name ("image.png" for a pasted picture)
    name: String,
    /// the millisecond its assets/ name is made from (`app::asset_file_name`)
    ms: u128,
    /// its link target in the note, "../assets/<file>"
    rel: String,
    source: Source,
}

#[derive(Clone)]
enum Source {
    File(PathBuf),
    /// a pasted picture, kept in memory (outside the notes folder) until the note is added
    Bytes(Arc<Vec<u8>>),
    /// already in assets/ (an earlier try copied it; that try failed later)
    Saved,
}

fn post(hwnd: isize, gen: u32, n: News) {
    INBOX.lock().unwrap_or_else(|p| p.into_inner()).push((gen, n));
    unsafe { PostMessageW(hwnd, WM_INBOX, 0, 0) };
}

/// Fonts at the box's DPI: the note (20 px), the bottom strip (12.5 px, and semibold), key caps
/// (11 px), the page list (14 px) and the to-do mark (11 px semibold).
struct Fonts {
    note: isize,
    foot: isize,
    bold: isize,
    kbd: isize,
    list: isize,
    pill: isize,
}

impl Fonts {
    fn new(dpi: u32) -> Fonts {
        let (regular, semibold) = faces();
        let mk = |px: f32, face: &Face| unsafe {
            CreateFontW(-((px * dpi as f32 / 96.0).round() as i32), 0, 0, 0, face.weight, 0, 0, 0, DEFAULT_CHARSET, 0, 0, CLEARTYPE_QUALITY, FF_SWISS, face.name.as_ptr())
        };
        Fonts { note: mk(20.0, regular), foot: mk(12.5, regular), bold: mk(12.5, semibold), kbd: mk(11.0, regular), list: mk(14.0, regular), pill: mk(11.0, semibold) }
    }
    fn delete(&self) {
        for f in [self.note, self.foot, self.bold, self.kbd, self.list, self.pill] {
            unsafe { DeleteObject(f) };
        }
    }
}

struct Face {
    name: Vec<u16>,
    weight: i32,
}

/// Segoe UI Variable (Windows 11) when it's there, else Segoe UI; and a semibold of it.
fn faces() -> &'static (Face, Face) {
    static F: std::sync::OnceLock<(Face, Face)> = std::sync::OnceLock::new();
    F.get_or_init(|| {
        let has = |name: &str| unsafe {
            let w = wide(name);
            let f = CreateFontW(-20, 0, 0, 0, 400, 0, 0, 0, DEFAULT_CHARSET, 0, 0, CLEARTYPE_QUALITY, FF_SWISS, w.as_ptr());
            let dc = GetDC(0);
            let old = SelectObject(dc, f);
            let mut got = [0u16; 64];
            let n = GetTextFaceW(dc, 64, got.as_mut_ptr());
            SelectObject(dc, old);
            ReleaseDC(0, dc);
            DeleteObject(f);
            let len = got.iter().position(|&c| c == 0).unwrap_or(64);
            n > 0 && String::from_utf16_lossy(&got[..len]).eq_ignore_ascii_case(name)
        };
        let base = if has("Segoe UI Variable Text") { "Segoe UI Variable Text" } else { "Segoe UI" };
        let semi = format!("{base} Semibold");
        let bold = if has(&semi) { Face { name: wide(&semi), weight: 400 } } else { Face { name: wide(base), weight: 600 } };
        (Face { name: wide(base), weight: 400 }, bold)
    })
}

/// What the bottom strip says.
#[derive(Clone, PartialEq)]
enum Say {
    Nothing,
    /// "To " + where the note goes
    Where(String),
    /// "✓ Added to …"
    Added(String),
    /// a problem, in red (the text stays)
    Problem(String),
    /// something going on ("Copying the picture…")
    Busy(String),
}

/// The part under the mouse.
#[derive(Clone, Copy, PartialEq, Debug)]
enum Hot {
    None,
    Plus,
    Close,
    Pill,
    Search,
    Row(usize),
}

/// A row of the page list.
#[derive(Clone, PartialEq, Debug)]
enum Row {
    /// the usual place (today's journal, or the quick capture page)
    Usual,
    Page(String),
    /// a page that doesn't exist yet
    New(String),
    /// a journal day (a journal title typed)
    Journal(String),
    /// a message ("Loading pages…"); not a choice
    Note(String),
    Problem(String),
}

struct Picker {
    rows: Vec<Row>,
    sel: usize,
    top: usize,
}

/// Where notes go, once the notes folder is read.
struct Place {
    root: PathBuf,
    cfg: Config,
    usual_today: bool,
    usual_page: String,
}

struct Ui {
    hwnd: isize,
    owner: isize,
    note: isize,
    search: isize,
    gen: u32,
    colors: BoxColors,
    surface_brush: isize,
    field_brush: isize,
    dpi: u32,
    fonts: Fonts,
    line_h: i32,
    list_line_h: i32,
    layout: Layout,
    rules: Rules,
    say: Say,
    place: Option<Place>,
    /// a page picked in the list (None: the usual place)
    page: Option<String>,
    todo: bool,
    picker: Option<Picker>,
    /// the page names (and change times), once the notes folder is open (`VAULT`)
    pages: Option<Result<Vec<(String, u64)>, String>>,
    /// pictures and files linked in the note, copied into assets/ when it's added
    attachments: Vec<Attachment>,
    /// the last millisecond an attachment was named with (each gets its own)
    last_ms: u128,
    /// pasted pictures still being turned into PNG
    working: u32,
    /// brought forward by a second press: the Enter guard starts again when it's in front
    rearm: bool,
    /// the note's text box shows a scroll bar; the search field shows
    scrolls: bool,
    searching: bool,
    /// the text boxes were empty (their placeholder showing)
    note_empty: bool,
    search_empty: bool,
    hot: Hot,
    pressed: Hot,
    tracking: bool,
    menu_open: bool,
    closing: bool,
    /// when the box lost the keyboard with nothing new in it while a mouse button was down (maybe
    /// dragging a file to it): it waits for the button before closing
    blur_wait: Option<Instant>,
    dropped: bool,
    t0: Instant,
    test: Option<selftest::Probe>,
}

thread_local! {
    static UI: RefCell<Option<Ui>> = const { RefCell::new(None) };
}

/// Use the box's state briefly (None while it is in use further up, or gone).
fn with<R>(f: impl FnOnce(&mut Ui) -> R) -> Option<R> {
    UI.with(|c| c.try_borrow_mut().ok().and_then(|mut g| g.as_mut().map(f)))
}

fn now_ms() -> u64 {
    with(|ui| ui.t0.elapsed().as_millis() as u64).unwrap_or(0)
}

/// Run the box until it closes. `prefill`: the words from a browser link (text, address).
/// Err when its window couldn't be made (nothing was shown: the caller logs it and opens the app).
/// A box that's already open (the shortcut pressed twice) is brought forward instead, with the
/// link's words, if any.
pub fn run(prefill: Option<(String, String)>) -> Result<(), String> {
    if bring_forward(prefill.as_ref()) {
        return Ok(());
    }
    run_box(prefill, None)
}

/// The box's window title (also how a second box finds the first).
const TITLE: &str = "Add to journal";

/// WM_COPYDATA's mark for the words a second box hands to the open one.
const COPY_WORDS: usize = 0x4C4F_0001;

/// The boxes open now (in any program): their windows.
fn open_boxes() -> Vec<isize> {
    let (class, title) = (wide(CLASS), wide(TITLE));
    let mut out = Vec::new();
    let mut h = 0;
    loop {
        h = unsafe { FindWindowExW(0, h, class.as_ptr(), title.as_ptr()) };
        if h == 0 || out.len() > 16 {
            return out;
        }
        out.push(h);
    }
}

/// A box is open: hand it the link's words and bring it forward. false: none is open, or the one
/// open is adding its note or closing (then this one opens a box of its own, so nothing is lost).
fn bring_forward(prefill: Option<&(String, String)>) -> bool {
    let words = prefill.map(|(t, u)| rules::prefill(Some((t.as_str(), u.as_str())), String::new).0).unwrap_or_default();
    for h in open_boxes() {
        // with when they were sent: a box that answers only after this one stopped waiting drops
        // them (this one has opened a box of its own by then)
        let data = rules::pack_words(unsafe { GetTickCount64() }, &words);
        let cd = COPYDATASTRUCT { data: COPY_WORDS, size: data.len() as u32, ptr: data.as_ptr().cast() };
        let mut taken = 0usize;
        let sent = unsafe { SendMessageTimeoutW(h, WM_COPYDATA, 0, &cd as *const COPYDATASTRUCT as isize, SMTO_ABORTIFHUNG, rules::HANDOVER_MS, &mut taken) };
        if sent != 0 && taken == 1 {
            to_front(h);
            return true;
        }
    }
    false
}

/// A second box's words (WM_COPYDATA): 1 if this box takes them (it's open for more), else 0.
/// Brought forward, it ignores Enter for half a second again: an Enter meant for the browser's
/// "Open Lean Outliner?" prompt must not add the note (with the link's words in it, unseen).
unsafe fn take_words(cd: &COPYDATASTRUCT) -> isize {
    if cd.data != COPY_WORDS || cd.ptr.is_null() {
        return 0;
    }
    let open = with(|ui| !ui.closing && !ui.rules.busy() && !ui.rules.is_added()).unwrap_or(false);
    if !open {
        return 0;
    }
    let bytes = std::slice::from_raw_parts(cd.ptr as *const u8, (cd.size as usize).min(4 << 20));
    let Some(words) = rules::unpack_words(bytes, GetTickCount64()) else { return 0 };
    let text = note_text();
    let now = now_ms();
    let Some((note, change)) = with(|ui| {
        ui.rules.ready(now);
        ui.rearm = true; // and again when it's in front
        (ui.note, ui.rules.more_words(&text, &words))
    }) else {
        return 0;
    };
    if let Some((new, select_all)) = change {
        let w = wide(&rules::to_crlf(&new));
        SetWindowTextW(note, w.as_ptr());
        let end = new.encode_utf16().count() + new.matches('\n').count();
        if select_all {
            SendMessageW(note, EM_SETSEL, 0, -1);
        } else {
            SendMessageW(note, EM_SETSEL, end, end as isize);
        }
        relayout(false);
        SendMessageW(note, EM_SCROLLCARET, 0, 0);
    }
    1
}

fn run_box(prefill: Option<(String, String)>, test: Option<selftest::Probe>) -> Result<(), String> {
    let made = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| unsafe { open(prefill, test) }));
    match made {
        Ok(Ok(())) => {}
        Ok(Err(e)) => {
            teardown();
            return Err(e);
        }
        Err(_) => {
            teardown();
            return Err("the box couldn't start".into());
        }
    }
    unsafe {
        let mut msg: MSG = std::mem::zeroed();
        while GetMessageW(&mut msg, 0, 0, 0) > 0 {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
    teardown();
    Ok(())
}

/// Free what the box made (its windows are gone by now, or never shown).
fn teardown() {
    let ui = UI.with(|c| c.try_borrow_mut().ok().and_then(|mut g| g.take()));
    if let Some(ui) = ui {
        unsafe {
            if IsWindow(ui.hwnd) != 0 {
                DestroyWindow(ui.hwnd);
            }
            if IsWindow(ui.owner) != 0 {
                DestroyWindow(ui.owner);
            }
            ui.fonts.delete();
            DeleteObject(ui.surface_brush);
            DeleteObject(ui.field_brush);
        }
    }
}

fn dpi_aware() {
    type SetCtx = unsafe extern "system" fn(isize) -> i32;
    unsafe {
        let ok = proc_addr("user32.dll", "SetProcessDpiAwarenessContext")
            .map(|p| std::mem::transmute::<*const std::ffi::c_void, SetCtx>(p)(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) != 0)
            .unwrap_or(false);
        if !ok {
            SetProcessDPIAware();
        }
    }
}

fn monitor_dpi(mon: isize) -> u32 {
    type GetDpi = unsafe extern "system" fn(isize, u32, *mut u32, *mut u32) -> i32;
    let (mut x, mut y) = (96u32, 96u32);
    if let Some(p) = proc_addr("shcore.dll", "GetDpiForMonitor") {
        let f: GetDpi = unsafe { std::mem::transmute(p) };
        if unsafe { f(mon, MDT_EFFECTIVE_DPI, &mut x, &mut y) } != 0 {
            x = 96;
        }
    }
    x.clamp(48, 960)
}

fn window_dpi(h: isize) -> u32 {
    type GetDpi = unsafe extern "system" fn(isize) -> u32;
    static F: std::sync::OnceLock<Option<usize>> = std::sync::OnceLock::new();
    match F.get_or_init(|| proc_addr("user32.dll", "GetDpiForWindow").map(|p| p as usize)) {
        Some(p) => unsafe { std::mem::transmute::<usize, GetDpi>(*p)(h) }.clamp(48, 960),
        None => 96,
    }
}

fn windows_build() -> u32 {
    static B: std::sync::OnceLock<u32> = std::sync::OnceLock::new();
    *B.get_or_init(|| unsafe {
        let mut v: OSVERSIONINFOW = std::mem::zeroed();
        v.size = std::mem::size_of::<OSVERSIONINFOW>() as u32;
        if RtlGetVersion(&mut v) == 0 {
            v.build
        } else {
            0
        }
    })
}

/// The window's frame around the drawn part, as Tauri draws its frameless windows (so the box
/// gets Windows' own shadow, rounded corners and thin border): the invisible resizing border on
/// the left, right and bottom, and on Windows 11 one line on top for the border.
fn insets(dpi: u32) -> RECT {
    type Metric = unsafe extern "system" fn(i32, u32) -> i32;
    static F: std::sync::OnceLock<Option<usize>> = std::sync::OnceLock::new();
    let f = *F.get_or_init(|| proc_addr("user32.dll", "GetSystemMetricsForDpi").map(|p| p as usize));
    let m = |i: i32| match f {
        Some(p) => unsafe { std::mem::transmute::<usize, Metric>(p)(i, dpi) },
        None => unsafe { GetSystemMetrics(i) },
    };
    let frame = m(SM_CXSIZEFRAME) + m(SM_CXPADDEDBORDER);
    let top = if windows_build() >= 22000 { (dpi as f32 / 96.0).round() as i32 } else { 0 };
    RECT { left: frame, top, right: frame, bottom: frame }
}

/// The monitor the box opens on: where the window in front is, else where the mouse is.
fn target_monitor() -> (isize, MONITORINFO) {
    unsafe {
        let mut mon = MonitorFromWindow(GetForegroundWindow(), MONITOR_DEFAULTTONULL);
        if mon == 0 {
            let mut p = POINT::default();
            GetCursorPos(&mut p);
            mon = MonitorFromPoint(p, MONITOR_DEFAULTTOPRIMARY);
        }
        let mut mi = MONITORINFO { size: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
        GetMonitorInfoW(mon, &mut mi);
        (mon, mi)
    }
}

fn line_height(font: isize) -> i32 {
    unsafe {
        let dc = GetDC(0);
        let old = SelectObject(dc, font);
        let mut tm = TEXTMETRICW::default();
        GetTextMetricsW(dc, &mut tm);
        SelectObject(dc, old);
        ReleaseDC(0, dc);
        tm.height.max(1)
    }
}

fn text_width(font: isize, s: &str) -> i32 {
    let w: Vec<u16> = s.encode_utf16().collect();
    unsafe {
        let dc = GetDC(0);
        let old = SelectObject(dc, font);
        let mut sz = SIZE::default();
        GetTextExtentPoint32W(dc, w.as_ptr(), w.len() as i32, &mut sz);
        SelectObject(dc, old);
        ReleaseDC(0, dc);
        sz.cx
    }
}

unsafe fn register_class() -> Result<isize, String> {
    let inst = GetModuleHandleW(std::ptr::null());
    let name = wide(CLASS);
    let wc = WNDCLASSEXW {
        size: std::mem::size_of::<WNDCLASSEXW>() as u32,
        style: 0,
        wndproc: Some(wndproc),
        cls_extra: 0,
        wnd_extra: 0,
        instance: inst,
        icon: 0,
        cursor: LoadCursorW(0, IDC_ARROW),
        background: 0,
        menu_name: std::ptr::null(),
        class_name: name.as_ptr(),
        icon_sm: 0,
    };
    // a second box in the same run (the self-test) finds the class already there
    static DONE: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    if !*DONE.get_or_init(|| RegisterClassExW(&wc) != 0) {
        return Err("couldn't register the window class".into());
    }
    Ok(inst)
}

/// Make the box and show it.
unsafe fn open(prefill: Option<(String, String)>, test: Option<selftest::Probe>) -> Result<(), String> {
    dpi_aware();
    let inst = register_class()?;
    let gen = GEN.fetch_add(1, Ordering::SeqCst) + 1;
    INBOX.lock().unwrap_or_else(|p| p.into_inner()).clear();
    let colors = rules::load_colors(outline_core::app::cache_dir().as_deref());
    let link = prefill.as_ref().map(|(t, u)| (t.as_str(), u.as_str()));
    // the clipboard's words, with a link to the web page they were copied from (he asked, Oct 30)
    let (text, from_clipboard) = rules::prefill(link, || outline_core::capture::with_source(&crate::win::clipboard_text(), files::clipboard_source(0).as_deref()));
    let (mon, mi) = target_monitor();
    let dpi = monitor_dpi(mon);
    let fonts = Fonts::new(dpi);
    let (line_h, list_line_h) = (line_height(fonts.note), line_height(fonts.list));
    let class = wide(CLASS);
    let title = wide(TITLE);
    // an owner that is never shown keeps the box out of the taskbar and Alt+Tab (its own title, so
    // a second box never takes it for an open box)
    let owner_title = wide("Lean Outliner capture");
    let owner = CreateWindowExW(0, class.as_ptr(), owner_title.as_ptr(), WS_POPUP, 0, 0, 0, 0, 0, 0, inst, std::ptr::null_mut());
    let quiet = test.is_some(); // the self-test never takes the keyboard
    let ex = WS_EX_TOPMOST | WS_EX_WINDOWEDGE | if quiet { WS_EX_NOACTIVATE } else { 0 };
    // made on its screen from the start (so it isn't rescaled when moved into place)
    let (mx, my) = (mi.monitor.left + 8, mi.monitor.top + 8);
    let hwnd = CreateWindowExW(ex, class.as_ptr(), title.as_ptr(), WS_CAPTION | WS_CLIPCHILDREN | WS_CLIPSIBLINGS, mx, my, 100, 100, owner, 0, inst, std::ptr::null_mut());
    let surface_brush = CreateSolidBrush(colorref(colors.surface));
    let field_brush = CreateSolidBrush(colorref(colors.surface2));
    let edit_class = wide("EDIT");
    let note = if hwnd != 0 {
        CreateWindowExW(0, edit_class.as_ptr(), std::ptr::null(), WS_CHILD | WS_VISIBLE | ES_MULTILINE | ES_AUTOVSCROLL, 0, 0, 10, 10, hwnd, ID_NOTE as isize, inst, std::ptr::null_mut())
    } else {
        0
    };
    let ui = Ui {
        hwnd,
        owner,
        note,
        search: 0,
        gen,
        colors,
        surface_brush,
        field_brush,
        dpi,
        fonts,
        line_h,
        list_line_h,
        layout: Layout::default(),
        rules: Rules::new(&text, from_clipboard),
        say: Say::Nothing,
        place: None,
        page: None,
        todo: false,
        picker: None,
        pages: None,
        attachments: Vec::new(),
        last_ms: 0,
        working: 0,
        rearm: false,
        scrolls: false,
        searching: false,
        note_empty: text.is_empty(),
        search_empty: true,
        hot: Hot::None,
        pressed: Hot::None,
        tracking: false,
        menu_open: false,
        closing: false,
        blur_wait: None,
        dropped: false,
        t0: Instant::now(),
        test,
    };
    UI.with(|c| *c.borrow_mut() = Some(ui));
    if hwnd == 0 || note == 0 || owner == 0 {
        return Err("couldn't make the window".into());
    }
    // Windows 11: rounded corners; the thin border in the look's line colour; dark looks dark
    let round = DWMWCP_ROUND;
    DwmSetWindowAttribute(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, (&round as *const u32).cast(), 4);
    let border = colorref(colors.line);
    DwmSetWindowAttribute(hwnd, DWMWA_BORDER_COLOR, (&border as *const u32).cast(), 4);
    if colors.dark() {
        let on = 1u32;
        DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, (&on as *const u32).cast(), 4);
        let theme = wide("DarkMode_Explorer");
        SetWindowTheme(note, theme.as_ptr(), std::ptr::null());
    }
    // the note's text box: Windows' own (typing in any language, the clipboard, right-click menu,
    // screen readers), listened in on for Enter, Esc and friends
    let font = with(|ui| ui.fonts.note).unwrap_or(0);
    SendMessageW(note, WM_SETFONT, font as usize, 0);
    SendMessageW(note, EM_SETMARGINS, EC_LEFTMARGIN | EC_RIGHTMARGIN, 0);
    SendMessageW(note, EM_SETLIMITTEXT, 1 << 24, 0);
    NOTE_PROC.store(SetWindowLongPtrW(note, GWLP_WNDPROC, note_proc as *const () as isize), Ordering::SeqCst);
    let t = wide(&rules::to_crlf(&text));
    SetWindowTextW(note, t.as_ptr());
    DragAcceptFiles(hwnd, 1);
    DragAcceptFiles(note, 1);
    relayout(true);
    // centred across the screen, a quarter of the way down
    let (w, h) = with(|ui| (ui.layout.w, ui.layout.h)).unwrap_or((640, 98));
    let ins = insets(dpi);
    let m = mi.monitor;
    let x = m.left + (m.right - m.left - w) / 2;
    let y = m.top + (m.bottom - m.top) / 4;
    SetWindowPos(hwnd, HWND_TOPMOST, x - ins.left, y - ins.top, w + ins.left + ins.right, h + ins.top + ins.bottom, SWP_NOACTIVATE | SWP_FRAMECHANGED);
    SendMessageW(note, EM_SETSEL, 0, -1);
    if quiet {
        ShowWindow(hwnd, SW_SHOWNOACTIVATE);
    } else {
        ShowWindow(hwnd, SW_SHOW);
        to_front(hwnd);
        SetFocus(note);
    }
    UpdateWindow(hwnd);
    let now = now_ms();
    with(|ui| ui.rules.ready(now));
    // the notes folder, opened read-only with the app's own code for the page list and adding to
    // another page; in the background (Google Drive can be slow; the box is already up)
    *VAULT.lock().unwrap_or_else(|p| p.into_inner()) = (gen, None);
    std::thread::spawn(move || {
        let r = std::panic::catch_unwind(|| outline_core::app::last_vault_or_why().and_then(|root| App::open_read_only(&root)))
            .unwrap_or_else(|_| Err("Couldn't open the notes folder.".into()));
        let pages = match &r {
            Ok(app) => Ok(app.page_list()),
            Err(e) => Err(format!("Couldn't read your pages: {e}")),
        };
        {
            let mut v = VAULT.lock().unwrap_or_else(|p| p.into_inner());
            if v.0 == gen {
                v.1 = Some(r);
            }
        }
        post(hwnd, gen, News::Pages(pages));
    });
    // where notes go: read the notes folder's settings without holding the box up (Google Drive
    // can be slow)
    std::thread::spawn(move || {
        let r = std::panic::catch_unwind(|| {
            let root = outline_core::app::last_vault_or_why()?;
            let cfg = outline_core::capture::read_config(&root).map_err(|e| format!("Couldn't read logseq/config.edn ({e})."))?;
            Ok((root, cfg))
        })
        .unwrap_or_else(|_| Err("Couldn't read the notes folder's settings.".into()));
        post(hwnd, gen, News::Place(r));
    });
    if quiet {
        selftest::shown(hwnd);
        SetTimer(hwnd, TIMER_TEST, 40, std::ptr::null());
    }
    Ok(())
}

/// Bring the box to the front with the keyboard. Windows allows that to a program just started
/// by a key or a click; if it refuses, a tap of Alt (as Tauri does) makes it allowed.
fn to_front(hwnd: isize) {
    unsafe {
        if SetForegroundWindow(hwnd) != 0 && GetForegroundWindow() == hwnd {
            return;
        }
        let scan = MapVirtualKeyW(VK_MENU as u32, 0) as u16;
        let key = |flags| INPUT { kind: INPUT_KEYBOARD, ki: KEYBDINPUT { vk: VK_LMENU, scan, flags, time: 0, extra: 0 }, pad: [0; 8] };
        let inputs = [key(KEYEVENTF_EXTENDEDKEY), key(KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP)];
        SendInput(2, inputs.as_ptr(), std::mem::size_of::<INPUT>() as i32);
        SetForegroundWindow(hwnd);
    }
}

fn get_text(h: isize) -> String {
    unsafe {
        let n = GetWindowTextLengthW(h);
        if n <= 0 {
            return String::new();
        }
        let mut buf = vec![0u16; n as usize + 1];
        let got = GetWindowTextW(h, buf.as_mut_ptr(), buf.len() as i32);
        String::from_utf16_lossy(&buf[..got.max(0) as usize])
    }
}

/// The note as typed (line breaks as `\n`).
fn note_text() -> String {
    with(|ui| ui.note).map(|h| rules::from_crlf(&get_text(h))).unwrap_or_default()
}

fn invalidate() {
    if let Some(h) = with(|ui| ui.hwnd) {
        unsafe { InvalidateRect(h, std::ptr::null(), 0) };
    }
}

/// The to-do mark's words: the workflow's marker (TODO, or LATER with the "now" workflow).
fn marker(ui: &Ui) -> &'static str {
    ui.place.as_ref().map_or("TODO", |p| p.cfg.todo_marker())
}

/// The keys shown at the right of the bottom strip.
fn keys(picking: bool) -> [(&'static str, &'static str); 3] {
    if picking {
        [("↑↓", "choose"), ("Enter", "pick"), ("Esc", "back")]
    } else {
        [("Enter", "add"), ("Shift+Enter", "new line"), ("Esc", "close")]
    }
}

/// Sizes of the bottom strip's key hints: (total width, [(key cap width, word width)]).
fn keys_width(f: &Fonts, scale: f32, picking: bool) -> (i32, Vec<(i32, i32)>) {
    let px = |v: f32| (v * scale).round() as i32;
    let mut total = 0;
    let mut parts = Vec::new();
    for (k, word) in keys(picking) {
        let kw = text_width(f.kbd, k) + 2 * px(5.0) + 2;
        let ww = text_width(f.foot, word);
        total += px(6.0) + kw + px(3.0) + ww;
        parts.push((kw, ww));
    }
    (total, parts)
}

thread_local! {
    /// relayout is running (moving a text box can make it report a change again)
    static LAYING: std::cell::Cell<u8> = const { std::cell::Cell::new(0) };
}

/// Work out the layout again (the text grew, a mark or the page list came or went, the bottom
/// strip has a longer message, another DPI) and fit the window and its text boxes to it.
fn relayout(first: bool) {
    // asked again while running: run once more at the end (no deeper)
    if LAYING.with(|l| l.get()) > 0 {
        LAYING.with(|l| l.set(2));
        return;
    }
    LAYING.with(|l| l.set(1));
    relayout_once(first);
    if LAYING.with(|l| l.get()) == 2 {
        LAYING.with(|l| l.set(1));
        relayout_once(false);
    }
    LAYING.with(|l| l.set(0));
}

fn relayout_once(first: bool) {
    let Some((hwnd, note, search, dpi, line_h, list_line_h, picking, rows, todo, mark, say, foot_font)) = with(|ui| {
        let rows = ui.picker.as_ref().map_or(0, |p| (p.rows.len() as i32).clamp(1, rules::LIST_ROWS));
        (ui.hwnd, ui.note, ui.search, ui.dpi, ui.line_h, ui.list_line_h, ui.picker.is_some(), rows, ui.todo, marker(ui), ui.say.clone(), ui.fonts.foot)
    }) else {
        return;
    };
    let scale = dpi as f32 / 96.0;
    let px = |v: f32| (v * scale).round() as i32;
    let pill_w = if todo {
        let f = with(|ui| ui.fonts.pill).unwrap_or(0);
        px(8.0) + px(10.0) + px(5.0) + text_width(f, mark) + px(8.0)
    } else {
        0
    };
    // a problem wraps over as many lines as it needs (the rest is one line)
    let foot_h = match &say {
        Say::Problem(msg) => {
            let keys_w = with(|ui| keys_width(&ui.fonts, scale, picking).0).unwrap_or(0);
            let avail = px(640.0) - px(18.0) - px(14.0) - keys_w - px(14.0) - px(26.0) - px(8.0);
            let w: Vec<u16> = msg.encode_utf16().collect();
            let mut r = RECT { left: 0, top: 0, right: avail.max(px(120.0)), bottom: 0 };
            unsafe {
                let dc = GetDC(0);
                let old = SelectObject(dc, foot_font);
                DrawTextW(dc, w.as_ptr(), w.len() as i32, &mut r, DT_CALCRECT | DT_WORDBREAK | DT_NOPREFIX);
                SelectObject(dc, old);
                ReleaseDC(0, dc);
            }
            r.bottom - r.top
        }
        _ => line_height(foot_font),
    };
    let mut m = Metrics { scale, line_h, lines: 1, pill_w, rows, list_line_h, foot_h };
    // The text box wraps at its width: when that changes (first time, the to-do mark, another
    // DPI), give it the new width first, then count its lines.
    let want = rules::layout(&m).note;
    let mut wr = RECT::default();
    unsafe { GetWindowRect(note, &mut wr) };
    let widened = first || wr.right - wr.left != want.w();
    if widened {
        unsafe { MoveWindow(note, want.l, want.t, want.w(), line_h * rules::MAX_LINES, 0) };
    }
    let lines_now = (unsafe { SendMessageW(note, EM_GETLINECOUNT, 0, 0) } as i32).max(1);
    m.lines = lines_now;
    let lay = rules::layout(&m);
    let scrolls = lines_now > rules::MAX_LINES;
    let Some((before, scrolled, searching)) = with(|ui| {
        let before = std::mem::replace(&mut ui.layout, lay);
        (before, std::mem::replace(&mut ui.scrolls, scrolls), std::mem::replace(&mut ui.searching, picking))
    }) else {
        return;
    };
    // move and repaint only what changed (this runs at every key press)
    unsafe {
        let n = lay.note;
        if widened || n != before.note {
            MoveWindow(note, n.l, n.t, n.w(), n.h(), 1);
        }
        // more than six lines: the text scrolls; else every line shows, from the first
        if scrolls != scrolled || first {
            ShowScrollBar(note, SB_VERT, scrolls as i32);
        }
        if scrolls {
            SendMessageW(note, EM_SCROLLCARET, 0, 0);
        } else {
            let top = SendMessageW(note, EM_GETFIRSTVISIBLELINE, 0, 0);
            if top > 0 {
                SendMessageW(note, EM_LINESCROLL, 0, -top);
            }
        }
        if search != 0 && (lay.search_text != before.search_text || picking != searching) {
            let s = lay.search_text;
            MoveWindow(search, s.l, s.t, s.w(), s.h(), 1);
            ShowWindow(search, if picking { SW_SHOWNOACTIVATE } else { SW_HIDE });
        }
        if !first && (lay.w != before.w || lay.h != before.h) {
            // grow or shrink downwards, the top staying put
            let ins = insets(dpi);
            SetWindowPos(hwnd, 0, 0, 0, lay.w + ins.left + ins.right, lay.h + ins.top + ins.bottom, SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE);
        }
        if first || lay != before {
            InvalidateRect(hwnd, std::ptr::null(), 0);
        }
    }
}

// ----- painting -----

/// Paint the box (all but its text boxes) into a picture, then onto the screen in one go.
unsafe fn paint(hwnd: isize) {
    let mut ps: PAINTSTRUCT = std::mem::zeroed();
    let dc = BeginPaint(hwnd, &mut ps);
    let mut cr = RECT::default();
    GetClientRect(hwnd, &mut cr);
    let (w, h) = (cr.right.max(1), cr.bottom.max(1));
    let mem = CreateCompatibleDC(dc);
    let bi = BITMAPINFO::top_down(w, h);
    let mut bits: *mut std::ffi::c_void = std::ptr::null_mut();
    let bmp = CreateDIBSection(dc, &bi, DIB_RGB_COLORS, &mut bits, 0, 0);
    if bmp != 0 && !bits.is_null() {
        let old = SelectObject(mem, bmp);
        let px = std::slice::from_raw_parts_mut(bits as *mut u32, (w * h) as usize);
        if with(|ui| draw(ui, mem, Canvas { px, w, h })).is_some() {
            BitBlt(dc, 0, 0, w, h, mem, 0, 0, SRCCOPY);
        } else {
            InvalidateRect(hwnd, std::ptr::null(), 0); // busy right now: paint again soon
        }
        SelectObject(mem, old);
        DeleteObject(bmp);
    }
    DeleteDC(mem);
    EndPaint(hwnd, &ps);
}

/// Words at (x, y) (top left), one line.
unsafe fn words(dc: isize, font: isize, color: u32, x: i32, y: i32, max_w: i32, s: &str) -> i32 {
    let w: Vec<u16> = s.encode_utf16().collect();
    SelectObject(dc, font);
    SetTextColor(dc, colorref(color));
    let mut r = RECT { left: x, top: y, right: x + max_w.max(0), bottom: y + 400 };
    DrawTextW(dc, w.as_ptr(), w.len() as i32, &mut r, DT_SINGLELINE | DT_NOPREFIX | DT_END_ELLIPSIS);
    let mut sz = SIZE::default();
    GetTextExtentPoint32W(dc, w.as_ptr(), w.len() as i32, &mut sz);
    sz.cx.min(max_w.max(0))
}

/// The box: its background, the + button, the to-do mark, the page list and the bottom strip.
/// Shapes are painted into the pixels (smooth edges), then the words on top with Windows' text.
fn draw(ui: &Ui, dc: isize, mut cv: Canvas) {
    let c = ui.colors;
    let l = ui.layout;
    let s = ui.dpi as f32 / 96.0;
    let px = |v: f32| (v * s).round() as i32;
    let pxf = |v: f32| v * s;
    let shade = if c.dark() { 0xFFFFFF } else { 0x000000 };
    cv.fill(Rect::new(0, 0, cv.w, cv.h), c.surface);
    // the + button: the accent colour, darker (lighter in dark looks) under the mouse or pressed
    let t = l.tile;
    let tint = if ui.menu_open || ui.pressed == Hot::Plus { 0.22 } else if ui.hot == Hot::Plus { 0.12 } else { 0.0 };
    cv.round_rect(t.l as f32, t.t as f32, t.r as f32, t.b as f32, pxf(9.0), mix(c.accent, shade, tint));
    let (cx, cy, u) = ((t.l + t.r) as f32 / 2.0, (t.t + t.b) as f32 / 2.0, pxf(19.0) / 24.0);
    cv.line(cx, cy - 6.5 * u, cx, cy + 6.5 * u, 2.2 * u, c.accent_ink);
    cv.line(cx - 6.5 * u, cy, cx + 6.5 * u, cy, 2.2 * u, c.accent_ink);
    // the to-do mark: a small box and the marker word, in the accent colour on its tint
    let p = ui.layout.pill;
    if !p.is_empty() {
        let bg = mix(c.surface, c.accent, if ui.hot == Hot::Pill { 0.22 } else { 0.13 });
        cv.round_rect(p.l as f32, p.t as f32, p.r as f32, p.b as f32, pxf(6.0), bg);
        let (bx, by, bs) = (p.l as f32 + pxf(8.0), (p.t + p.b) as f32 / 2.0 - pxf(5.0), pxf(10.0));
        cv.round_rect(bx, by, bx + bs, by + bs, pxf(2.5), c.accent);
        cv.round_rect(bx + pxf(1.5), by + pxf(1.5), bx + bs - pxf(1.5), by + bs - pxf(1.5), pxf(1.2), bg);
    }
    // the page list: a search field and the rows, the chosen one tinted
    if let Some(pk) = &ui.picker {
        let f = l.search;
        cv.round_rect(f.l as f32, f.t as f32, f.r as f32, f.b as f32, pxf(8.0), c.line);
        cv.round_rect(f.l as f32 + 1.0, f.t as f32 + 1.0, f.r as f32 - 1.0, f.b as f32 - 1.0, pxf(8.0) - 1.0, c.surface2);
        for (i, _) in pk.rows.iter().enumerate().skip(pk.top).take(rules::LIST_ROWS as usize) {
            let y = l.rows.t + (i - pk.top) as i32 * l.row_h;
            let fill = if i == pk.sel {
                Some(mix(c.surface, c.accent, 0.14))
            } else if ui.hot == Hot::Row(i) {
                Some(mix(c.surface, c.ink, 0.05))
            } else {
                None
            };
            if let Some(fill) = fill {
                cv.round_rect(l.rows.l as f32, y as f32, l.rows.r as f32, (y + l.row_h) as f32, pxf(6.0), fill);
            }
        }
    }
    // the bottom strip: its own colour and a line on top
    let ft = l.foot;
    let line = px(1.0).max(1);
    cv.fill(Rect::new(0, ft.t, cv.w, ft.t + line), c.line_soft);
    cv.fill(Rect::new(0, ft.t + line, cv.w, ft.b.max(cv.h)), c.surface2);
    let x = l.close;
    if ui.hot == Hot::Close {
        cv.round_rect(x.l as f32, x.t as f32, x.r as f32, x.b as f32, pxf(7.0), c.line_soft);
    }
    let (xc, yc, xu) = ((x.l + x.r) as f32 / 2.0, (x.t + x.b) as f32 / 2.0, pxf(15.0) / 24.0);
    let xcol = if ui.hot == Hot::Close { c.ink } else { c.ink_faint };
    let xw = (1.3 * xu).max(1.0);
    cv.line(xc - 5.0 * xu, yc - 5.0 * xu, xc + 5.0 * xu, yc + 5.0 * xu, xw, xcol);
    cv.line(xc + 5.0 * xu, yc - 5.0 * xu, xc - 5.0 * xu, yc + 5.0 * xu, xw, xcol);
    // the key hints, right to left from the × button: a raised key cap, then its word
    let picking = ui.picker.is_some();
    let (keys_w, parts) = keys_width(&ui.fonts, s, picking);
    let mid = (ft.t + line + ft.b) / 2;
    // the app's icon at the strip's left, 16 px, the words after it (Canvas::logo in outline_core)
    cv.logo(pxf(14.0), mid as f32 - pxf(8.0), pxf(16.0));
    let foot_lh = line_height(ui.fonts.foot);
    let kbd_lh = line_height(ui.fonts.kbd);
    let kx0 = x.l - px(14.0) - keys_w;
    let mut kx = kx0;
    let mut caps = Vec::new();
    for (kw, ww) in &parts {
        kx += px(6.0);
        let (kt, kb) = (mid - kbd_lh / 2 - 1, mid + kbd_lh / 2 + 2);
        cv.round_rect(kx as f32, kt as f32, (kx + kw) as f32, kb as f32, pxf(5.0), c.line);
        cv.round_rect(kx as f32 + 1.0, kt as f32 + 1.0, (kx + kw) as f32 - 1.0, kb as f32 - 2.0, pxf(5.0) - 1.0, c.surface);
        caps.push((kx, kt + 1, *kw, kx + kw + px(3.0), *ww));
        kx += kw + px(3.0) + ww;
    }
    unsafe {
        GdiFlush();
        SetBkMode(dc, TRANSPARENT);
        for ((k, word), (kx, kt, kw, wx, ww)) in keys(picking).iter().zip(&caps) {
            let tw = text_width(ui.fonts.kbd, k);
            words(dc, ui.fonts.kbd, c.ink_soft, kx + (kw - tw) / 2, *kt + (mid - kt - kbd_lh / 2), tw + 2, k);
            words(dc, ui.fonts.foot, c.ink_faint, *wx, mid - foot_lh / 2, *ww + 2, word);
        }
        // the message at the left: where the note goes, a hint, "✓ Added", or a problem
        let left = px(38.0); // (after the icon)
        let avail = kx0 - px(14.0) - left;
        let y = mid - foot_lh / 2;
        // over the + button: what it holds (unless there's news to read)
        let hint = ui.hot == Hot::Plus && matches!(ui.say, Say::Nothing | Say::Where(_));
        match &ui.say {
            _ if hint => {
                words(dc, ui.fonts.foot, c.ink_faint, left, y, avail, PLUS_HINT);
            }
            Say::Where(place) => {
                let to = words(dc, ui.fonts.foot, c.ink_faint, left, y, avail, "To ");
                words(dc, ui.fonts.bold, c.ink_soft, left + to, y, avail - to, place);
            }
            Say::Added(m) => {
                words(dc, ui.fonts.bold, c.accent, left, y, avail, m);
            }
            Say::Busy(m) => {
                words(dc, ui.fonts.foot, c.ink_soft, left, y, avail, m);
            }
            Say::Problem(m) => {
                let w: Vec<u16> = m.encode_utf16().collect();
                SelectObject(dc, ui.fonts.foot);
                SetTextColor(dc, colorref(c.danger));
                let mut r = RECT { left, top: ft.t + line + px(6.0), right: left + avail.max(px(120.0)), bottom: ft.b - px(6.0) };
                let mut probe = r;
                DrawTextW(dc, w.as_ptr(), w.len() as i32, &mut probe, DT_CALCRECT | DT_WORDBREAK | DT_NOPREFIX);
                let th = probe.bottom - probe.top;
                r.top = mid - th / 2;
                r.bottom = r.top + th;
                DrawTextW(dc, w.as_ptr(), w.len() as i32, &mut r, DT_WORDBREAK | DT_NOPREFIX);
            }
            Say::Nothing => {}
        }
        // the to-do mark's word
        if !p.is_empty() {
            let pl = line_height(ui.fonts.pill);
            words(dc, ui.fonts.pill, c.accent, p.l + px(8.0) + px(10.0) + px(5.0), (p.t + p.b) / 2 - pl / 2, p.w(), marker(ui));
        }
        // the page list's rows
        if let Some(pk) = &ui.picker {
            let usual = ui.place.as_ref().map(|p| (p.usual_today, p.usual_page.clone()));
            for (i, row) in pk.rows.iter().enumerate().skip(pk.top).take(rules::LIST_ROWS as usize) {
                let y = l.rows.t + (i - pk.top) as i32 * l.row_h + (l.row_h - ui.list_line_h) / 2;
                let x0 = l.rows.l + px(12.0);
                let room = l.rows.w() - px(24.0);
                match row {
                    Row::Usual => {
                        let (today, page) = usual.clone().unwrap_or((true, String::new()));
                        let first = if today { "Today’s journal" } else { page.as_str() };
                        let w1 = words(dc, ui.fonts.list, c.ink, x0, y, room, first);
                        let extra = if today { format!("  {page}") } else { "  the usual place".to_string() };
                        words(dc, ui.fonts.list, c.ink_faint, x0 + w1, y, room - w1, &extra);
                    }
                    Row::Page(name) => {
                        words(dc, ui.fonts.list, c.ink, x0, y, room, name);
                    }
                    Row::New(name) => {
                        let w1 = words(dc, ui.fonts.list, c.accent, x0, y, room, "New page: ");
                        words(dc, ui.fonts.list, c.ink, x0 + w1, y, room - w1, &format!("“{name}”"));
                    }
                    Row::Journal(name) => {
                        let w1 = words(dc, ui.fonts.list, c.accent, x0, y, room, "Journal: ");
                        words(dc, ui.fonts.list, c.ink, x0 + w1, y, room - w1, name);
                    }
                    Row::Note(m) => {
                        words(dc, ui.fonts.list, c.ink_faint, x0, y, room, m);
                    }
                    Row::Problem(m) => {
                        words(dc, ui.fonts.list, c.danger, x0, y, room, m);
                    }
                }
            }
        }
        GdiFlush();
    }
}

/// "Add a note…" / "Find a page…" over an empty text box (Windows' multi-line text boxes have no
/// placeholder of their own).
unsafe fn placeholder(h: isize, text: &str) {
    if GetWindowTextLengthW(h) > 0 {
        return;
    }
    let Some((font, color)) = with(|ui| (if h == ui.note { ui.fonts.note } else { ui.fonts.list }, ui.colors.ink_faint)) else { return };
    let dc = GetDC(h);
    let old = SelectObject(dc, font);
    SetBkMode(dc, TRANSPARENT);
    SetTextColor(dc, colorref(color));
    let w: Vec<u16> = text.encode_utf16().collect();
    let mut r = RECT::default();
    GetClientRect(h, &mut r);
    HideCaret(h);
    DrawTextW(dc, w.as_ptr(), w.len() as i32, &mut r, DT_SINGLELINE | DT_NOPREFIX);
    ShowCaret(h);
    SelectObject(dc, old);
    ReleaseDC(h, dc);
}

// ----- what the box does -----

/// Close the box (once).
fn close() {
    let Some(hwnd) = with(|ui| {
        if ui.closing {
            None
        } else {
            ui.closing = true;
            Some(ui.hwnd)
        }
    })
    .flatten() else {
        return;
    };
    unsafe { DestroyWindow(hwnd) };
}

/// Esc, × or Alt+F4: close, but not while a note is being added.
fn request_close() {
    if with(|ui| ui.rules.may_close()).unwrap_or(true) {
        close();
    }
}

fn say(s: Say) {
    let wraps = matches!(s, Say::Problem(_));
    let changed = with(|ui| {
        let before = matches!(ui.say, Say::Problem(_));
        ui.say = s;
        before || wraps
    })
    .unwrap_or(false);
    if changed {
        relayout(false);
    }
    invalidate();
}

/// The strip says where the note goes again (after "Copying…"), unless there's news to read.
fn say_where() {
    let next = with(|ui| match ui.say {
        Say::Nothing | Say::Where(_) | Say::Busy(_) => Some(place_words(ui).map_or(Say::Nothing, |w| Say::Where(w.0))),
        _ => None,
    })
    .flatten();
    if let Some(s) = next {
        say(s);
    }
}

/// "Copying…" in the strip, unless there's news to read there.
fn say_busy(words: &str) {
    if with(|ui| matches!(ui.say, Say::Nothing | Say::Where(_) | Say::Busy(_))).unwrap_or(false) {
        say(Say::Busy(words.into()));
    }
}

/// The words for where a note goes: "today’s journal (October 26th, 2026)", or a page.
fn place_words(ui: &Ui) -> Option<(String, String)> {
    if let Some(p) = &ui.page {
        return Some((p.clone(), p.clone()));
    }
    let pl = ui.place.as_ref()?;
    Some((outline_core::capture::place_label(pl.usual_today, &pl.usual_page), pl.usual_page.clone()))
}

/// Enter in the note: add it (in the background, so a slow Google Drive doesn't freeze the box).
fn on_enter() {
    // a pasted picture still being turned into a file: Enter waits for it (nothing is lost)
    if with(|ui| ui.working > 0 && !ui.rules.busy()).unwrap_or(false) {
        say(Say::Busy("Still copying the picture; press Enter again in a moment.".into()));
        return;
    }
    let text = note_text();
    let now = now_ms();
    let Some(act) = with(|ui| ui.rules.enter(now, &text)) else { return };
    match act {
        Enter::Ignore => {}
        Enter::Close => close(),
        Enter::Add(t) => {
            let Some((hwnd, note, gen, page, todo, root, atts)) = with(|ui| {
                // the pictures and files still linked in the note
                let atts: Vec<Attachment> = ui.attachments.iter().filter(|a| t.contains(&a.rel)).cloned().collect();
                (ui.hwnd, ui.note, ui.gen, ui.page.clone(), ui.todo, ui.place.as_ref().map(|p| p.root.clone()), atts)
            }) else {
                return;
            };
            unsafe { SendMessageW(note, EM_SETREADONLY, 1, 0) };
            if atts.iter().any(|a| !matches!(a.source, Source::Saved)) {
                say_busy("Copying…");
            }
            std::thread::spawn(move || {
                let mut copied = Vec::new();
                let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| add_note(gen, root, page, &t, todo, &atts, &mut copied)))
                    .unwrap_or_else(|_| Err("Something went wrong while adding the note; it wasn't added.".into()));
                post(hwnd, gen, News::Added(r, copied));
            });
        }
    }
}

/// Use the notes folder this box opened (`VAULT`), waiting for it if another thread has it. Only
/// helper threads wait for it; the box's own thread only ever tries (`try_lock`).
fn with_vault<R>(gen: u32, f: impl FnOnce(&mut App) -> Result<R, String>) -> Result<R, String> {
    let mut v = VAULT.lock().unwrap_or_else(|p| p.into_inner());
    if v.0 != gen {
        return Err("Something went wrong while adding the note; it wasn't added.".into());
    }
    match &mut v.1 {
        Some(Ok(app)) => f(app),
        Some(Err(e)) => Err(format!("{e} So nothing was added to that page.")),
        None => Err("Your pages are still being read; try again in a moment.".into()),
    }
}

/// Add the note (on a helper thread): first where it goes is worked out again (a page as the app
/// finds it, or the usual place), then the pictures and files it links are copied into assets/
/// (only now: a box closed without adding leaves nothing behind), then the note is added there.
/// `copied`: the files copied (the link planned in the note, the link now).
fn add_note(gen: u32, root: Option<PathBuf>, page: Option<String>, text: &str, todo: bool, atts: &[Attachment], copied: &mut Vec<(String, String)>) -> Result<String, String> {
    let (today, time) = crate::win::local_now();
    let root = match &page {
        Some(p) => with_vault(gen, |app| app.page_target(p).map(|_| app.root.clone()))?,
        None => {
            let root = match root {
                Some(r) => r,
                None => outline_core::app::last_vault_or_why()?,
            };
            outline_core::capture::read_config(&root).map_err(|e| format!("Couldn't read logseq/config.edn ({e}), so nothing was added."))?;
            root
        }
    };
    for a in atts {
        let bytes: std::borrow::Cow<[u8]> = match &a.source {
            Source::Saved => continue,
            Source::Bytes(b) => std::borrow::Cow::Borrowed(&b[..]),
            Source::File(p) => std::borrow::Cow::Owned(std::fs::read(p).map_err(|e| format!("Couldn't read {} ({e}), so nothing was added.", a.name))?),
        };
        let rel = outline_core::app::save_asset_file_at(&root, &a.name, &bytes, a.ms).map_err(|e| format!("{}: {e} Nothing was added.", a.name))?;
        copied.push((a.rel.clone(), rel));
    }
    let text = rules::swap_all(text, copied);
    match page {
        Some(p) => with_vault(gen, |app| app.capture_to_page(&p, &text, "", todo, today, &time)),
        None => outline_core::capture::capture_to_usual(&root, &text, "", todo, today, &time),
    }
}

/// Files copied into assets/ by an add that then failed: the note links them as saved, and a
/// second try doesn't copy them again.
fn note_saved(copied: &[(String, String)]) {
    if copied.is_empty() {
        return;
    }
    let Some(note) = with(|ui| {
        for a in ui.attachments.iter_mut() {
            if let Some((_, now)) = copied.iter().find(|(was, _)| *was == a.rel) {
                a.rel = now.clone();
                a.source = Source::Saved;
            }
        }
        ui.note
    }) else {
        return;
    };
    if copied.iter().any(|(a, b)| a != b) {
        let text = note_text();
        let new = rules::swap_all(&text, copied);
        if new != text {
            let w = wide(&rules::to_crlf(&new));
            unsafe { SetWindowTextW(note, w.as_ptr()) };
            relayout(false);
        }
    }
}

/// News from a helper thread.
fn on_inbox() {
    let (gen, quiet) = with(|ui| (ui.gen, ui.test.is_some())).unwrap_or((0, false));
    let news: Vec<News> = std::mem::take(&mut *INBOX.lock().unwrap_or_else(|p| p.into_inner())).into_iter().filter(|(g, _)| *g == gen).map(|(_, n)| n).collect();
    for n in news {
        if quiet && matches!(n, News::Place(_)) {
            selftest::place_known();
        }
        match n {
            News::Place(Ok((root, cfg))) => {
                let today = crate::win::local_now().0;
                let (usual_today, usual_page) = outline_core::capture::default_place(&cfg, today);
                let label = with(|ui| {
                    ui.place = Some(Place { root, cfg, usual_today, usual_page });
                    place_words(ui).map(|w| w.0)
                })
                .flatten();
                if let Some(label) = label {
                    if with(|ui| matches!(ui.say, Say::Nothing | Say::Where(_))).unwrap_or(false) {
                        say(Say::Where(label));
                    }
                }
                relayout(false); // the to-do mark's word may have changed (LATER)
                invalidate();
                refilter();
            }
            News::Place(Err(e)) => say(Say::Problem(e)),
            News::Added(r, copied) => {
                note_saved(&copied);
                added(r);
            }
            News::Pages(r) => {
                with(|ui| ui.pages = Some(r));
                refilter();
            }
            News::Picture(r) => {
                with(|ui| ui.working = ui.working.saturating_sub(1));
                match r {
                    Ok(png) => {
                        say_where();
                        attach("image.png".into(), Source::Bytes(Arc::new(png)));
                    }
                    Err(e) => say(Say::Problem(e)),
                }
            }
        }
    }
}

/// How adding went: "✓ Added to …" and the box closes, or the problem (the text stays).
fn added(r: Result<String, String>) {
    match r {
        Ok(_) => {
            let Some((hwnd, dest)) = with(|ui| {
                ui.rules.added();
                (ui.hwnd, place_words(ui).map_or_else(|| "your notes".to_string(), |w| w.1))
            }) else {
                return;
            };
            say(Say::Added(format!("✓ Added to {dest}")));
            unsafe { SetTimer(hwnd, TIMER_CLOSE, rules::CLOSE_AFTER_ADD_MS, std::ptr::null()) };
        }
        Err(e) => {
            let Some(note) = with(|ui| {
                ui.rules.failed();
                ui.note
            }) else {
                return;
            };
            unsafe { SendMessageW(note, EM_SETREADONLY, 0, 0) };
            say(Say::Problem(e));
        }
    }
}

fn toggle_todo() {
    if with(|ui| ui.rules.busy()).unwrap_or(true) {
        return;
    }
    with(|ui| ui.todo = !ui.todo);
    relayout(false);
    invalidate();
    focus_note();
}

fn focus_note() {
    if let Some((note, quiet)) = with(|ui| (ui.note, ui.test.is_some())) {
        if !quiet {
            unsafe { SetFocus(note) };
        }
    }
}

/// The "+" menu (the button, or Alt+↓ in the note).
fn open_menu(by_key: bool) {
    let Some((hwnd, tile, todo, picked)) = with(|ui| {
        if ui.rules.busy() || ui.menu_open {
            return None;
        }
        ui.menu_open = true;
        Some((ui.hwnd, ui.layout.tile, ui.todo, ui.page.is_some()))
    })
    .flatten() else {
        return;
    };
    invalidate();
    let cmd = unsafe {
        let m = CreatePopupMenu();
        let items = [
            (ID_FILE, 0, "&Picture or file…"),
            (ID_TODO, if todo { MF_CHECKED } else { 0 }, "&To-do"),
            (ID_PAGE, 0, if picked { "&Another page…" } else { "Add to &another page…" }),
        ];
        for (id, flags, label) in items {
            let w = wide(label);
            AppendMenuW(m, MF_STRING | flags, id, w.as_ptr());
        }
        let mut pt = POINT { x: tile.l, y: tile.b + (4.0 * with(|ui| ui.dpi).unwrap_or(96) as f32 / 96.0) as i32 };
        ClientToScreen(hwnd, &mut pt);
        if by_key {
            PostMessageW(hwnd, WM_KEYDOWN, VK_DOWN as usize, 0); // the first item lit, as menus do from the keyboard
        }
        let cmd = TrackPopupMenuEx(m, TPM_RETURNCMD | TPM_NONOTIFY, pt.x, pt.y, hwnd, std::ptr::null());
        DestroyMenu(m);
        cmd
    };
    with(|ui| {
        ui.menu_open = false;
        ui.pressed = Hot::None;
    });
    invalidate();
    command(cmd as usize);
}

fn command(id: usize) {
    match id {
        ID_FILE => {
            let Some(hwnd) = with(|ui| ui.hwnd) else { return };
            let paths = files::pick(hwnd);
            if !paths.is_empty() {
                caret_after_selection();
                add_files(paths);
            }
            focus_note();
        }
        ID_TODO => toggle_todo(),
        ID_PAGE => open_picker(),
        _ => {}
    }
}

/// Pictures or files picked, dropped or pasted: linked in the note at the caret now, copied into
/// assets/ when the note is added (`add_note`). Folders and files over 25 MB are refused.
fn add_files(paths: Vec<PathBuf>) {
    if with(|ui| ui.rules.busy()).unwrap_or(true) {
        return;
    }
    let mut problems = Vec::new();
    for p in paths {
        let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        match std::fs::metadata(&p) {
            Ok(m) if m.is_dir() => problems.push(format!("{name} is a folder; only files can be added.")),
            Ok(m) if m.len() == 0 => problems.push(format!("{name} is empty.")),
            Ok(m) if m.len() as usize > outline_core::app::MAX_ASSET_BYTES => problems.push(format!("{name} is over 25 MB; pick a smaller one.")),
            Ok(_) => attach(name, Source::File(p)),
            Err(e) => problems.push(format!("Couldn't read {name} ({e}).")),
        }
    }
    if !problems.is_empty() {
        say(Say::Problem(problems.join(" ")));
    }
}

/// Link a picture or file at the caret, under the name it will have in assets/ (each its own
/// millisecond, so no two in a note share one); kept in `attachments` until the note is added.
fn attach(name: String, source: Source) {
    let Some(rel) = with(|ui| {
        if ui.rules.busy() {
            return None;
        }
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis());
        let ms = now.max(ui.last_ms + 1);
        ui.last_ms = ms;
        let rel = format!("../assets/{}", outline_core::app::asset_file_name(&name, ms));
        ui.attachments.push(Attachment { name: name.clone(), ms, rel: rel.clone(), source });
        Some(rel)
    })
    .flatten() else {
        return;
    };
    insert_at_caret(&outline_core::app::asset_markdown(&name, &rel));
}

/// A pasted picture that's a bitmap: turned into PNG on a helper thread ("Copying…" meanwhile),
/// then linked (`News::Picture`). `hbm` is a copy of its own, freed here.
fn paste_bitmap(hbm: isize) {
    let Some((hwnd, gen)) = with(|ui| {
        ui.working += 1;
        (ui.hwnd, ui.gen)
    }) else {
        unsafe { DeleteObject(hbm) };
        return;
    };
    say_busy("Copying…");
    std::thread::spawn(move || {
        let png = std::panic::catch_unwind(|| files::png_from_bitmap(hbm)).ok().flatten();
        unsafe { DeleteObject(hbm) };
        post(hwnd, gen, News::Picture(png.ok_or_else(|| "Couldn't turn the pasted picture into a file.".to_string())));
    });
}

/// The caret to the end of the selection: a dropped or picked file is linked there, never in place
/// of selected words (a link's words come selected).
fn caret_after_selection() {
    let Some(note) = with(|ui| ui.note) else { return };
    unsafe {
        let (mut a, mut b) = (0u32, 0u32);
        SendMessageW(note, EM_GETSEL, &mut a as *mut u32 as usize, &mut b as *mut u32 as isize);
        if a != b {
            SendMessageW(note, EM_SETSEL, b as usize, b as isize);
        }
    }
}

/// Put `s` in the note where the caret is, with a space on either side where it touches words.
fn insert_at_caret(s: &str) {
    let Some(note) = with(|ui| ui.note) else { return };
    unsafe {
        let (mut a, mut b) = (0u32, 0u32);
        SendMessageW(note, EM_GETSEL, &mut a as *mut u32 as usize, &mut b as *mut u32 as isize);
        let t: Vec<u16> = get_text(note).encode_utf16().collect();
        let before = (a as usize).checked_sub(1).and_then(|i| t.get(i)).is_some_and(|&c| !char::from_u32(c as u32).is_some_and(char::is_whitespace));
        let after = t.get(b as usize).is_some_and(|&c| !char::from_u32(c as u32).is_some_and(char::is_whitespace));
        let s = format!("{}{s}{}", if before { " " } else { "" }, if after { " " } else { "" });
        let w = wide(&s);
        SendMessageW(note, EM_REPLACESEL, 1, w.as_ptr() as isize);
    }
}

/// Ctrl+Backspace / Ctrl+Delete: take the whole word before / after the caret.
fn delete_word(h: isize, back: bool) {
    unsafe {
        let (mut a, mut b) = (0u32, 0u32);
        SendMessageW(h, EM_GETSEL, &mut a as *mut u32 as usize, &mut b as *mut u32 as isize);
        if a == b {
            let t: Vec<u16> = get_text(h).encode_utf16().collect();
            if back {
                a = rules::word_before(&t, a as usize) as u32;
            } else {
                b = rules::word_after(&t, b as usize) as u32;
            }
            SendMessageW(h, EM_SETSEL, a as usize, b as isize);
        }
        let empty = [0u16];
        SendMessageW(h, EM_REPLACESEL, 1, empty.as_ptr() as isize);
    }
}

// ----- the page list -----

fn open_picker() {
    let Some((hwnd, search, busy)) = with(|ui| (ui.hwnd, ui.search, ui.rules.busy())) else { return };
    if busy {
        return;
    }
    let search = if search == 0 { make_search(hwnd) } else { search };
    if search == 0 {
        return;
    }
    with(|ui| {
        ui.search = search;
        if ui.picker.is_none() {
            ui.picker = Some(Picker { rows: Vec::new(), sel: 0, top: 0 });
        }
    });
    unsafe { SetWindowTextW(search, wide("").as_ptr()) };
    refilter();
    if with(|ui| ui.test.is_none()).unwrap_or(false) {
        unsafe { SetFocus(search) };
    }
}

fn make_search(hwnd: isize) -> isize {
    unsafe {
        let class = wide("EDIT");
        let inst = GetModuleHandleW(std::ptr::null());
        let h = CreateWindowExW(0, class.as_ptr(), std::ptr::null(), WS_CHILD | ES_AUTOHSCROLL, 0, 0, 10, 10, hwnd, ID_SEARCH as isize, inst, std::ptr::null_mut());
        if h == 0 {
            return 0;
        }
        let font = with(|ui| ui.fonts.list).unwrap_or(0);
        SendMessageW(h, WM_SETFONT, font as usize, 0);
        SendMessageW(h, EM_SETMARGINS, EC_LEFTMARGIN | EC_RIGHTMARGIN, 0);
        SEARCH_PROC.store(SetWindowLongPtrW(h, GWLP_WNDPROC, search_proc as *const () as isize), Ordering::SeqCst);
        if with(|ui| ui.colors.dark()).unwrap_or(false) {
            let theme = wide("DarkMode_Explorer");
            SetWindowTheme(h, theme.as_ptr(), std::ptr::null());
        }
        h
    }
}

/// The rows for what's typed in the search field.
fn refilter() {
    let Some((search, gen)) = with(|ui| ui.picker.as_ref().map(|_| (ui.search, ui.gen))).flatten() else { return };
    let q = if search != 0 { get_text(search) } else { String::new() };
    // what's typed, as the app would take it: a page (an alias, a title:: name), a journal day, a
    // new page, or why it can't be a page's name. Only tried: the folder may be busy adding.
    let typed = match q.trim() {
        "" => None,
        name => match VAULT.try_lock() {
            Ok(v) if v.0 == gen => match &v.1 {
                Some(Ok(app)) => Some(app.page_target(name)),
                _ => None,
            },
            _ => None,
        },
    };
    with(|ui| {
        let usual = ui.place.as_ref().map(|p| outline_core::capture::place_label(p.usual_today, &p.usual_page).to_lowercase());
        let pages = &ui.pages;
        let Some(pk) = ui.picker.as_mut() else { return };
        let ql = q.trim().to_lowercase();
        let mut rows = Vec::new();
        if ql.is_empty() || usual.as_ref().is_some_and(|u| u.contains(&ql)) {
            rows.push(Row::Usual);
        }
        match pages {
            None => rows.push(Row::Note("Loading pages…".into())),
            Some(Err(e)) => rows.push(Row::Problem(e.clone())),
            Some(Ok(names)) => {
                for i in rules::rank_pages(names, &q, 50) {
                    rows.push(Row::Page(names[i].0.clone()));
                }
                match typed {
                    Some(Ok(t)) if t.journal => rows.push(Row::Journal(t.name)),
                    Some(Ok(t)) if rows.contains(&Row::Page(t.name.clone())) => {}
                    Some(Ok(t)) if t.exists => rows.push(Row::Page(t.name)),
                    Some(Ok(t)) => rows.push(Row::New(t.name)),
                    Some(Err(e)) => rows.push(Row::Problem(e)),
                    None => {}
                }
                if rows.is_empty() {
                    rows.push(Row::Note("No pages yet".into()));
                }
            }
        }
        pk.rows = rows;
        pk.sel = pk.rows.iter().position(pickable).unwrap_or(0);
        pk.top = 0;
    });
    relayout(false);
    invalidate();
}

fn pickable(r: &Row) -> bool {
    matches!(r, Row::Usual | Row::Page(_) | Row::New(_) | Row::Journal(_))
}

/// Move the chosen row by `by` (skipping messages), keeping it in view.
fn move_sel(by: i32) {
    with(|ui| {
        let Some(pk) = ui.picker.as_mut() else { return };
        let n = pk.rows.len() as i32;
        if n == 0 {
            return;
        }
        let mut i = pk.sel as i32;
        let step = by.signum();
        let mut left = by.abs();
        while left > 0 {
            let mut j = i + step;
            while j >= 0 && j < n && !pickable(&pk.rows[j as usize]) {
                j += step;
            }
            if j < 0 || j >= n {
                break;
            }
            i = j;
            left -= 1;
        }
        pk.sel = i as usize;
        let shown = rules::LIST_ROWS as usize;
        if pk.sel < pk.top {
            pk.top = pk.sel;
        } else if pk.sel >= pk.top + shown {
            pk.top = pk.sel + 1 - shown;
        }
    });
    invalidate();
}

/// Pick a row: the note will go there.
fn pick(i: usize) {
    let Some(row) = with(|ui| ui.picker.as_ref().and_then(|p| p.rows.get(i).cloned())).flatten() else { return };
    let page = match row {
        Row::Usual => None,
        Row::Page(n) | Row::New(n) | Row::Journal(n) => Some(n),
        _ => return,
    };
    let label = with(|ui| {
        ui.page = page;
        ui.picker = None;
        place_words(ui).map(|w| w.0)
    })
    .flatten();
    if let Some(l) = label {
        if with(|ui| !matches!(ui.say, Say::Added(_))).unwrap_or(false) {
            say(Say::Where(l));
        }
    }
    relayout(false);
    focus_note();
}

fn close_picker() {
    with(|ui| ui.picker = None);
    relayout(false);
    focus_note();
}

// ----- window procedures -----

fn shift_down() -> bool {
    unsafe { GetKeyState(VK_SHIFT) < 0 }
}
/// Ctrl, without Alt: AltGr (which Windows reports as Ctrl+Alt) types letters such as ą or €,
/// so it must never trigger a Ctrl shortcut.
fn ctrl_only() -> bool {
    unsafe { GetKeyState(VK_CONTROL) < 0 && GetKeyState(VK_MENU) >= 0 }
}

/// Run a window procedure's body; a bug in it must not take the box (and the typing) down.
fn guarded(h: isize, m: u32, w: usize, l: isize, prev: isize, f: impl FnOnce() -> Option<isize>) -> isize {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)) {
        Ok(Some(r)) => r,
        Ok(None) => unsafe {
            if prev != 0 {
                CallWindowProcW(prev, h, m, w, l)
            } else {
                DefWindowProcW(h, m, w, l)
            }
        },
        Err(_) => {
            outline_core::log::record("Capture box: internal error (caught)");
            unsafe {
                if prev != 0 {
                    CallWindowProcW(prev, h, m, w, l)
                } else {
                    DefWindowProcW(h, m, w, l)
                }
            }
        }
    }
}

/// The note's text box, listened in on.
unsafe extern "system" fn note_proc(h: isize, m: u32, w: usize, l: isize) -> isize {
    let prev = NOTE_PROC.load(Ordering::SeqCst);
    guarded(h, m, w, l, prev, || {
        let busy = || with(|ui| ui.rules.busy()).unwrap_or(false);
        match m {
            WM_KEYDOWN => match w as i32 {
                VK_RETURN if !shift_down() => {
                    on_enter();
                    Some(0)
                }
                VK_ESCAPE => {
                    request_close();
                    Some(0)
                }
                VK_TAB => Some(0),
                0x41 if ctrl_only() => {
                    SendMessageW(h, EM_SETSEL, 0, -1);
                    Some(0)
                }
                VK_SPACE if ctrl_only() => {
                    open_menu(true);
                    Some(0)
                }
                VK_BACK | VK_DELETE if ctrl_only() => {
                    if !busy() {
                        delete_word(h, w as i32 == VK_BACK);
                    }
                    Some(0)
                }
                _ => None,
            },
            WM_SYSKEYDOWN if w as i32 == VK_DOWN => {
                open_menu(true);
                Some(0)
            }
            // Enter, Esc, Tab, Ctrl+A, Ctrl+Space and Ctrl+Backspace as characters: handled above
            WM_CHAR => match w {
                0x0D if !shift_down() => Some(0),
                0x1B | 0x09 | 0x01 | 0x7F => Some(0),
                0x20 if ctrl_only() => Some(0),
                _ => None,
            },
            WM_SYSCHAR => Some(0),
            WM_PASTE => {
                if busy() {
                    return Some(0);
                }
                match files::clipboard_items(h) {
                    // words copied from a web page come with a link to their place on it (he asked,
                    // Oct 30); other text pastes as Windows does
                    files::Clip::Text => {
                        let src = files::clipboard_source(h);
                        let words = if src.is_some() { crate::win::clipboard_text() } else { String::new() };
                        let with = outline_core::capture::with_source(&words, src.as_deref());
                        if src.is_none() || with == words {
                            return None;
                        }
                        let w = wide(&rules::to_crlf(&with));
                        SendMessageW(h, EM_REPLACESEL, 1, w.as_ptr() as isize);
                        Some(0)
                    }
                    files::Clip::Files(paths) => {
                        add_files(paths);
                        Some(0)
                    }
                    files::Clip::Picture(png) => {
                        attach("image.png".into(), Source::Bytes(Arc::new(png)));
                        Some(0)
                    }
                    files::Clip::Bitmap(hbm) => {
                        paste_bitmap(hbm);
                        Some(0)
                    }
                    files::Clip::Problem(e) => {
                        say(Say::Problem(e));
                        Some(0)
                    }
                }
            }
            WM_DROPFILES => {
                let parent = GetParent(h);
                Some(SendMessageW(parent, WM_DROPFILES, w, l))
            }
            WM_PAINT => {
                let r = CallWindowProcW(prev, h, m, w, l);
                placeholder(h, NOTE_HINT);
                Some(r)
            }
            _ => None,
        }
    })
}

/// The page list's search field, listened in on.
unsafe extern "system" fn search_proc(h: isize, m: u32, w: usize, l: isize) -> isize {
    let prev = SEARCH_PROC.load(Ordering::SeqCst);
    guarded(h, m, w, l, prev, || match m {
        WM_KEYDOWN => match w as i32 {
            VK_UP => {
                move_sel(-1);
                Some(0)
            }
            VK_DOWN => {
                move_sel(1);
                Some(0)
            }
            VK_PRIOR => {
                move_sel(-rules::LIST_ROWS);
                Some(0)
            }
            VK_NEXT => {
                move_sel(rules::LIST_ROWS);
                Some(0)
            }
            VK_RETURN => {
                // not in the half-second after the box appeared or was brought forward (an Enter
                // meant for another window)
                let now = now_ms();
                if let Some(i) = with(|ui| ui.picker.as_ref().map(|p| p.sel).filter(|_| !ui.rules.too_soon(now))).flatten() {
                    pick(i);
                }
                Some(0)
            }
            VK_ESCAPE => {
                close_picker();
                Some(0)
            }
            VK_TAB => Some(0),
            0x41 if ctrl_only() => {
                SendMessageW(h, EM_SETSEL, 0, -1);
                Some(0)
            }
            VK_BACK | VK_DELETE if ctrl_only() => {
                delete_word(h, w as i32 == VK_BACK);
                Some(0)
            }
            _ => None,
        },
        WM_CHAR => match w {
            0x0D | 0x1B | 0x09 | 0x01 | 0x7F => Some(0),
            _ => None,
        },
        WM_PAINT => {
            let r = CallWindowProcW(prev, h, m, w, l);
            placeholder(h, SEARCH_HINT);
            Some(r)
        }
        _ => None,
    })
}

/// What's under the mouse (client coordinates).
fn hot_at(x: i32, y: i32) -> Hot {
    with(|ui| {
        let l = &ui.layout;
        if l.tile.contains(x, y) {
            return Hot::Plus;
        }
        if l.close.contains(x, y) {
            return Hot::Close;
        }
        if !l.pill.is_empty() && l.pill.contains(x, y) {
            return Hot::Pill;
        }
        if let Some(pk) = &ui.picker {
            if l.search.contains(x, y) {
                return Hot::Search;
            }
            if l.rows.contains(x, y) && l.row_h > 0 {
                let i = pk.top + ((y - l.rows.t) / l.row_h) as usize;
                if i < pk.rows.len() && pickable(&pk.rows[i]) {
                    return Hot::Row(i);
                }
            }
        }
        Hot::None
    })
    .unwrap_or(Hot::None)
}

fn set_hot(h: Hot) {
    let changed = with(|ui| {
        let c = ui.hot != h;
        ui.hot = h;
        c
    })
    .unwrap_or(false);
    if changed {
        invalidate();
    }
}

/// The box lost the keyboard to another program: close it if nothing new is in it. If a mouse
/// button is down (maybe dragging a file to the box), wait until it's let go, and stay if
/// something was dropped.
fn on_blur() {
    let text = note_text();
    let Some((close_now, hwnd)) = with(|ui| (ui.rules.close_on_blur(&text) && ui.working == 0, ui.hwnd)) else { return };
    if !close_now {
        return;
    }
    let button = unsafe { if GetSystemMetrics(SM_SWAPBUTTON) != 0 { VK_RBUTTON } else { VK_LBUTTON } };
    if unsafe { GetAsyncKeyState(button) } < 0 {
        with(|ui| {
            ui.blur_wait = Some(Instant::now());
            ui.dropped = false;
        });
        unsafe { SetTimer(hwnd, TIMER_BLUR, 60, std::ptr::null()) };
    } else {
        close();
    }
}

/// While waiting after a click elsewhere: once the button is up (and a moment for a drop to
/// arrive), close unless something was dropped, it came back to the front, or it has words now.
fn blur_tick(hwnd: isize) {
    let button = unsafe { if GetSystemMetrics(SM_SWAPBUTTON) != 0 { VK_RBUTTON } else { VK_LBUTTON } };
    let down = unsafe { GetAsyncKeyState(button) } < 0;
    let Some((since, dropped)) = with(|ui| ui.blur_wait.map(|t| (t, ui.dropped))).flatten() else {
        unsafe { KillTimer(hwnd, TIMER_BLUR) };
        return;
    };
    if down {
        with(|ui| ui.blur_wait = Some(Instant::now()));
        return;
    }
    if since.elapsed().as_millis() < 200 {
        return;
    }
    unsafe { KillTimer(hwnd, TIMER_BLUR) };
    with(|ui| ui.blur_wait = None);
    let front = unsafe { GetForegroundWindow() } == hwnd;
    let text = note_text();
    if !dropped && !front && with(|ui| ui.rules.close_on_blur(&text) && ui.working == 0).unwrap_or(false) {
        close();
    }
}

unsafe extern "system" fn wndproc(h: isize, m: u32, w: usize, l: isize) -> isize {
    guarded(h, m, w, l, 0, || {
        // the hidden owner window, or the box before its state exists: Windows' defaults (the
        // frame is set once the state exists, SWP_FRAMECHANGED in `open`)
        if !with(|ui| ui.hwnd == h).unwrap_or(false) {
            return None;
        }
        match m {
            WM_NCCALCSIZE if w != 0 => {
                // the frame Tauri's frameless windows have (see `insets`)
                let ins = insets(with(|ui| ui.dpi).unwrap_or_else(|| window_dpi(h)));
                let p = &mut *(l as *mut NCCALCSIZE_PARAMS);
                p.rgrc[0].left += ins.left;
                p.rgrc[0].top += ins.top;
                p.rgrc[0].right -= ins.right;
                p.rgrc[0].bottom -= ins.bottom;
                Some(0)
            }
            WM_NCHITTEST => {
                let mut pt = point_of(l);
                ScreenToClient(h, &mut pt);
                let lay = with(|ui| ui.layout).unwrap_or_default();
                if pt.x < 0 || pt.y < 0 || pt.x >= lay.w || pt.y >= lay.h {
                    return None; // the frame
                }
                // the buttons and the list take clicks; everywhere else drags the box
                Some(if hot_at(pt.x, pt.y) == Hot::None { HTCAPTION } else { HTCLIENT })
            }
            // no window menu on a right-click of the box's edge, no maximising on a double-click
            WM_NCRBUTTONUP | WM_NCLBUTTONDBLCLK => Some(0),
            WM_CONTEXTMENU if w as isize == h => Some(0),
            WM_ERASEBKGND => Some(1),
            WM_PAINT => {
                paint(h);
                Some(0)
            }
            WM_CTLCOLOREDIT | WM_CTLCOLORSTATIC => {
                let (c, field) = with(|ui| (ui.colors, if l == ui.search { (ui.field_brush, ui.colors.surface2) } else { (ui.surface_brush, ui.colors.surface) })).unwrap_or_default();
                let dc = w as isize;
                SetTextColor(dc, colorref(c.ink));
                SetBkColor(dc, colorref(field.1));
                Some(field.0)
            }
            WM_COMMAND => {
                let (id, code) = (loword(w) as usize, hiword(w));
                match (id, code) {
                    (ID_NOTE, EN_UPDATE) if l != 0 => relayout(false),
                    (ID_NOTE | ID_SEARCH, EN_CHANGE) if l != 0 => {
                        // the placeholder came or went: the text box repaints all of itself
                        let empty = GetWindowTextLengthW(l) == 0;
                        let flipped = with(|ui| {
                            let was = if id == ID_NOTE { &mut ui.note_empty } else { &mut ui.search_empty };
                            std::mem::replace(was, empty) != empty
                        })
                        .unwrap_or(true);
                        if flipped {
                            InvalidateRect(l, std::ptr::null(), 1);
                        }
                        if id == ID_SEARCH {
                            refilter();
                        }
                    }
                    (ID_NOTE, EN_SETFOCUS) if l != 0 => {
                        // back to the note: the page list closes
                        if with(|ui| ui.picker.is_some()).unwrap_or(false) {
                            with(|ui| ui.picker = None);
                            relayout(false);
                        }
                    }
                    (ID_FILE | ID_TODO | ID_PAGE, _) if l == 0 => command(id),
                    _ => {}
                }
                Some(0)
            }
            WM_ACTIVATE => {
                if loword(w) != 0 {
                    let now = now_ms();
                    with(|ui| {
                        ui.rules.focused();
                        ui.blur_wait = None;
                        if std::mem::take(&mut ui.rearm) {
                            ui.rules.ready(now);
                        }
                    });
                    let target = with(|ui| if ui.picker.is_some() && ui.search != 0 { ui.search } else { ui.note }).unwrap_or(0);
                    SetFocus(target);
                } else {
                    // the keyboard went to another window: ours (the file picker) doesn't count
                    let mut pid = 0u32;
                    if l != 0 {
                        GetWindowThreadProcessId(l, &mut pid);
                    }
                    if l == 0 || pid != GetCurrentProcessId() {
                        on_blur();
                    }
                }
                Some(0)
            }
            WM_SETFOCUS => {
                let target = with(|ui| if ui.picker.is_some() && ui.search != 0 { ui.search } else { ui.note }).unwrap_or(0);
                if target != 0 {
                    SetFocus(target);
                }
                Some(0)
            }
            WM_SETCURSOR => {
                if loword(l as usize) == HTCLIENT as u32 {
                    let mut pt = POINT::default();
                    GetCursorPos(&mut pt);
                    ScreenToClient(h, &mut pt);
                    let hot = hot_at(pt.x, pt.y);
                    let id = if hot == Hot::Search { IDC_IBEAM } else if hot != Hot::None { IDC_HAND } else { IDC_ARROW };
                    SetCursor(LoadCursorW(0, id));
                    return Some(1);
                }
                None
            }
            WM_MOUSEMOVE => {
                let p = point_of(l);
                if !with(|ui| ui.tracking).unwrap_or(true) {
                    let mut t = TRACKMOUSEEVENT { size: std::mem::size_of::<TRACKMOUSEEVENT>() as u32, flags: TME_LEAVE, track: h, hover_time: 0 };
                    TrackMouseEvent(&mut t);
                    with(|ui| ui.tracking = true);
                }
                set_hot(hot_at(p.x, p.y));
                Some(0)
            }
            WM_MOUSELEAVE => {
                with(|ui| ui.tracking = false);
                set_hot(Hot::None);
                Some(0)
            }
            WM_LBUTTONDOWN => {
                let p = point_of(l);
                let hot = hot_at(p.x, p.y);
                if hot == Hot::Search {
                    if let Some(s) = with(|ui| ui.search) {
                        SetFocus(s);
                    }
                    return Some(0);
                }
                with(|ui| ui.pressed = hot);
                SetCapture(h);
                invalidate();
                Some(0)
            }
            WM_LBUTTONUP => {
                // what was pressed, taken before letting the mouse go: ReleaseCapture sends
                // WM_CAPTURECHANGED, which forgets it
                let pressed = with(|ui| std::mem::replace(&mut ui.pressed, Hot::None)).unwrap_or(Hot::None);
                ReleaseCapture();
                let p = point_of(l);
                let hot = hot_at(p.x, p.y);
                invalidate();
                if pressed == hot {
                    match hot {
                        Hot::Plus => open_menu(false),
                        Hot::Close => request_close(),
                        Hot::Pill => toggle_todo(),
                        Hot::Row(i) => pick(i),
                        _ => {}
                    }
                }
                Some(0)
            }
            WM_CAPTURECHANGED => {
                with(|ui| ui.pressed = Hot::None);
                invalidate();
                Some(0)
            }
            WM_MOUSEWHEEL => {
                let delta = ((w >> 16) & 0xFFFF) as u16 as i16 as i32;
                let moved = with(|ui| {
                    let pk = ui.picker.as_mut()?;
                    let shown = rules::LIST_ROWS as usize;
                    let max_top = pk.rows.len().saturating_sub(shown);
                    let steps = -(delta / 40);
                    pk.top = (pk.top as i32 + steps).clamp(0, max_top as i32) as usize;
                    Some(())
                })
                .flatten();
                if moved.is_some() {
                    invalidate();
                }
                Some(0)
            }
            WM_DROPFILES => {
                let drop = w as isize;
                let paths = files::drop_paths(drop);
                DragFinish(drop);
                with(|ui| ui.dropped = true);
                if !paths.is_empty() {
                    caret_after_selection();
                    add_files(paths);
                }
                if with(|ui| ui.test.is_none()).unwrap_or(false) {
                    to_front(h);
                    focus_note();
                }
                Some(0)
            }
            WM_INBOX => {
                on_inbox();
                Some(0)
            }
            WM_COPYDATA => Some(if l != 0 { take_words(&*(l as *const COPYDATASTRUCT)) } else { 0 }),
            WM_TEST_LATE => {
                selftest::late(w);
                Some(0)
            }
            WM_TIMER => {
                match w {
                    TIMER_CLOSE => {
                        KillTimer(h, TIMER_CLOSE);
                        close();
                    }
                    TIMER_BLUR => blur_tick(h),
                    TIMER_TEST => selftest::tick(),
                    _ => {}
                }
                Some(0)
            }
            WM_DPICHANGED => {
                // moved to a screen with another scale: new fonts and sizes, where Windows suggests
                let dpi = loword(w).clamp(48, 960);
                let r = *(l as *const RECT);
                if with(|ui| ui.dpi == dpi).unwrap_or(true) {
                    return Some(0);
                }
                let Some((note, search, old_fonts)) = with(|ui| {
                    let f = std::mem::replace(&mut ui.fonts, Fonts::new(dpi));
                    ui.dpi = dpi;
                    ui.line_h = line_height(ui.fonts.note);
                    ui.list_line_h = line_height(ui.fonts.list);
                    (ui.note, ui.search, f)
                }) else {
                    return Some(0);
                };
                let (nf, lf) = with(|ui| (ui.fonts.note, ui.fonts.list)).unwrap_or((0, 0));
                SendMessageW(note, WM_SETFONT, nf as usize, 1);
                if search != 0 {
                    SendMessageW(search, WM_SETFONT, lf as usize, 1);
                }
                old_fonts.delete();
                relayout(true);
                let (lw, lh) = with(|ui| (ui.layout.w, ui.layout.h)).unwrap_or((640, 98));
                let ins = insets(dpi);
                SetWindowPos(h, 0, r.left, r.top, lw + ins.left + ins.right, lh + ins.top + ins.bottom, SWP_NOZORDER | SWP_NOACTIVATE);
                Some(0)
            }
            WM_CLOSE => {
                request_close();
                Some(0)
            }
            WM_DESTROY => {
                PostQuitMessage(0);
                Some(0)
            }
            _ => None,
        }
    })
}
