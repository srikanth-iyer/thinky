//! Starting from scratch (the welcome screen and the folder picker): a new folder ("New folder"), and
//! a new notes folder set up the way Logseq lays one out (`pages/`, `journals/`, `logseq/config.edn`
//! with Logseq 0.10's default date formats), with a few short pages that show a newcomer around.
//! Nothing here ever writes over what's there: folders are made with `create_dir` (never one that
//! exists), files with `create_new` (one that turned up meanwhile is left as it is), and a folder that
//! is a notes folder, or inside one, is refused. Tests: core/tests/start.rs.

use crate::app::is_vault;
use crate::date::Date;
use crate::Config;
use std::io::Write;
use std::path::{Path, PathBuf};

/// What's wrong with `name` for a new folder, in plain words; None when it can be used (after
/// trimming spaces at its ends, as `new_folder` does).
pub fn folder_name_problem(name: &str) -> Option<&'static str> {
    let n = name.trim();
    if n.is_empty() {
        return Some("Type a name for the new folder.");
    }
    if n == "." || n == ".." {
        return Some("That name can’t be used for a folder.");
    }
    if n.chars().any(|c| "/\\:*?\"<>|".contains(c) || c.is_control()) {
        return Some("A folder’s name can’t have any of these in it: / \\ : * ? \" < > |");
    }
    if n.starts_with('.') {
        return Some("A name starting with a dot would make a hidden folder.");
    }
    if n.ends_with('.') {
        return Some("A folder’s name can’t end with a dot (Windows doesn’t allow it).");
    }
    const RESERVED: [&str; 30] = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2",
        "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9", "COM¹", "COM²", "COM³", "LPT¹", "LPT²", "LPT³", "CONIN$",
        "CONOUT$",
    ];
    // (Windows keeps these names, in any capitals, also with something after a dot: "con.txt")
    let stem = n.split('.').next().unwrap_or(n).trim_end();
    if RESERVED.contains(&stem.to_uppercase().as_str()) {
        return Some("Windows keeps that name for itself: please choose another.");
    }
    if n.chars().count() > 120 {
        return Some("That name is too long.");
    }
    None
}

/// Make the folder `name` in `parent` (the picker's "New folder"). Never one that's there already,
/// in any capitals. Returns its path.
pub fn new_folder(parent: &Path, name: &str) -> Result<PathBuf, String> {
    if let Some(why) = folder_name_problem(name) {
        return Err(why.into());
    }
    if !parent.is_dir() {
        return Err(format!("Can’t find the folder {}.", parent.display()));
    }
    let name = name.trim();
    let taken = || format!("There’s already something called “{name}” here: choose another name.");
    // (Windows and Android ignore capitals in names; Linux doesn't: the same rule everywhere)
    if let Ok(rd) = std::fs::read_dir(parent) {
        if rd.flatten().any(|e| e.file_name().to_string_lossy().to_lowercase() == name.to_lowercase()) {
            return Err(taken());
        }
    }
    let path = parent.join(name);
    match std::fs::create_dir(&path) {
        Ok(()) => Ok(path),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Err(taken()),
        Err(e) => Err(format!("Couldn’t make the folder: {e}")),
    }
}

/// The notes folder `p` is, or is inside (the nearest one), if any.
pub fn notes_folder_of(p: &Path) -> Option<PathBuf> {
    p.ancestors().find(|a| !a.as_os_str().is_empty() && is_vault(a)).map(Path::to_path_buf)
}

/// What `start_notes` made.
#[derive(serde::Serialize, Debug)]
pub struct Started {
    /// The notes folder.
    pub path: String,
    /// Its files that were made, relative to it ("pages/Start here.md"…).
    pub made: Vec<String>,
    /// The page to open first (the tour's first page), when it was made.
    pub start: Option<String>,
}

/// The tour's first page: also a favourite, so it's easy to find again.
pub const START_PAGE: &str = "Start here";

/// Set up a new notes folder in `dir`: `pages/`, `journals/` and `logseq/config.edn`; with `demo`,
/// the tour's pages (and, given `today`, a first note in today's journal pointing at them). Refused
/// for a folder that is a notes folder or inside one. What's in the folder already stays as it is.
pub fn start_notes(dir: &Path, today: Option<Date>, demo: bool) -> Result<Started, String> {
    if !dir.is_dir() {
        return Err(format!("Can’t find the folder {}.", dir.display()));
    }
    if let Some(v) = notes_folder_of(dir) {
        return Err(if v == dir {
            "This is a notes folder already: open it with “Use this folder”.".into()
        } else {
            format!("This folder is inside the notes folder {}. Choose a folder outside it, or open that one.", v.display())
        });
    }
    // first make sure nothing is in the way (a file called "pages"…), so nothing is half made
    for d in ["pages", "journals", "logseq"] {
        let p = dir.join(d);
        if p.exists() && !p.is_dir() {
            return Err(format!("There’s a file called “{d}” in this folder, where the notes folder needs a folder of that name. Choose another folder."));
        }
    }
    for d in ["pages", "journals", "logseq"] {
        let p = dir.join(d);
        if !p.is_dir() {
            std::fs::create_dir(&p).map_err(|e| format!("Couldn’t make the folder “{d}”: {e}"))?;
        }
    }
    let cfg = Config::default();
    let mut files: Vec<(String, String)> = vec![("logseq/config.edn".into(), config_text(demo))];
    if demo {
        for (name, text) in DEMO {
            files.push((format!("pages/{}.md", crate::file_stem_for(name)), text.to_string()));
        }
        if let Some(d) = today {
            files.push((cfg.journal_rel_path(d), JOURNAL.to_string()));
        }
    }
    let mut made = vec![];
    for (rel, text) in files {
        if write_new(&dir.join(&rel), &text)? {
            made.push(rel);
        }
    }
    let start = demo.then(|| START_PAGE.to_string()).filter(|_| made.iter().any(|r| r == &format!("pages/{START_PAGE}.md")));
    Ok(Started { path: dir.display().to_string(), made, start })
}

/// Write a new file; false (nothing written) when there's one by that name already.
fn write_new(path: &Path, text: &str) -> Result<bool, String> {
    let mut f = match std::fs::OpenOptions::new().write(true).create_new(true).open(path) {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => return Ok(false),
        Err(e) => return Err(format!("Couldn’t write {}: {e}", path.display())),
    };
    if let Err(e) = f.write_all(text.as_bytes()).and_then(|_| f.sync_all()) {
        drop(f);
        let _ = std::fs::remove_file(path); // (only the file just made here, half written)
        return Err(format!("Couldn’t write {}: {e}", path.display()));
    }
    Ok(true)
}

/// `logseq/config.edn` for a new notes folder: Logseq's own settings file, in its shape, with Logseq
/// 0.10's default date formats and folders spelled out (Logseq reads it as it is, and adds its other
/// settings' defaults itself). To-dos as TODO → DOING → DONE, which says itself to a newcomer.
fn config_text(demo: bool) -> String {
    let favs = if demo { format!("[\"{START_PAGE}\"]") } else { "[]".into() };
    format!(
        r#"{{:meta/version 1

 ;; The settings of this notes folder. Logseq reads this same file, so the folder
 ;; can be opened with Logseq too.

 ;; New pages and journal days are Markdown files.
 :preferred-format :markdown

 ;; To-dos go TODO -> DOING -> DONE (:now would make them LATER -> NOW -> DONE).
 :preferred-workflow :todo

 ;; Pages are kept in pages/, one journal file a day in journals/.
 :pages-directory "pages"
 :journals-directory "journals"

 ;; A journal day's name, e.g. "Oct 28th, 2026", and its file, e.g. 2026_10_28.md.
 :journal/page-title-format "MMM do, yyyy"
 :journal/file-name-format "yyyy_MM_dd"

 ;; Pages listed under Favourites in the side menu.
 :favorites {favs}

 ;; Files and folders not to read as notes.
 :hidden []

 ;; A template for each new journal day ("" = none).
 :default-templates {{:journals ""}}

 ;; How many levels of a linked reference start unfolded.
 :ref/default-open-blocks-level 2}}
"#
    )
}

/// Today's first note in a new notes folder with the tour.
const JOURNAL: &str = "- Welcome to your new notes folder! This is today’s page in the **journal**: there’s a new one each day, so you can just start writing.\n- To learn the basics, open [[Start here]]: four short pages show you around.\n";

/// The tour: four short pages for someone who has never used an outliner (he asked for more, Oct 29:
/// the menus, moving notes, scrolling, computer and phone). Plain words, a heading per topic, lines
/// starting **Computer:** / **Phone:** where the two differ. Every instruction is the app's real
/// behaviour: change these lines when that changes.
const DEMO: [(&str, &str); 4] = [
    (
        "Start here",
        "- Welcome! These four short pages show you around in a few minutes, on a computer or a phone. Where the two work differently, a line starting with **Computer:** or **Phone:** says so.
- Your notes are plain text files in a folder on your own device: they’re yours, and other apps (Logseq too) can open them.
- ## Writing
\t- Each line with a dot in front is a **note**. Click or tap its words to write in it.
\t- **Enter** at the end of a note starts a new note below it.
\t- **Computer:** **Shift+Enter** starts a new line inside the same note. **Esc** stops writing.
\t- **Phone:** while you write, a bar of buttons sits above the keyboard; swipe it sideways to see them all. The ↵ button starts a new line inside the note; the button at its right end puts the keyboard away (so does Back).
- ## Notes inside notes
\t- A note can have **sub-notes**, like this one: they sit under it, one step in.
\t\t- Sub-notes can have their own. That’s an **outline**: big ideas on the left, details tucked under them.
\t- **Computer:** **Tab** moves the note you’re writing in one step in, under the note above it. **Shift+Tab** moves it back out.
\t- **Phone:** swipe a note’s words to the right to move it in, to the left to move it out (when you’re not writing in it). While writing, the first two buttons on the bar do the same (out, in).
- ## Moving notes
\t- A note always moves together with its sub-notes.
\t- **Computer:** drag it by its dot. While writing in it, **Alt+Shift+↑** and **Alt+Shift+↓** move it up and down.
\t- **Phone:** hold its dot until the phone buzzes, then drag it. While writing, the ↑ and ↓ buttons on the bar move it up and down.
\t- Dragging near the top or bottom of the screen scrolls the page. You can drop a note on another day in the Journals, and on a computer also on a page in the side menu: it moves there.
- ## Folding
\t- A note with sub-notes can be folded away, so only its first line shows. Its dot gets a ring, so you can tell. Try it here:
\t\t- Folded notes are only out of sight.
\t\t\t- Unfold them whenever you like.
\t- **Computer:** point at the note: a small arrow shows left of its dot. Click it to fold or unfold.
\t- **Phone:** tap the small arrow at the right end of the note’s first line.
\t- Click or tap a note’s **dot** to see only that note and its sub-notes. **Back** takes you out again.
- ## Menus while you write
\t- **The note menu**: colours, headings, select, cut, copy, delete, a link to the note, a numbered list, fold or unfold everything.
\t\t- **Computer:** right-click the note’s dot.
\t\t- **Phone:** hold the dot and let go without moving it, or tap the ⋯ button on the bar while writing.
\t- **The / list**: type **/** while writing for to-dos, dates, headings, bold, pictures, links and much more. Keep typing to narrow it down, then pick one. On a phone, the / button on the bar opens it too.
- ## Undo
\t- **Computer:** **Ctrl+Z** undoes, **Ctrl+Y** (or **Ctrl+Shift+Z**) redoes.
\t- **Phone:** the ↶ and ↷ buttons near the end of the bar. After you delete a note or swipe one in or out, the message at the bottom has an **Undo** button too.
- ## Selecting several notes
\t- **Computer:** **Esc** while writing selects that note. **Shift+↑** and **Shift+↓** add the notes above or below; **Shift+click** selects every note up to the one clicked. Then **Tab**, **Shift+Tab**, **Delete**, **Ctrl+C**, **Ctrl+X**, dragging or right-clicking a dot act on all of them. Esc lets go.
\t- **Phone:** pick **Select** in the note menu, then hold another note’s dot and let go: the notes in between are selected too. The bar’s buttons and the note menu then act on all of them.
- Next: [[Links and tags]]
",
    ),
    (
        "Links and tags",
        "- ## Links
\t- Put a page’s name between double square brackets to link to it, like this: [[Start here]]. Click or tap the link to go there.
\t- Typing `[[` shows your pages, so you can pick one. On a phone, the [[ ]] button on the bar does the same.
\t- Select some words and type `[[` to turn them into a link to the page of that name.
\t- Linking to a page that doesn’t exist yet is fine: it’s made when you first write on it. Try [[My first page]].
\t- **Computer:** point at a link for a moment to peek at that page without leaving this one.
\t- **Phone:** press and hold a link to peek at it; **Open** goes there.
- ## Tags
\t- A **tag** works the same way: #example is a link to the page “example”. Typing `#` shows your pages too; on a phone, the # button on the bar.
- ## Linked references
\t- At the end of each page, **Linked references** lists every note that links to it, wherever it was written, with the notes around it. Have a look at the end of [[Start here]]: this page is there.
\t- Click or tap a reference to go to that note in its page.
\t- When several pages link to one, the small filter button beside **Linked references** shows a box to filter them, a way to sort them and **Fold all**.
\t- **Unlinked references**, under them, finds notes that mention the page’s name without a link; **Link** turns one into a link.
- ## Pictures and files
\t- Paste a picture into a note, or pick **Image…** or **Upload a file…** in the / list. On a phone, the picture button on the bar.
\t- **Computer:** you can also drag pictures and files from a folder onto a note.
\t- They’re copied into the `assets` folder, next to your notes.
- Next: [[Journal and to-dos]]
",
    ),
    (
        "Journal and to-dos",
        "- ## The journal
\t- **Journals** has a page for each day. It’s where you start: today at the top.
\t- Scroll down to go back through earlier days: older ones keep coming as you scroll.
\t- Write things down as they come, without deciding where they belong. Add a link (like [[Links and tags]]) and the note shows up on that page too.
\t- To jump to a day, use the calendar button: in the strip at the top on a computer, in the bar at the top of the Journals on a phone. Dots mark days with notes.
\t- The house button at the top always takes you back to today.
- ## The + button (phone)
\t- The round **+** at the bottom adds a note at the end of the page you’re on (on the Journals: today) and opens the keyboard.
\t- It steps aside while you scroll down, and comes back when you scroll up.
- ## To-dos
\t- Start a note with TODO to make it a **to-do**, and click or tap its box when it’s done:
\t\t- TODO Tick this box
\t\t- DONE Read about to-dos
\t- **Computer:** **Ctrl+Enter** makes the note a to-do, then DOING, then DONE.
\t- **Phone:** the ☑ button on the bar does the same.
\t- **To-dos** in the side menu gathers the open to-dos from every page.
- ## Dates
\t- In the / list, **Today**, **Tomorrow** and **Date…** link a note to a day; **Scheduled date…** and **Deadline…** give a to-do a date.
\t- **Phone:** the calendar button on the bar has the same choices.
\t- Today’s journal shows to-dos with a date that are overdue, due today or coming up soon, under **Scheduled & deadline**.
- Next: [[Finding things]]
",
    ),
    (
        "Finding things",
        "- ## The side menu
\t- It has **Journals**, **All pages**, **To-dos**, **Tags**, **Properties**, your **Favourites** and **Recent** pages, and at the bottom **Look** and **Settings**.
\t- **Computer:** it’s on the left. The button at the top left (or `Ctrl+\\`) hides it and shows it again.
\t- **Phone:** tap ☰ at the top left, or swipe right starting near the left edge of the screen. Tap beside it, swipe left or press Back to close it.
- ## Search
\t- **Search** finds pages and notes by any of their words, in any order. Page names are found even with a small typo.
\t- **Computer:** **Search** at the top of the side menu, or **Ctrl+K**.
\t- **Phone:** the magnifying glass at the top right.
\t- To find words on the page you’re reading: **Ctrl+F** on a computer; on a phone, the page’s ⋯ menu, then **Find on this page**.
- ## Getting around
\t- The arrows at the top go back and forward, as in a web browser.
\t- On a long page, the notes that the top one sits under stay pinned at the top as you scroll, so you know where you are.
\t- **Computer:** **Alt+←** and **Alt+→** go back and forward too. In a wide window, **Ctrl+click** a link opens it in a new tab and **Shift+click** opens it beside this page.
\t- **Phone:** Back (the gesture or the button) first closes what’s open (a menu, search, the keyboard), then goes back a page.
- ## A page’s own menu
\t- The ⋯ beside a page’s title: **Rename…**, **Find on this page**, **History…** (earlier versions of the page), **Copy page as text…**, **Copy link**, **Print or save as PDF** and **Delete page…**.
\t- Click or tap a page’s title to rename it. The star beside it adds the page to Favourites.
\t- Deleted pages wait in a bin: Settings, then **Notes**, then **Deleted pages and pictures** brings them back.
- ## Commands
\t- Every command in one list: **Ctrl+Shift+P** on a computer; **Commands** in the side menu on a phone.
- ## Looks and settings
\t- **Look**, at the bottom of the side menu, changes how everything looks. Try a few!
\t- **Settings** has your notes folder, the look (text size and link style too), quick capture and, on a computer, the keyboard shortcuts.
\t- To tell the app's maker what works or what you'd like: Settings, then **About**, then **Send feedback**.
- ## Where your notes live
\t- Every page is a Markdown file in your notes folder: pages in `pages`, journal days in `journals`, pictures and files in `assets`, settings in `logseq/config.edn`.
\t- Any text editor can open them, and so can Logseq. Settings, then **Notes**, shows which folder is open and lets you choose another.
- That’s all you need to begin. When you no longer need these pages, delete them from each page’s ⋯ menu.
",
    ),
];
