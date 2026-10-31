//! A check of the native box on a real Windows: `lean-outliner --capture-box-selftest <folder>`
//! (CI runs it on GitHub's Windows machine). It works only in a folder of its own that it makes
//! fresh, <folder>\capbox-selftest (an earlier run's is replaced; any other folder of that name is
//! left alone and the check refuses to run), with a made-up notes folder and cache inside, never
//! his real ones (it checks the cache folder really is its own before opening any box). It opens
//! the box four times, works it with messages (the box never takes the keyboard itself), and
//! writes result.txt there: how many milliseconds after the program started the box was on
//! screen, then PASS/FAIL lines; pictures of the box go to shots/. Not for a computer you use: it uses the
//! clipboard and starts the program a second time.

use super::*;
use std::cell::Cell;
use std::path::Path;

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Script {
    /// light colours, words from a link: the Enter guard, growing, adding, closing
    Light,
    /// dark colours, the clipboard's words: to-do, a pasted picture, a dropped file, the page list
    /// (clicked and typed), another page
    Dark,
    /// mouse clicks, the shortcut pressed a second time, and × closing a box without adding
    Click,
    /// the notes folder can't be reached: the problem shows, the text stays, Esc closes
    Problem,
}

pub struct Probe {
    script: Script,
    step: usize,
    since: Instant,
    started: Instant,
}

thread_local! {
    static LOG: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) };
    static DIR: RefCell<PathBuf> = const { RefCell::new(PathBuf::new()) };
    static SHOWN: Cell<bool> = const { Cell::new(false) };
    static WHERE: Cell<bool> = const { Cell::new(false) };
    static ADDED_AT: Cell<Option<Instant>> = const { Cell::new(None) };
    /// the program started a second time (the shortcut pressed again)
    static SECOND: RefCell<Option<std::process::Child>> = const { RefCell::new(None) };
}

/// The file that marks a folder as this check's own (only such a folder is ever replaced).
const MARK: &str = "capbox-selftest.txt";

const CONFIG: &str = r#"{:preferred-workflow :now
 :journal/page-title-format "MMMM do, yyyy"
 :quick-capture-templates {:text "**{time}** {text}"}
 :quick-capture-options {:insert-today? true}}"#;

fn log(line: String) {
    LOG.with(|l| l.borrow_mut().push(line));
}
fn check(ok: bool, what: &str, detail: impl AsRef<str>) {
    if ok {
        log(format!("PASS {what}"));
    } else {
        log(format!("FAIL {what}: {}", detail.as_ref()));
    }
}

/// Milliseconds since this program started.
fn since_start() -> u64 {
    unsafe {
        let (mut created, mut a, mut b, mut c, mut now) = (FILETIME::default(), FILETIME::default(), FILETIME::default(), FILETIME::default(), FILETIME::default());
        GetProcessTimes(GetCurrentProcess(), &mut created, &mut a, &mut b, &mut c);
        GetSystemTimePreciseAsFileTime(&mut now);
        now.ticks().saturating_sub(created.ticks()) / 10_000
    }
}

/// The notes folder's settings are read (where the note goes is known): note when, the first time.
pub(super) fn place_known() {
    if !WHERE.with(|s| s.replace(true)) {
        log(format!("where_ms={}", since_start()));
    }
}

/// The box is on screen (called once it's painted): note how long that took from the start.
pub(super) fn shown(_hwnd: isize) {
    unsafe { DwmFlush() };
    if !SHOWN.with(|s| s.replace(true)) {
        log(format!("shown_ms={}", since_start()));
    }
}

fn hwnd() -> isize {
    with(|ui| ui.hwnd).unwrap_or(0)
}
fn note() -> isize {
    with(|ui| ui.note).unwrap_or(0)
}
fn key(h: isize, vk: i32) {
    unsafe { SendMessageW(h, WM_KEYDOWN, vk as usize, 0) };
}
fn set_note(s: &str) {
    let w = wide(&rules::to_crlf(s));
    unsafe { SetWindowTextW(note(), w.as_ptr()) };
    relayout(false);
}
fn saying() -> Say {
    with(|ui| ui.say.clone()).unwrap_or(Say::Nothing)
}
fn busy() -> bool {
    with(|ui| ui.rules.busy()).unwrap_or(false)
}
fn rows() -> Vec<Row> {
    with(|ui| ui.picker.as_ref().map(|p| p.rows.clone())).flatten().unwrap_or_default()
}
fn search(q: &str) {
    let s = with(|ui| ui.search).unwrap_or(0);
    let w = wide(q);
    unsafe { SetWindowTextW(s, w.as_ptr()) };
    refilter();
}
/// A click (mouse down and up) in the middle of `r`, as Windows sends it.
fn click(r: Rect) {
    let (x, y) = ((r.l + r.r) / 2, (r.t + r.b) / 2);
    let at = (((y as u16) as isize) << 16) | (x as u16) as isize;
    let h = hwnd();
    unsafe {
        SendMessageW(h, WM_LBUTTONDOWN, MK_LBUTTON, at);
        SendMessageW(h, WM_LBUTTONUP, 0, at);
    }
}
/// Where row `i` of the page list is.
fn row_rect(i: usize) -> Rect {
    with(|ui| {
        let l = ui.layout;
        let top = ui.picker.as_ref().map_or(0, |p| p.top);
        let y = l.rows.t + (i as i32 - top as i32) * l.row_h;
        Rect::new(l.rows.l, y, l.rows.r, y + l.row_h)
    })
    .unwrap_or_default()
}
/// The files in the made-up notes folder's assets/.
fn assets() -> Vec<String> {
    DIR.with(|d| files_in(&d.borrow().join("notes").join("assets")))
}

/// A picture of the box as it is on screen now (with Windows' shadow around it).
fn shot(name: &str) {
    let h = hwnd();
    unsafe {
        RedrawWindow(h, std::ptr::null(), 0, RDW_INVALIDATE | RDW_UPDATENOW | RDW_ALLCHILDREN);
        DwmFlush();
        let mut r = RECT::default();
        GetWindowRect(h, &mut r);
        let m = 24;
        let r = RECT { left: r.left - m, top: r.top - m, right: r.right + m, bottom: r.bottom + m };
        match files::screenshot(r) {
            Some(png) => {
                let path = DIR.with(|d| d.borrow().join("shots").join(format!("{name}.png")));
                let _ = std::fs::write(path, png);
            }
            None => log(format!("NOTE no picture for {name}")),
        }
    }
}

/// Some(true) once `ok`, Some(false) when `limit` ms went by without it, None: keep waiting.
fn waited(ms: u64, limit: u64, ok: bool) -> Option<bool> {
    if ok {
        Some(true)
    } else if ms > limit {
        Some(false)
    } else {
        None
    }
}

enum Go {
    Wait,
    Next,
    /// the box closes by itself now
    Stop,
}

fn today_title() -> String {
    Config::from_edn(CONFIG).journal_title(crate::win::local_now().0)
}
fn today_file() -> PathBuf {
    let cfg = Config::from_edn(CONFIG);
    DIR.with(|d| d.borrow().join("notes").join(cfg.journal_rel_path(crate::win::local_now().0)))
}

/// Light colours, words from a browser link.
fn light(step: usize, ms: u64) -> Go {
    match step {
        0 => {
            key(note(), VK_RETURN); // right as it appears, as if meant for another window
            Go::Next
        }
        1 => {
            if ms < 120 {
                return Go::Wait;
            }
            check(!busy() && unsafe { IsWindow(hwnd()) } != 0 && !today_file().exists(), "An Enter right as the box appears is ignored", "a note was added or the box closed");
            Go::Next
        }
        2 => {
            let Some(ok) = waited(ms, 5000, matches!(saying(), Say::Where(_) | Say::Problem(_))) else { return Go::Wait };
            let want = format!("today’s journal ({})", today_title());
            check(ok && saying() == Say::Where(want.clone()), "It says where the note goes", format!("{:?}", say_text(&saying())));
            check(note_text() == "Self-test from a link https://example.com", "The words from the link are in the box", note_text());
            let (mut a, mut b) = (0u32, 0u32);
            unsafe { SendMessageW(note(), EM_GETSEL, &mut a as *mut u32 as usize, &mut b as *mut u32 as isize) };
            check(a == 0 && b as usize == note_text().encode_utf16().count(), "…and selected, so typing replaces them", format!("{a}..{b}"));
            shot("1-light");
            Go::Next
        }
        3 => {
            if now_ms() < 700 {
                return Go::Wait;
            }
            let one = with(|ui| ui.layout.h).unwrap_or(0);
            set_note("Light test ✓ ünïcödé\nsecond line");
            let two = with(|ui| ui.layout.h).unwrap_or(0);
            check(two > one, "The box grows with the text", format!("{one} → {two}"));
            shot("2-two-lines");
            key(note(), VK_RETURN);
            Go::Next
        }
        4 => {
            let added = with(|ui| ui.rules.is_added()).unwrap_or(false);
            let Some(ok) = waited(ms, 8000, added) else { return Go::Wait };
            check(ok && saying() == Say::Added(format!("✓ Added to {}", today_title())), "Enter adds the note and says so", say_text(&saying()));
            ADDED_AT.with(|a| a.set(Some(Instant::now())));
            shot("3-added");
            Go::Stop
        }
        _ => Go::Stop,
    }
}

/// Dark colours, the clipboard's words: a to-do with a pasted picture and a dropped file, added
/// to another page.
fn dark(step: usize, ms: u64) -> Go {
    let h = hwnd();
    match step {
        0 => {
            let Some(ok) = waited(ms, 5000, matches!(saying(), Say::Where(_))) else { return Go::Wait };
            check(ok, "The dark box says where the note goes", say_text(&saying()));
            check(note_text() == "copied text", "The clipboard's words are in the box", note_text());
            // words copied in a browser: the clipboard says which page (Build 33; with_source makes
            // the link, tested in core/tests/clip.rs)
            let ok = files::set_clipboard_html(h, "a copied passage", "https://example.org/page");
            let src = files::clipboard_source(h);
            check(ok && src.as_deref() == Some("https://example.org/page"), "Words copied from a web page: the box finds the page's address", format!("{ok} {src:?}"));
            Go::Next
        }
        1 => {
            unsafe { SendMessageW(h, WM_COMMAND, ID_TODO, 0) };
            let (todo, pill, mark) = with(|ui| (ui.todo, !ui.layout.pill.is_empty(), marker(ui))).unwrap_or((false, false, ""));
            check(todo && pill && mark == "LATER", "To-do: a LATER mark shows (the \"now\" workflow)", format!("{todo} {pill} {mark}"));
            Go::Next
        }
        2 => {
            // a click on the mark takes the to-do off; the menu puts it back
            click(with(|ui| ui.layout.pill).unwrap_or_default());
            let off = with(|ui| !ui.todo && ui.layout.pill.is_empty()).unwrap_or(false);
            check(off, "Clicking the to-do mark takes it off", "still a to-do");
            unsafe { SendMessageW(h, WM_COMMAND, ID_TODO, 0) };
            Go::Next
        }
        3 => {
            let end = note_text().encode_utf16().count();
            unsafe { SendMessageW(note(), EM_SETSEL, end, end as isize) };
            let ok = files::set_clipboard(h, None, files::test_bitmap());
            check(ok, "(the test put a picture on the clipboard)", "the clipboard was busy");
            unsafe { SendMessageW(note(), WM_PASTE, 0, 0) };
            Go::Next
        }
        4 => {
            // turned into PNG away from the box's thread, then linked
            let Some(ok) = waited(ms, 5000, note_text().contains("![image](../assets/image_")) else { return Go::Wait };
            check(ok, "A pasted picture is linked in the note", format!("{} / {}", note_text(), say_text(&saying())));
            check(assets().is_empty(), "…but not copied into assets/ before the note is added", assets().join(", "));
            Go::Next
        }
        5 => {
            let pdf = DIR.with(|d| d.borrow().join("Quarterly report.pdf"));
            let _ = std::fs::write(&pdf, b"%PDF-1.4 self-test");
            let drop = files::make_drop(std::slice::from_ref(&pdf));
            unsafe { SendMessageW(h, WM_DROPFILES, drop as usize, 0) };
            let text = note_text();
            check(text.contains(" [Quarterly report.pdf](../assets/Quarterly_report_") && assets().is_empty(), "A dropped file is linked (copied only when the note is added)", format!("{text} / {:?}", assets()));
            Go::Next
        }
        6 => {
            unsafe { SendMessageW(h, WM_COMMAND, ID_PAGE, 0) };
            Go::Next
        }
        7 => {
            // the pages as the app has them: read with its own code, in the background
            let r = rows();
            let Some(ok) = waited(ms, 8000, r.contains(&Row::Page("Project ideas".into()))) else { return Go::Wait };
            check(ok && r.first() == Some(&Row::Usual) && r.contains(&Row::Page("Reading list".into())), "The page list shows today's journal and the pages", format!("{r:?}"));
            check(r.contains(&Row::Page("Favourite books".into())) && !r.contains(&Row::Page("fav_books".into())), "A page named by title:: is listed by that name", format!("{r:?}"));
            shot("4-pages");
            Go::Next
        }
        8 => {
            // a click on a row picks it
            search("read");
            let i = rows().iter().position(|r| *r == Row::Page("Reading list".into()));
            if let Some(i) = i {
                click(row_rect(i));
            }
            let (page, open) = with(|ui| (ui.page.clone(), ui.picker.is_some())).unwrap_or((None, true));
            check(page.as_deref() == Some("Reading list") && !open && saying() == Say::Where("Reading list".into()), "Clicking a page in the list picks it", format!("{i:?} {page:?} {}", say_text(&saying())));
            unsafe { SendMessageW(h, WM_COMMAND, ID_PAGE, 0) };
            Go::Next
        }
        9 => {
            if now_ms() < 700 {
                return Go::Wait; // Enter in the list waits out the half-second guard too
            }
            // what's typed, as the app takes it: a journal day, a name no page can have, a new page
            search("October 20th, 2026");
            let r = rows();
            check(r.contains(&Row::Journal("October 20th, 2026".into())) && !r.iter().any(|x| matches!(x, Row::New(_))), "A date offers that day's journal, not a new page", format!("{r:?}"));
            search("/");
            let r = rows();
            check(r.iter().any(|x| matches!(x, Row::Problem(m) if m.contains("can't be the name of a page"))), "A name no page can have says why", format!("{r:?}"));
            search("proj");
            let r = rows();
            let first = with(|ui| ui.picker.as_ref().map(|p| p.sel)).flatten().and_then(|i| r.get(i).cloned());
            check(first == Some(Row::Page("Project ideas".into())) && r.contains(&Row::New("proj".into())), "Typing finds the page (and offers a new one)", format!("{r:?}"));
            key(with(|ui| ui.search).unwrap_or(0), VK_RETURN);
            let (page, open) = with(|ui| (ui.page.clone(), ui.picker.is_some())).unwrap_or((None, true));
            check(page.as_deref() == Some("Project ideas") && !open && saying() == Say::Where("Project ideas".into()), "Enter picks it: the note will go there", say_text(&saying()));
            Go::Next
        }
        10 => {
            if now_ms() < 700 {
                return Go::Wait; // past the half-second guard
            }
            shot("5-dark");
            key(note(), VK_RETURN);
            Go::Next
        }
        11 => {
            let added = with(|ui| ui.rules.is_added()).unwrap_or(false);
            let Some(ok) = waited(ms, 8000, added) else { return Go::Wait };
            check(ok && saying() == Say::Added("✓ Added to Project ideas".into()), "The to-do is added to that page", say_text(&saying()));
            Go::Stop
        }
        _ => Go::Stop,
    }
}

/// How many boxes are open (in any program).
fn boxes() -> usize {
    open_boxes().len()
}

/// Clicks, and the shortcut pressed a second time while the box is open.
fn clicks(step: usize, ms: u64) -> Go {
    let h = hwnd();
    match step {
        0 => {
            // (past its first half-second, so an Enter ignored later is the second press's doing)
            let Some(ok) = waited(ms, 5000, matches!(saying(), Say::Where(_)) && now_ms() >= 700) else { return Go::Wait };
            check(ok, "The third box says where the note goes", say_text(&saying()));
            let file = DIR.with(|d| d.borrow().join("Hello.txt"));
            let _ = std::fs::write(&file, "hello");
            let drop = files::make_drop(std::slice::from_ref(&file));
            unsafe { SendMessageW(h, WM_DROPFILES, drop as usize, 0) };
            check(note_text().starts_with("Click test [Hello.txt](../assets/Hello_"), "A dropped file is linked by its name", note_text());
            // the program started again by the shortcut, with words (as `--capture` does when it can't
            // add straight away)
            let exe = std::env::current_exe();
            let app_data = DIR.with(|d| d.borrow().join("appdata"));
            let child = exe.and_then(|exe| std::process::Command::new(exe).args(["--capture-box", "From a second press"]).env("LOCALAPPDATA", app_data).spawn());
            match child {
                Ok(c) => SECOND.with(|s| *s.borrow_mut() = Some(c)),
                Err(e) => check(false, "(the test started the program a second time)", e.to_string()),
            }
            Go::Next
        }
        1 => {
            // the words arrive (the box is being brought forward): an Enter right now is one meant
            // for another window, and must not add the note
            let arrived = note_text().ends_with("\nFrom a second press");
            let Some(ok) = waited(ms, 8000, arrived) else { return Go::Wait };
            check(ok, "Pressing the shortcut again hands the open box the new words, on a line of their own", note_text());
            if ok {
                key(note(), VK_RETURN);
                let ignored = !busy() && !with(|ui| ui.rules.is_added()).unwrap_or(true) && unsafe { IsWindow(h) } != 0;
                check(ignored, "An Enter right after it's brought forward is ignored", say_text(&saying()));
            }
            Go::Next
        }
        2 => {
            let done = SECOND.with(|s| s.borrow_mut().as_mut().map(|c| c.try_wait().ok().flatten()));
            let exited = match done {
                None => Some(None), // never started (said above)
                Some(Some(status)) => Some(Some(status.success())),
                Some(None) if ms > 8000 => {
                    SECOND.with(|s| s.borrow_mut().as_mut().map(|c| c.kill()));
                    Some(Some(false))
                }
                Some(None) => None,
            };
            let Some(exited) = exited else { return Go::Wait };
            if let Some(ok) = exited {
                check(ok && boxes() == 1, "…and brings it forward (no second box)", format!("ended well: {ok}, boxes: {}", boxes()));
            }
            shot("6-second-press");
            Go::Next
        }
        3 => {
            // the small buttons (Build 34): [[ ]] makes the selected words a page link (or puts the
            // caret between empty brackets), # starts a tag, To-do puts the mark on
            let tool = |i: usize| with(|ui| ui.layout.tools[i]).unwrap_or_default();
            let caret = || {
                let (mut a, mut b) = (0u32, 0u32);
                unsafe { SendMessageW(note(), EM_GETSEL, &mut a as *mut u32 as usize, &mut b as *mut u32 as isize) };
                (a, b)
            };
            let shown = (0..3).all(|i| !tool(i).is_empty()) && with(|ui| ui.layout.note.r < ui.layout.tools[0].l).unwrap_or(false);
            check(shown, "The small buttons ([[ ]], #, To-do) are on the box, after the text", format!("{:?}", with(|ui| ui.layout.tools)));
            set_note("soup");
            unsafe { SendMessageW(note(), EM_SETSEL, 0, -1) };
            click(tool(0));
            check(note_text() == "[[soup]]" && caret() == (8, 8), "[[ ]] turns the selected words into a page link", format!("{} {:?}", note_text(), caret()));
            click(tool(1));
            check(note_text() == "[[soup]] #" && caret() == (10, 10), "# starts a tag where the caret is", format!("{} {:?}", note_text(), caret()));
            click(tool(0));
            check(note_text() == "[[soup]] #[[]]" && caret() == (12, 12), "[[ ]] with nothing selected: the caret between the brackets", format!("{} {:?}", note_text(), caret()));
            click(tool(2));
            let todo = with(|ui| ui.todo && !ui.layout.pill.is_empty()).unwrap_or(false);
            check(todo, "To-do puts the to-do mark on", note_text());
            shot("7-small-buttons");
            click(tool(2));
            check(!with(|ui| ui.todo).unwrap_or(true), "…and a second click takes it off", note_text());
            // × closes it; the file was never copied
            click(with(|ui| ui.layout.close).unwrap_or_default());
            check(unsafe { IsWindow(h) } == 0, "Clicking × closes the box", "still open");
            Go::Stop
        }
        _ => Go::Stop,
    }
}

/// The notes folder can't be reached.
fn problem(step: usize, ms: u64) -> Go {
    match step {
        0 => {
            let Some(ok) = waited(ms, 5000, matches!(saying(), Say::Problem(_))) else { return Go::Wait };
            check(ok && say_text(&saying()).contains("can’t be reached"), "It says why the notes folder can't be used", say_text(&saying()));
            Go::Next
        }
        1 => {
            if now_ms() < 700 {
                return Go::Wait;
            }
            set_note("keep me");
            key(note(), VK_RETURN);
            Go::Next
        }
        2 => {
            if ms < 400 {
                return Go::Wait;
            }
            check(!busy() && note_text() == "keep me" && say_text(&saying()).contains("can’t be reached"), "A note that can't be added stays in the box, editable", format!("{} / {}", note_text(), say_text(&saying())));
            shot("7-problem");
            key(note(), VK_ESCAPE);
            Go::Stop
        }
        _ => Go::Stop,
    }
}

/// The box was still open 5 seconds after its checks: close it (it should have closed itself).
pub(super) fn late(gen: usize) {
    if with(|ui| ui.gen as usize == gen).unwrap_or(false) {
        log("FAIL The box didn't close by itself after its checks".into());
        with(|ui| ui.rules.failed());
        close();
    }
}

fn say_text(s: &Say) -> String {
    match s {
        Say::Nothing => String::new(),
        Say::Where(w) => format!("To {w}"),
        Say::Added(a) | Say::Problem(a) | Say::Busy(a) => a.clone(),
    }
}

/// Called every 40 ms while a self-test box is open.
pub(super) fn tick() {
    let Some((script, step, ms, total)) = with(|ui| ui.test.as_ref().map(|p| (p.script, p.step, p.since.elapsed().as_millis() as u64, p.started.elapsed().as_millis() as u64))).flatten() else { return };
    if total > 30_000 {
        log(format!("FAIL The {script:?} box didn't finish its checks in 30 seconds (step {step})"));
        with(|ui| ui.rules.failed());
        close();
        return;
    }
    let go = match script {
        Script::Light => light(step, ms),
        Script::Dark => dark(step, ms),
        Script::Click => clicks(step, ms),
        Script::Problem => problem(step, ms),
    };
    match go {
        Go::Wait => {}
        Go::Next => {
            with(|ui| {
                if let Some(p) = ui.test.as_mut() {
                    p.step += 1;
                    p.since = Instant::now();
                }
            });
        }
        Go::Stop => {
            with(|ui| {
                if let Some(p) = ui.test.as_mut() {
                    p.step = usize::MAX;
                }
            });
            unsafe { KillTimer(hwnd(), TIMER_TEST) };
            // a box that doesn't close by itself within 5 s is closed (and that's a failure)
            let (h, gen) = with(|ui| (ui.hwnd, ui.gen)).unwrap_or((0, 0));
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(5));
                unsafe { PostMessageW(h, WM_TEST_LATE, gen as usize, 0) };
            });
        }
    }
}

fn run(script: Script, link: Option<(&str, &str)>) -> std::time::Duration {
    let t = Instant::now();
    let probe = Probe { script, step: 0, since: Instant::now(), started: Instant::now() };
    if let Err(e) = run_box(link.map(|(a, b)| (a.to_string(), b.to_string())), Some(probe)) {
        log(format!("FAIL The {script:?} box couldn't open: {e}"));
    }
    t.elapsed()
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
    std::fs::write(dir.join(MARK), "The capture box check's own folder (lean-outliner --capture-box-selftest).\n").map_err(|e| e.to_string())
}

/// Run the checks in `<base>\capbox-selftest`; returns how many failed (the program's exit code),
/// or 100 when that folder couldn't be made fresh (nothing was opened or written).
pub fn selftest(base: &Path) -> i32 {
    let dir = base.join("capbox-selftest");
    if fresh(&dir).is_err() {
        return 100;
    }
    let dir = dir.as_path();
    let (cache, notes, shots) = (dir.join("cache"), dir.join("notes"), dir.join("shots"));
    let second_cache = dir.join("appdata").join("com.srikanth.leanoutliner");
    for d in [&cache, &notes.join("pages"), &notes.join("journals"), &notes.join("logseq"), &shots, &second_cache] {
        let _ = std::fs::create_dir_all(d);
    }
    DIR.with(|d| *d.borrow_mut() = dir.to_path_buf());
    outline_core::app::set_cache_dir(cache.clone());
    // the box finds the notes folder through the cache folder: it must be this check's own
    if outline_core::app::cache_dir().as_deref() != Some(cache.as_path()) {
        log("FAIL The check's own cache folder couldn't be used, so no box was opened".into());
        let _ = std::fs::write(dir.join("result.txt"), LOG.with(|l| l.borrow().join("\n")) + "\n");
        return 1;
    }
    let w = |p: PathBuf, t: &str| {
        let _ = std::fs::write(p, t);
    };
    w(cache.join("last-vault.txt"), &notes.display().to_string());
    w(second_cache.join("last-vault.txt"), &notes.display().to_string());
    w(notes.join("logseq/config.edn"), CONFIG);
    w(notes.join("pages/Project ideas.md"), "- first idea\n");
    w(notes.join("pages/Reading list.md"), "- a book\n");
    w(notes.join("pages/fav_books.md"), "title:: Favourite books\n- Dune\n");

    // 1. light colours (no look file yet), words from a link
    run(Script::Light, Some(("Self-test from a link", "https://example.com")));
    let journal = std::fs::read_to_string(today_file()).unwrap_or_default();
    check(journal.starts_with("- **") && journal.ends_with("** Light test ✓ ünïcödé\n  second line\n"), "The note is in today's journal as typed", &journal);
    let closed = ADDED_AT.with(|a| a.get()).map(|t| t.elapsed().as_millis());
    check(closed.is_some_and(|ms| ms < 2500), "Then the box closes by itself", format!("{closed:?} ms after adding"));

    // 2. a dark look, the clipboard's words; to-do, picture, file, another page
    let night = "surface=#2A2F38\nsurface-2=#242830\nink=#E6E9EE\nink-soft=#B9BFC9\nink-faint=#8E95A0\naccent=#86C4B3\naccent-ink=#12141A\nline=#454C58\nline-soft=#3A404B\ndanger=#EBA394\n";
    w(cache.join("look.txt"), night);
    let class = wide("STATIC");
    let holder = unsafe { CreateWindowExW(0, class.as_ptr(), std::ptr::null(), 0, 0, 0, 0, 0, 0, 0, GetModuleHandleW(std::ptr::null()), std::ptr::null_mut()) };
    check(files::set_clipboard(holder, Some("copied text"), 0), "(the test put words on the clipboard)", "the clipboard was busy");
    run(Script::Dark, None);
    let page = std::fs::read_to_string(notes.join("pages/Project ideas.md")).unwrap_or_default();
    check(
        page.starts_with("- first idea\n- LATER **") && page.contains("copied text ![image](../assets/image_") && page.contains(" [Quarterly report.pdf](../assets/Quarterly_report_") && page.ends_with(")\n"),
        "The to-do went to the end of Project ideas, as LATER",
        &page,
    );
    // the picture and the file were copied when the note was added, under the names it links
    let linked = |start: &str| page.split(start).nth(1).and_then(|r| r.split(')').next()).map(|r| notes.join(r.trim_start_matches("../")));
    let png = linked("![image](").and_then(|f| std::fs::read(f).ok()).is_some_and(|b| b.starts_with(b"\x89PNG"));
    let pdf = linked("[Quarterly report.pdf](").and_then(|f| std::fs::read(f).ok()).is_some_and(|b| b == b"%PDF-1.4 self-test");
    check(png && pdf && assets().len() == 2, "The picture (as PNG) and the file are in assets/, as linked", assets().join(", "));
    let after_dark = assets();

    // 3. clicks, a second press of the shortcut, and × closing without adding
    run(Script::Click, Some(("Click test", "")));
    check(assets() == after_dark, "A box closed without adding leaves nothing in assets/", assets().join(", "));

    let today = today_file().strip_prefix(&notes).map(|p| p.to_string_lossy().replace('\\', "/")).unwrap_or_default();
    let extra: Vec<String> = files_in(&notes)
        .into_iter()
        .filter(|f| {
            let made = ["logseq/config.edn", "pages/Project ideas.md", "pages/Reading list.md", "pages/fav_books.md"].contains(&f.as_str());
            !(made || *f == today || after_dark.iter().any(|a| *f == format!("assets/{a}")))
        })
        .collect();
    check(extra.is_empty(), "Nothing else was written in the notes folder", extra.join(", "));
    check(!files_in(&cache).iter().any(|f| f.starts_with("vault-")), "The box never writes the app's index cache", files_in(&cache).join(", "));

    // 4. the notes folder can't be reached
    w(cache.join("last-vault.txt"), &dir.join("missing").display().to_string());
    let took = run(Script::Problem, None);
    check(took.as_secs() < 10, "Esc closes it", format!("{took:?}"));
    check(!dir.join("missing").exists(), "Nothing was written for the missing folder", "");
    unsafe { DestroyWindow(holder) };

    let lines = LOG.with(|l| l.borrow().clone());
    let fails = lines.iter().filter(|l| l.starts_with("FAIL")).count();
    let _ = std::fs::write(dir.join("result.txt"), lines.join("\n") + "\n");
    fails as i32
}
