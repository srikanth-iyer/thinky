# thinky (formerly Lean Outliner) — the detailed guide (for people and for Claude)

**Start with `docs/ARCHITECTURE.md`**: the top-down map of every program mode, what runs in the
background (the shortcut-key helper `--hotkey`, the link listener, the file watcher), everything the
app leaves outside the repo (registry, Start menu, cache files), the capture paths, and the rules
mirrored in Kotlin. Check it before building any new component, and
update it in the same commit when you add one. This file holds the detailed rules behind each part.

A lean Logseq-style outliner for Windows and Android. Most of it is written and maintained with
Claude (an AI), and this file is the detailed guide for whoever works on it next, person or AI.
Keep it small and plain: no frameworks, one place per concern.
Name: **thinky** (all lowercase, always, even at the start of a sentence; the maintainer decided Oct 29, 2026; it was
"Lean Outliner"). Only what people see changed (productName, window title, UI text, messages, the
Android app's label); the hidden identifier `com.srikanth.leanoutliner`, the `leanoutliner://` link
scheme, the cargo package and exe `lean-outliner(.exe)`, the repo names, hidden window classes/titles
(`LeanOutlinerHotkey`, "Lean Outliner shortcut key…", the Run value's name, `LeanOutlinerLinks`, the
capture box's owner) and the release asset names `LeanOutliner-setup.exe(.sig)`/`LeanOutliner.apk`
stay: installed apps look for those names to update (core/src/update.rs, MainActivity), and updates
must install over older builds. `api.js` `APP_NAME` is the one place new code takes the name from.
Brand (the maintainer's picks on the "thnki + thinky · scribble to spark" board): `ui/brand/` — `icon.svg` (the
"scribble to spark" icon: cream tile #F4EEE3, ink #1D1A2E, red spark #FF4B2B; the designer's three
drawings by size: `icon.svg` fine lines for 128px and up, `icon-mid.svg` ~40–96px, `icon-small.svg`
thick lines drawn 1.14× bigger for 32px and less), `wordmark.svg` ("thinky" in Reenie Beanie, option
10: leaned skewX(-14°), a 1.5px-at-104px outline, a dotless ı whose dot is the red four-point spark)
(no `[[thinky]]` mark: the maintainer tried it and said not to use it, Oct 29). The wordmark is outlines made ONCE
from the font (`scripts/make_wordmark.py`, how to get the font is in it; the app ships no font for
them), each a `<symbol id="m">` drawn with `<use href="brand/wordmark.svg#m">` so the letters take the
look's ink (`currentColor`; readable in night looks) while the spark and [[ ]] stay red. Inside the app
the icon takes the look's colours (Build 32, the maintainer asked): `ui/brand/icon-in.svg` holds icon-small (`#s`) and
icon-mid (`#m`) as symbols, numbers rounded, filled by `--logo-tile`/`--logo-ink`/`--logo-spark` (skins.css;
the brand's cream/ink/red by default, each look's own otherwise), drawn inline (`<svg class="logo"><use>`: an
`<img>` can't take CSS); the scribble's spark (scribble.svg, the start-up drawing) takes `--logo-spark` too.
The OS icons (Windows, Android, the tab's) and make_icons.mjs's sources stay the brand's own files. The maintainer's rules (Oct 29): wherever the name shows in the app's own
screens it is the wordmark, set in the sentence like any word (`BRAND.word`, `.wm-in`, 1.3em tall),
never the name in plain letters (only where pictures can't go: window title, Android's label, tooltips,
screen-reader names); the icon with the name: UNDER it where it stacks, BESIDE it where a row has room
(the phone's menu `.brand-mark`); the welcome screen: the big icon (112px) on top, then "Welcome to
<wordmark>"; About: "About <wordmark>". `dom.js` `BRAND`/`ICON.logo`/`ICON.brand`. App icons: `node scripts/make_icons.mjs` renders src-tauri/icons (icon.ico 16–256
with PNGs inside, the PNGs) and the Android launcher set (legacy square/round 48dp, the adaptive
icon's foreground 108dp with the drawing inside the 66dp safe circle, background colour #F4EEE3) from
ui/brand; the journal widget's header shows `android/res/drawable/widget_logo.xml` (the small icon as
a vector). Tested by t16_brand.
The logo in use (Build 32, tested by t16_logo): start-up: `index.html` `#splash` (the scribble inline,
rounded to whole units, + the spark; app.css `#splash`, CSS only: the line draws in 0.45 s, the spark
pops at the end) covers the window on the page colour while the app opens, takes no clicks, fades
when the first page is drawn (`App.unsplash`, end of `draw`; never waited for, never again), goes by
itself after 12 s; still with reduced motion.
The spark as a small mark (sparingly; colour token `--spark`, default #FF4B2B, in skins.css; the shape
`--spark-mask` + `.spark-mark` in app.css): a page's favourite button is the spark (`ICON.fav`, `.icon-btn.fav`:
an outline, filled red when on), today in the date picker (bold, a spark at the cell's corner, no ring),
`html.has-update` (set by `checkUpdate`) puts one on the sidebar's Settings, the About tab and the phone's
menu button, and "Opened in your browser. Thank you!" after Send feedback starts with one.
Saved: `App.saved` → `sparkSaved(o)` moves ONE `.saved-mark` (zero width and height, so nothing moves)
into the saved page's `.page-title` (a day's date in the Journals list) and replays its 0.6 s fade
(`saved-spark`; `saved-still` with reduced motion).
Slow waits: `BRAND.wait(words)` / `BRAND.spin` (dom.js; app.css `.spin`): two `<use>` of brand/scribble.svg
(its path has `pathLength="1"`; dash properties inherit into `<use>`), a faint copy under one that
draws and undraws in 1.6 s; still with reduced motion. An outer svg showing that symbol uses
`viewBox="0 0 720 680"` (the symbol's own viewBox does the rest). Used by: unlinked references,
History's list, Check this folder, `useVault` (opening a folder), the update box's busy stages, the
first search when slow (>250 ms; `App.searched`).
The phone's "+" (`#addnote`) is `ICON.addNote`: two pen strokes (round ends) in `--fab-ink` (default now the
ink) and a red spark (`.fab-spark`, `--spark`) at its upper tip.
The Windows capture box's strip starts with the app's icon, 16 px (`Canvas::logo` in outline_core::capture_box:
the cream tile with a faint edge, `LOGO_LINE` = icon-small.svg's line sampled to 35 points drawn as round-ended
lines, the spark as sqrt|x|+sqrt|y| curves; tested by core/tests/capture_box.rs `the_logo_is_drawn_in_its_square`);
its words start after it (`left` = 38 px).
Calm's accent (Build 32, the maintainer asked: keep it green but warmer, to sit with the brand) is a sage-green
`#2F6E52` with cream-green tints and a faintly warm page (`[data-skin="calm"], [data-skin="calmplain"]`). The
fallbacks when no look was saved yet follow (capture box `BoxColors::default`, the Android widgets' and pop-up's
`c_accent` default). The thinky look's in-app icon is an ink tile with cream lines (a cream tile melted into its
light page).
The installer and the rename: Tauri's NSIS installer keys its folder (`%LOCALAPPDATA%\thinky`), its
Apps & features entry and shortcuts on productName, so `src-tauri/windows/hooks.nsh` `LO_MIGRATE`
(PREINSTALL) finds the old "Lean Outliner" entry, waits until that program isn't open (asks when
installing by hand), runs its uninstaller in place as an update (`/S /UPDATE _?=<dir>`, waited for;
it keeps the Run value and data), removes its uninstall.exe, folder, Tauri's `Software\<maker>\Lean
Outliner` note and its Start-menu/desktop shortcuts; POSTINSTALL makes the thinky shortcuts it had
(an /UPDATE install makes none itself), points a taskbar pin, `leanoutliner://` and the shortcut key's
Run value at the new exe. Uninstalling also removes the leanoutliner:// key when it points there. The
app's data folders are named by the identifier, so the maintainer's notes folder, look, settings and key carry
over. CI's Windows job "Rename check" installs the real Build 31 then this build `/S /UPDATE` and
checks all of it, then uninstalls (`makensis` isn't on the cloud workspace by default: `apt-get
install nsis` compiles a stub harness of the hooks, but only CI runs them).

## Priority: lean
Speed, efficiency and small size come first. Before adding anything that grows the app noticeably
(a library, bundled fonts/assets, extra startup work), warn the maintainer with the cost and get a yes first.
Prefer hand-written, small code over dependencies. Current size (Build 31, agreed Oct 27 with Inter): ~2.6 MB Windows installer, ~8.45 MB APK
(CI warns when a file grows >10% over `ci/baseline.json`; update the baseline only for agreed growth).

## Release history
Done, release by release: Build 21 phone fixes; 22 Journals (older days, each day's references,
"Scheduled & deadline"), Plain night, Home, Settings tabs, capture box; 23 reading and writing (swipes,
press-and-hold preview, pinned parents, find and replace, easier links, page icons, coloured boxes); 24
safety and Android (side-by-side clash view, safety copies, unused pictures, quick-settings tile and
app-icon shortcuts); 25 resizable pictures; 26 tabs and two sides; 27 one-click updates, roomier
journal; 28 references with sub-notes, page history, the note menu, drag to move; 29 the Logseq feel
(instant shortcut key helper, smarter search, Ctrl+Shift+P, Plain like Logseq, the top strip, wide
mode, resizing, menus, folding, more / commands, `((`, Ctrl+A, wrapping, rich paste, export, phone +);
30 drag notes anywhere, files from Explorer, All pages by date, rename by the title + merge, favourites
follow renames, leanoutliner:// page/note links, Show file in Explorer.
The maintainer agreed (Oct 27): Plain night back to near-black, Logseq's blue-green kept as the look Plain teal; Inter is bundled (one variable file, italics
slanted by the browser; for Plain and Plain night); the grown size is the new `ci/baseline.json`.
Logo/name: decided Oct 29, 2026: thinky (see "Name" above).
Build 33 (the maintainer's list of Oct 30): thinky is the default look (index.html, boot.js, `setSkin`'s
start; the no-look-yet fallbacks too: capture box `BoxColors::default`, the Android widgets' and pop-up's;
UI tests still open in Calm: lib.mjs `open({look})`, t6_looks checks the default). To-dos: one filter at a
time, Open / To do (with WAITING) / Doing / Done / Cancelled (views.js `closed`). References' Sort is a menu
(`REF_SORTS`: last changed, name, date created, each both ways; `RefGroup.created` = `App::born`). Properties
list: filter, A to Z / Most used, and from two letters the values of any property (`with_property` with an
empty key). A to-do in references shows its tick box (`refRow`, `App.tickRef`: save_block, the row updated
in place). A faint "+" after each outline's last note (`Outline.addEnd`/`endPlus`, `.add-end`; not in
History's preview, read-only pages or a page whose only note is empty). Opening animations (end of app.css:
`.pop`, the search box, dialogs; none with reduced motion; not `#ac`). Start-up on the brand's cream in every
look (`#splash`), Android's own splash and window cream with no icon (android_overlay.py themes,
`lean_start`/`lean_blank`; MainActivity's WebView background), checked by android_test.sh 14b (dark mode,
every frame light). Phone: no Ctrl K on the search button; the "/" list chooses on lift (scrolls under a
finger); the toolbar Undo/Redo first, moving buttons and "/" last; the toolbar also in a page's properties
box (`App.textTa`/`textTool`, `.tb-text`); the "+" scrolls its note into view (again after the keyboard);
the calendar button closes the calendar (`pickDate` `button`). The Windows capture box keeps the web page of
copied words (`capture::with_source` / `html_source_url` / `text_fragment`, files.rs `clipboard_source`; on
its pre-fill and on paste). The Android pop-up shows the icon and a small toolbar ([[ ]], #, To-do).
Also Build 33 (the maintainer said yes, Oct 30): linked references edit in place, as in Logseq: a click on a reference's
words (`refClick` → `App.editRef`) swaps that `.refnote`'s rows for an `Outline` of its own page zoomed in on
the note (`opts.embed`: no crumbs, pins or "+"; the path above stays), pushed to the pane's outlines, so
saving, merging, the clash screen, Undo and the other side's catching up are the page's own; a note that
moved or changed since the list was drawn opens its page instead; redrawing the list (`refTools` draw) first
lets such outlines go (`dropLive`: typing saved). The page's name (group heading) and the path still go to
the page; "… N more" still zooms. Tested by t17_refedit. The Tags list counts `#tag`s written in notes too
(`parse::hash_tags`, not in code; `Vault::all_tags` = [name, pages with tags::, notes with #name]).
Ideas came partly from Tine (an open-source Logseq-compatible outliner, also Tauri + Rust; AGPL, so
ideas only, never its code). Not picked: a camera button, bigger to-do boxes, Tine's sidebar counts.

## Shape
- `core/` (Rust, `outline_core`): everything that understands notes.
  - `parse.rs` text → blocks/props/refs · `vault.rs` index (backlinks, tags, props, search, to-dos,
    unlinked refs, templates; duplicate names: first file owns the name, `take`/`promote`; an alias
    counts as its page: `page_info`/`resolve` open the page, `all_pages` gives each page its
    `aliases` (not one that's a page of its own or another page's; `search_pages` the same), so the
    `[[`/`#` list (popups.js `Suggest.pages`) shows "SB → Sourdough Bread" and never "New page: SB",
    like the search box; tests: tests/vault.rs `aliases_count_as_the_page`, t16_alias; block
    references: `search_blocks`, `blocks_by_id`, a pass over the notes, no index of their own)
  - `search.rs` the Ctrl+K search's rules (tests in `tests/search.rs`): `fold` (small letters, Latin
    accents dropped by two tables; ui/search.js has the same), words in any order, page names (and
    `alias::`) forgive typos (`allowed_typos`: 0 under 5 letters, 1 from 5, 2 from 8; `prefix_distance`,
    swaps count 1, against the start of a word of the name), ranked by `NameRank` (as typed / starts
    with / together / any order / typos); notes need every word exactly (`note_score`: together first),
    then newer journal days, then pages A–Z; `note_excerpt` (whole lines around the words, ≤600 chars).
    `Vault::search`: ≤`SEARCH_PAGES` (10) pages (`search_pages`, also the `[[`/`#` list's, the
    `search_pages` command; t16_find), then notes up to the limit (40); the capture box's page list
    (`rank_pages`) and `((` (`search_blocks`: folded notes + `note_score`) use the same rules; a page found by its
    alias says so (`alias`), `marks` = where the words are in the name (chars). Each page keeps its
    notes' folded text (`Page::folded`, a OnceLock made by the first search after the file was read:
    nothing at start-up). Bench: `search_first_ms` (makes those), `search_ms`, `search_words_ms`,
    `search_typo_ms`; keep each keystroke well under 30 ms.
  - `doc.rs` editing model: split a file into bullets and join back; **untouched bullets are written
    back byte-for-byte** (tests in `tests/doc.rs`). Never weaken this.
  - `config.rs` + `edn.rs` read/edit `logseq/config.edn` in place (journals dir, date formats, comma
    props, favorites, workflow, quick capture, :shortcuts, :ref/default-open-blocks-level; favourites put
    in another order by `App::reorder_favorites` → `edn::reorder_items`: only the items' own texts
    move, so spaces, comments and `#_` forms between them stay byte for byte; tests in tests/features.rs
    `favourites_reorder_in_place` and the fuzz test) · `date.rs` date-fns-style format/parse
  - `task.rs` TODO/DOING/LATER/NOW…, priorities, SCHEDULED/DEADLINE, repeaters · `text.rs` link/tag
    pieces, rename, unlinked mentions · `merge.rs` three-way block merge for edits made elsewhere
  - `capture.rs` quick capture (Logseq templates; an empty `{url}` drops a joining "from"). Web addresses
    are neat Markdown links everywhere (Build 32, the maintainer asked): `md_link(url, title, site)` = "[Title ·
    Site](url)" (`clean_title` drops a "| Site" ending; the site's address, `host`, when its name isn't
    known), "[site](url)" with no title; `split_url` takes a bare address or a whole `[name](http…)`
    link, `as_link` makes a bare one neat, and a note with no other words is just the link (no dangling
    "from"). The bookmarklet sends `title`/`site` and, with a selection, a text-fragment address
    (`#:~:text=first 4 words,last 4 words`, ≤8 words whole) that opens the page at it; link.rs makes the
    link; the capture box is prefilled "words [Title · Site](url)"; Android mirrors it (JournalWidget.kt
    `splitUrl`/`mdLink`/`asLink`; a shared page's subject + address → one link). Tests: tests/clip.rs.
  - `clip.rs` the browser extension's highlights (Build 32; tests in `tests/clip.rs`, in a real browser
    `t16_browser.mjs`): `file_clip` files a `Clip {url, title, site, highlights: [{text, link}]}` on the
    article's page: the page whose `source::` (page property) is this article (`normalize_url`: no `#`,
    no utm_/fbclid…, no www., http = https, no final "/"; `source_url` reads a link's address), else the
    page named like it (`page_name`: cleaned title) unless it has another article's `source::`, else
    "Title (Site)", "(Site) (2)"…. A new page: `tags:: [[quick capture]]`, `source:: [Title · Site](url)`
    (the maintainer files quick captures this way), a blank line. Highlights go under the top-level `[[<journal
    title>]]` bullet (made at the end; the same day's batch joins it), each `highlight_note`: `guard`ed
    words (a line that would start a note, property, ``` or #+ box gets a zero-width space in front;
    ≤1 empty line) + ` [↗](text-fragment link)`; a passage the page has anywhere (words, link ignored)
    is skipped. Written via split_doc/join_doc (the maintainer's bullets byte for byte, BOM kept) with
    `write_atomic_checked` (Expect::Bytes / Missing, 3 tries). Messages (`answer`, `serve`, `read_message`
    / `message_bytes`: 4-byte native-endian length + JSON, ≤8 MB): `hello`, `clip`, `journal` (the usual
    quick capture with a neat link to the passage); always `{ok, …}` or `{ok: false, error}`.
    `HOST_NAME` com.srikanth.leanoutliner, `EXTENSION_ID` fjgdgmpheeihnlbpmbajkmoapjfieggg (fixed by the
    public `key` in browser/manifest.json; its private key was thrown away: unpacked loading needs none).
  - `log.rs`
    problems log (`<cache>/problems.log`) · `app.rs` `App` + `dispatch(cmd, args)` = the whole API
  - `app/pictures.rs` (child of app.rs, uses its private parts): "Check this folder" lists pictures in
    `assets/` that no text file mentions (index texts in memory + whiteboards, config.edn, custom.css/js,
    the bin's pages, notes outside pages/journals; not `logseq/bak`): file name in any case, URL-decoded,
    one pass per text; Logseq PDF-highlight pictures count via their note id; a text that can't be read →
    none listed. Pictures changed in the last 3 days (the newer of change time and creation time on this
    disk, where known) are only counted (`recent`), never listed or moved: a picture can arrive before
    its note. `bin_pictures` checks each again (disk as now) and moves it to `logseq/.recycle`, named by
    its exact path (`bin_name`: "%"→"%25", "/"→"%2F", `assets%2Fsub%2Fx.png`; a name the bin has gets
    "%~2"… before the extension, which the encoding never makes) with its file time set to the move
    time; `recycled`/`restore` list and put back pictures (`from_bin_name`: exactly there, the folder made
    again if gone; never over a picture; `restore` returns its path, so the message names the folder).
    Nothing reads the older `assets_x.png` naming (never released).
    `picture_check_at`/`bin_pictures_at(now)`/`check_vault_at` for tests and the bench (their pictures
    are new); the dev server takes `X-Test-Now: <secs>` on `check`/`bin_pictures` for UI tests.
  - `app/safety.rs`: safety copies, kept IN the notes folder since Build 32 (the maintainer asked, Oct 28: Google
    Drive keeps them in the cloud; ~100 MB agreed): `logseq/.safety-<device>/<id>.copy`. Dot folders:
    Logseq 0.10 skips every path with a part starting with "." (desktop `ignored-path?`, its watcher,
    the phone's readdir) and reads no `.copy` file; the app's index, watcher (`.md` only) and picture
    check skip them too; `<device>` = "computer-1a2b3c4d" /
    "phone-…" (`device`: kind + 8 random hex, made once, `<data>/safety-device.txt`); a folder per
    device right in `logseq/` (not a shared `.safety/` with one inside per device: two devices making
    one folder before either synced leave Google Drive with two folders of that name, and a sync app
    may then see only one), so the laptop and the phone never make, write, trim or delete the same
    folder or file; both list and read both (`places`,
    `all_copies`; `CopyInfo.kind/mine`, History's `Version.made`; the UI says "this computer", "your
    phone", "another computer": `madeBy` in history.js). ONE file per copy (Drive syncs few files much
    faster than many): line 1 = its list as JSON (v 2: path, mtime_ns, size, before, `at` = [offset
    after line 1, length]; skipped with why), then the texts byte for byte (`bundle`/`read_copy`,
    which leaves out a copy whose texts don't all lie inside the file: damaged or half-synced). Written
    with `write_atomic_checked(Expect::Missing)` (temp file, rename; "-2"… if the name is taken).
    On `open` (never `--check`), in the background, notes whose files changed in the last 3 days; none
    if nothing changed since this device's newest; this device keeps of its own: newest 15 + the newest
    of each of the last 7 (UTC) days + every other copy of those 7 days holding earlier texts, trimmed
    to just those (`trim`: rewritten whole, renamed over; those texts ≤ 25 MB together); all copies in
    the notes folder together (both devices') ≤ ~100 MB of texts (`cap_all`: only this device's are
    trimmed or deleted, the oldest first, their notes as they were before the last 7 days' earlier
    texts; never its newest copy, nor its newest copy of notes; another device's are never touched; a
    device no longer used keeps its last copies until removed by hand; `run_within(cap)` for tests);
    ≤500 notes / 25 MB each. Never through a link or junction: `real_chain` (each folder from the
    notes folder down a real folder, made where missing) and `real_dir`/real files when listing.
    A notes folder that can't be written (`logseq/.safety-<device>` not a real folder, read-only, a write
    failing) keeps them on this device as before, `<data>/safety-copies/vault-<hash>/<id>.copy` (ids
    "local/<id>"; all notes folders' local ones ≤ ~100 MB; the problems log says so once per run; none
    if `<data>` is inside the notes folder); `move_local` (at each open, before the new copy) moves
    those, and the copies older versions kept there (a folder each: list.json + files +
    `.before/<n>/`), into the notes folder: written, read back and compared, only then removed here
    (one there already, the same, counts as moved); a damaged one stays, with a problems-log line;
    while the notes folder can't be written the old folders become one file each where they are.
    Also earlier texts ("before" entries numbered 1, 2… per copy):
    `App::replaced` holds every text that changes made elsewhere replaced or removed (several per note;
    ≤500 / 25 MB): at start-up from the index cache (files changed while closed), while open from
    `apply_changes`; `write_cache` first writes them into a copy of their own (`keep_replaced`, while
    the app waits, so `quick`: only its own folder's trimming, not `cap_all`, which reads the other
    device's copies that Google Drive may first have to fetch; the next background copy does it; if that
    copy can't be made, the cache isn't written: the one on disk still has them, tried again next
    time), so an old text is always in the cache or in a copy (`check_vault` never writes the cache).
    At start-up `load` leaves the cache unwritten when there are earlier texts; `start_safety_copy`
    keeps them right away, then writes the cache, then moves local copies and makes the copy of recent
    notes in the background. `<data>` = `set_data_dir` (Tauri `app_local_data_dir`: Windows `%LOCALAPPDATA%\com.srikanth.leanoutliner`, Android
    `/data/user/0/com.srikanth.leanoutliner`; dev server `$LEAN_DATA_DIR` or `<temp>/lean-outliner-dev-data`).
    Settings → Safety copies: list (both devices', "12 notes · your phone"), a copy's notes ("<page> —
    before a change made elsewhere" for an earlier text), a note's text, "Put this version back"
    (`before`: 0 or the earlier text's number on safety_note/safety_restore; ids "<device>/<id>",
    `split_ref`). Settings → Notes → "Deleted pages and pictures": pages (newest 50) and
    a "Pictures" section (all, newest move first, "Put back").
  - `app/history.rs`: a page's History (⋯ → History…, `ui/history.js`). Versions: its backup folder
    `logseq/bak/<file without .md>/` (Logseq's `<UTC>.<Desktop|android|ios>.md`, the app's `<UTC>.md`/
    `-2.md` from `backup`, which returns its path; dated by name, else file time; only plain files right
    in it, the folder really inside the notes folder) and the safety copies, both devices' (`copies_of`:
    as copied, dated by the copy; "before" texts by their own time; read from its span of the copy's
    file, `read_span`; `made` = which device). Newest first (≤100); the current text and a
    run of the same text (keeps the newest) left out; each says how it differs now (`merge::lcs` by
    note: more/fewer/changed, properties). Named "bak:<file>" / "copy:<device>/<id>:<n>": only names the listing
    gives are read. `history_keep` keeps the current text in logseq/bak (refused for non-UTF-8), then
    the editor saves the version (`Outline.putBack`: one Undo step, base_hash: merged or the clash screen).
  - `link.rs` `leanoutliner://` links: page, note, capture (below, "Pages"; tests in `tests/pages.rs`)
  - `start.rs` starting from scratch (tests in `tests/start.rs`): `new_folder` (the picker's "New
    folder": `folder_name_problem` refuses empty, `.`/`..`, `/\:*?"<>|`, a leading or ending dot,
    Windows' reserved names in any capitals; `create_dir`, never over a folder or file of that name in
    any capitals) and `start_notes` (a new notes folder: `pages/`, `journals/`, `logseq/config.edn` in
    Logseq's shape with 0.10's default date formats "MMM do, yyyy" / "yyyy_MM_dd" and `:todo`; with
    `demo`, the tour's 4 pages ("Start here" first, a favourite; a heading per topic, lines starting
    **Computer:**/**Phone:** where they differ; every instruction is the app's real behaviour: when a key,
    button, gesture or menu changes, change `DEMO` too) and today's journal note pointing at
    it). Refused in or inside a notes folder (`notes_folder_of`) or with a file named pages/journals/
    logseq in the way (checked before anything is made); files `create_new`, so nothing there is ever
    written over. `list_dir` also says `files` (how many) and `inside` (the notes folder above).
  - `update.rs` one-click update rules (tests in `tests/update.rs`): "build-N" → download address,
    the exact signed text (`lean-outliner-update\n<file>\n<version>\n<sha256>\n`), the signature file
    (`LeanOutliner-setup.exe.sig`: JSON file/version/sha256/sig = base64 r‖s), version checks
- `src-tauri/` Tauri 2 shell: one command `call(cmd, args)` → `dispatch`; `vault://` protocol for
  pictures; `watch.rs` file-change notices (ReadDirectoryChangesW / inotify) → `lean-files` event;
  closing waits for saves (`lean-close`); `android_capture.rs` the Android pop-up's way into the core
  (JNI, see "Android extras"); `win.rs` Windows link/shortcut/clipboard/clock; `links.rs`
  page and note links handed to the open app (below, "Pages");
  `capture_box/` the native Windows capture box and `hotkey.rs` its shortcut key's helper (below).
  `native_host.rs` the browser extension's receiver (Build 32): Edge starts the exe with
  `chrome-extension://<id>/` as its first argument (main.rs, first, before Tauri) → `clip::serve` on
  stdin/stdout with the last notes folder (`LEAN_CLIP_VAULT` overrides it, for tests), then exits;
  nothing stays running. `setup` (Settings → Capture → "Highlights from Edge" → Set up, commands
  `browser_setup`/`browser_status`; Windows only, the files are `include_bytes!` on Windows only):
  browser/ → `%LOCALAPPDATA%\com.srikanth.leanoutliner\browser-extension\` (Explorer shows it, for
  Edge's "Load unpacked"), `native-host.json` beside it (`clip::host_manifest`: this exe, only the
  extension's id), its path as the default value of `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\
  com.srikanth.leanoutliner` (and Chrome's); files written only when they differ. Once set up, each
  start (`refresh`, a thread) brings files and manifest up to date (Edge reloads an unpacked
  extension's files when it restarts). Uninstalling (hooks.nsh) removes both registry keys.
  `--check <vault> <out.json>` = read-only health check; `--capture`, `--capture-box`, `leanoutliner://`;
  `--hotkey` (the helper; handled first in main.rs, before anything of Tauri);
  `--verify-update <installer> <sig> <N>` (exit 0 = would accept it as build N; CI runs it).
  `update.rs` one-click updates on Windows, no updater plugin (+1 MB): only the installed app
  (`uninstall.exe` beside the exe; the portable copy gets the downloads page) and only with the public
  key built in (`option_env!("LEAN_UPDATE_KEY")`, base64 X‖Y, set by CI). Windows' own curl.exe (full
  path, https only) downloads build N's installer + .sig into `<cache>/update` (addresses made from the
  number; nothing from the page is a URL or path); CNG (bcrypt.dll, hand-declared like win.rs) checks
  SHA-256 + ECDSA P-256 against the key and that it's build N and newer; `update_install` persists,
  checks again through a handle held open (FILE_SHARE_READ: nothing can change or swap the file) until
  ShellExecute has started it with `/P /R /UPDATE` (passive, restart, no new desktop shortcut), and
  exits. Not while another copy of the program runs (Toolhelp32 by exe name, not our pid: another
  window, the capture box; the shortcut key's helper doesn't count, `hotkey::helper_pids`, and
  `update_install` asks it to quit first, `hotkey::stop`; if the install doesn't start it's started
  again): the installer's Restart Manager would close it without saving. curl gets
  `-q` first (no .curlrc). A failed check deletes the download. `tidy` removes an old one at start (>10 min).
  No Windows title bar (`decorations: false`): the UI draws its own. `#histbar` (wide windows: across
  the whole window, above the sidebar: the logo, the sidebar's button, Search (`.hb-app`), Home,
  back/forward, Go to date, the tabs, drag area, minimise/maximise/close), the sidebar's `.brand` strip
  (narrow windows' drawer only) and `#topbar` (narrow windows) get `data-tauri-drag-region` (the strip's
  buttons sit level, checked by t7_layout) and the window buttons only in the desktop app (`window.__TAURI__.window`,
  permissions in `capabilities/default.json`); never on Android (the drag call doesn't exist there).
  The capture box ("Add to journal", a launcher-style box like Spotlight): on Windows a native Win32
  window, `src-tauri/src/capture_box/` (Win32 declared by hand in `ffi.rs`; no web engine, so it shows
  at once with the app closed), made straight from `main` for `--capture-box`, `box=1` links and the
  `--capture` fallback (`open_box`); if that window can't be made (or not on Windows), the reason
  and the words handed to it go to the problems log and the app opens instead (no web box since
  Build 32). Its rules
  are platform-free in `outline_core::capture_box`, tested in core/tests/capture_box.rs: pre-fill (a
  link's words, else the clipboard's, selected), Enter adds (ignored in its first half-second: an Enter
  meant for another window; once while adding), Shift+Enter new line, Esc / × / Alt+F4 close (not while
  adding), clicking elsewhere closes it when nothing new is in it (empty, or the clipboard's text
  untouched; text from a web page stays; while a mouse button is held it waits, so files can be dragged
  in), sizes (`layout`: 640×98 for one line, grows to 6 lines then scrolls), the page list's order
  (`rank_pages`: Ctrl+K's `match_name`), smooth shapes (`Canvas`). Native look: built like Tauri's frameless windows
  (WS_CAPTION with the frame trimmed in WM_NCCALCSIZE, `insets`) so Windows 11 draws the rounded
  corners, shadow and thin border; on top, not in the taskbar (a hidden owner window); per-monitor DPI;
  colours from `<cache>/look.txt`, which the app writes from the CSS tokens when the look changes
  (`save_look` command, `lookColors` in app.js; Calm's colours if missing); Segoe UI Variable/Segoe UI;
  Windows' own EDIT controls (IME, clipboard, right-click menu, screen readers; Ctrl shortcuts never
  fire with AltGr). The "+" button (or Alt+↓ / Ctrl+Space) opens a native menu: Picture or file…
  (GetOpenFileNameW; also Ctrl+V of a picture or of files, and dropping files): linked at once under
  the name it will get (`app::asset_file_name`, Logseq's, its own extension or none; `asset_markdown`),
  but copied into assets/ only when the note is added (`save_asset_file_at`, never over a file;
  `swap_all` fixes a link whose name was taken meanwhile), so a box closed without adding leaves
  nothing; a pasted bitmap becomes PNG (GDI+) on a helper thread ("Copying…"; Enter waits for it).
  To-do (TODO, or LATER with `:preferred-workflow :now`; a mark left of the text). Add to another
  page…: when the box opens, a helper thread opens the notes folder read-only with the app's own code
  (`App::open_read_only`: the index cache is read, only changed files re-read, the cache never
  written; a config.edn that's there but can't be read stops it, never guessed; `--check` uses it
  too, and the app itself, below), so the list (`App::page_list`,
  recently changed first, "Loading pages…" until then, a plain problem if it fails, and then no other
  page can be picked) and what's typed (`App::page_target`: title:: names, aliases, the first of two
  files with one name, a journal date → "Journal: …", a new page's file as the editor gives it
  (`Vault::free_rel`, below), names no file can have refused) are exactly the app's;
  `App::capture_to_page` re-reads changes and resolves the page again right before adding, writes a
  new page only where no file is (`Expect::Missing`, else it looks again), and is done the moment the
  note is written. The usual place: `capture::capture_to_usual`, also `--capture` and the browser
  button; today's journal needs only the settings, the quick capture page is found as everywhere
  (the notes folder opened read-only, then `App::capture_to_page`). Both add with
  `capture::append_note`: the file is read again and the new text written only if nobody saved it
  meanwhile (`app::write_atomic_checked`, its own temp name `.<file>.<pid>-<n>.tmp`, a refused rename
  retried ~0.5 s; the first save into a folder in a run removes such temp files over a day old),
  else redone (3 tries, then it says so and keeps the text). Pressing the shortcut again finds the
  open box (window class + title) and brings it forward, handing it a link's words (WM_COPYDATA,
  `pack_words` with the time sent: words arriving after the sender stopped waiting are dropped;
  `Rules::more_words`) and starting the Enter guard again (`Rules::ready`, also when it's in front,
  and for Enter in the page list), so the Enter that answered the browser's "Open Lean Outliner?"
  prompt can't add the note; a box that's adding or closing says no and a new one opens.
  `default_place` says where the note goes; `last_vault_or_why` says why not. Known
  limit: Narrator can't reach the drawn "+" and × or read the bottom strip's messages (the text boxes
  and the menu are Windows' own and work). `--capture-box-selftest <dir>`: CI's check (below).
  Its shortcut key (Settings → Capture, e.g. Ctrl+Shift+L): `src-tauri/src/hotkey.rs`. Windows' own
  way (a Start-menu shortcut with a Hotkey) took ~3.1 s on a typical laptop (Explorer asks every window if
  the key is theirs and waits ~3 s for one that hangs; our exe starts in 22–121 ms), so the installed
  copy has a tiny helper (the maintainer agreed to its cost): `lean-outliner.exe --hotkey`, started with Windows
  (HKCU\…\CurrentVersion\Run, value "Lean Outliner shortcut key" = `"<exe>" --hotkey`). It reads
  `<cache>/hotkey.txt` (`outline_core::hotkey`'s spelling "Ctrl+Alt+Shift+K", tested in
  core/tests/hotkey.rs; empty = off; a sign that isn't a letter/digit/F-key/named key is found with
  VkKeyScanW), RegisterHotKey (MOD_NOREPEAT, no window: it comes to the thread) and on WM_HOTKEY
  starts `<exe> --capture-box` (CreateProcessW suspended, AllowSetForegroundWindow, resumed; no
  handles inherited, cwd = system32, out of the job when allowed). No timers, no polling (it sleeps in
  GetMessage), no Tauri/WebView2, EmptyWorkingSet after start and after each box (CI, Oct 27: 52 KB
  in RAM, 1.5 MB private, 0 CPU while waiting, 26 system DLLs, none webview; the box on screen 40–120
  ms after the key; Explorer does hold an old .lnk's key, and lets go ~0.5 s after the .lnk is
  removed: moving it took 550 ms). One at a time:
  starts take turns (mutex `Local\LeanOutlinerHotkeyStart`); a new one takes its key first (an old one
  holding the same key is asked to quit first), then asks the others that hold a key to quit
  (WM_CLOSE to the message-only window, class `LeanOutlinerHotkey`, title "Lean Outliner shortcut
  key: <key>", which is how the app knows the running key, `running()`). The window is made first
  thing, titled "Lean Outliner shortcut key (starting)" until the key is held, so a helper still
  starting is known too (`helper_pids`; update.rs's other-copies check also looks once more 300 ms
  later if it saw any, for the milliseconds before the window) and quits at once when asked
  (PeekMessage for WM_CLOSE while it tries for the key). A key it can't get within 4 s (Explorer
  letting go) → the problems log and `<cache>/hotkey-status.txt` (`why` in the maintainer's words; removed once a
  helper holds the key), exit 3 (4: a key Windows can't use). The app's side (`set`, Settings'
  Save/Remove; it returns the key as saved; `get_shortcut` = `status`: `{key, helper, running,
  starting (the app handing it over, or a helper still starting), fallback (the old .lnk still
  answers it), why}`; Settings shows a `.banner.key-state` line when it isn't running, "is starting…"
  re-asked each second, else why and Try again = Save of the same key): `turn_on` saves the key,
  sets Run, starts a helper and waits for its answer (its window with the key, or its exit code; ≤15 s), then
  removes the old Start-menu shortcut `Lean Outliner capture.lnk` (the maintainer doesn't want it any more). With
  the same key as that shortcut (Explorer holds it) the shortcut is removed first (SHChangeNotify) and,
  if the helper can't take the key, put back byte for byte, with hotkey.txt, Run and the old helper as
  they were. `turn_off`: hotkey.txt "", Run removed, helper asked to quit, shortcut removed. App start
  (`at_start`, installed copy only, a thread): `ensure` — no hotkey.txt yet (first start after the
  update) → the shortcut's key (read from the .lnk header, `outline_core::hotkey::lnk_key`) moves to
  the helper; otherwise the helper must run with the saved key (else `turn_on` again) and Run point at
  this exe. The portable copy keeps the old way (`win::set_capture_shortcut`, the .lnk with a Hotkey
  via WScript.Shell; its exe can move, which Run wouldn't follow). The installer/uninstaller stop the
  helper too (`src-tauri/windows/hooks.nsh`, Tauri's NSIS `installerHooks`: before Tauri's own
  "is the app running" check); uninstalling (not an update's) also removes the Run value and the .lnk.
  Wide windows scroll the pane only (`#main`, and `#main2` on the right; under `#histbar`, so the scroll
  bar starts below the strip); narrow windows/phones scroll the whole page. Keyboard scrolling of the
  active pane: `App.focusForScroll` (makes it focusable only then: always focusable, grabbing its scroll
  bar would pull the focus out of the block being edited). `noteTop`/`restoreTop` keep the reading
  position across the 860px switch. `App.draw(pane)` lets only the newest of quick successive moves in
  a pane finish (`pane.seq`); views check `view.isConnected` / `list.isConnected` after each await
  before adding outlines (to `paneOf(view).outlines`).
  CSP in `tauri.conf.json`: no inline scripts (hence `ui/boot.js`), images from vault/https.
- `ui/` plain HTML/CSS/ES modules, no build step. `api.js` (bridge) · `render.js` (inline Markdown)
  · `math.js` (small TeX) · `editor.js` (block editor, undo, selection, saving, conflicts) · `app.js`
  (routing, journals/page views, back/forward + title bar, sidebar, Look picker, shortcuts,
  phone toolbar, rescan) · `search.js` (the search box, `App.sbox`, two modes in one box as in
  Logseq: search (Ctrl+K: Pages, "New page: …" after them, Notes drawn by `renderBlock` minus
  pictures, two lines, cut before the first word found (a Range), words marked `mark.hit` by the
  same `fold`; Enter / Shift+Enter (to the side) / Ctrl+Enter (new tab); opened empty: recent
  searches, kept per notes folder in localStorage `recentSearches` {folder: [≤8]}, saved when a
  result is picked, "Clear"; then `App.recent()` minus the page open) and commands (Ctrl+Shift+P =
  `command-palette/toggle` in DEFAULT_KEYS, Logseq's name; the footer button swaps modes; phones: the
  menu's "Commands", `.cmd-btn`, narrow/touch only). The note being edited when it opened is edited
  again on Esc or before an editing command (`editingNow`/`editAgain`) · `commands.js` (the command
  list: `commandList(app, ed)` calls the app's own methods (App, Tabs, Find, Outline, the / menu's
  `SLASH` and `Outline.command`, `openHistory`, settings' `TABS`, `SKINS`), never copies of them; each
  shows its key from `app.keyMap` (`key`: an action name) or fixed keys (`keys`), `keyHtml` draws
  them; groups Editing / Selected notes / Page / Go / Window / Look; `more` = only when typed for) · `views.js` (All pages, tags, props, to-dos; no Calendar tab, the maintainer removed it) · `welcome.js` (the
  welcome screen, below "Starting fresh") · `settings.js` (tabs Notes / Look / Capture / Shortcuts (not on phones) / About, at `#/settings/<tab>`;
  About's `feedbackCard`: "Send feedback" opens a new issue on the public GitHub repo in the browser
  (`feedbackUrl`: the first line as the title, the message, then only "thinky <version> · <system>";
  `FEEDBACK_URL`), through `App.openUrl`. The app sends nothing itself; no email box, no problems log.
  t16_feedback checks the address and that no request leaves the page.
  About's `updateBox`: "Update now" (with the download's size, from GitHub's answer) → download, check,
  `App.saveAll` (also used when closing; refuses with unsaved changes or a clash), then on Windows the
  page goes inert (nothing typed after the last save) and, if About was left, a message says it's
  installing; one update at a time (`job`), shown by whichever About box is open, `data-stage` for tests
  (t13_update);
  the last one remembered) · `popups.js` (suggest,
  slash menu, date picker with dots on days that have notes (`journal_days`), menus, dialogs, hover
  preview) · `calendar.js` (month grid) · `dom.js` (icons) ·
  `paste.js` (formatted paste) · `export.js` (Copy page as text)
  · `move.js` (notes dragged to another page, loaded on first use) · `filedrop.js` (files from Explorer)
  · `find.js` (find and replace on the page: Ctrl+F / Ctrl+H,
  the page menu on phones; searches the notes' file text minus what isn't shown as typed
  (`hiddenSpans`: hidden properties, SCHEDULED/DEADLINE lines, drawers, box BEGIN/END lines, quote
  marks, link addresses, whole pictures, formulas ($…$, $$ blocks), ((refs)), {{macros}}, the to-do
  word, priority and heading marks; a match touching one is skipped); CSS `::highlight()` marks what's
  found (not words the app adds: date chips, to-do words, `[data-auto]` = a box's default title, the
  "↗ block" label); replaces through `setText` so Undo works; Replace all in several pages asks first;
  right after a replace, Ctrl+Z (bar or page) or the message's Undo undoes it on every page it changed,
  if that page's newest Undo step is still the replace's; leaving the page forgets it) ·
  `tabs.js` (below) · `history.js` (a page's History: the list, a version drawn by a preview `Outline`
  (`opts.preview`: read-only, clicks do nothing, never saved), "Put this version back": refused while a
  clash on that page waits (`clashWaiting(o)`), "Undo" in the message; zoomed in, the whole page shows
  again) · `skins.css` · `app.css` (`.panel`: the big dialog the clash screen and History share; the
  whole screen on phones). `App.toast(msg, ms, {label, run})` can carry a button (Undo).
- Tabs and two pages side by side (`tabs.js`, Build 21; wide windows on the laptop only, like VS Code).
  `Tabs.panes`: left `#main` (always the first) and right `#main2`, each with its own `tabs`
  (`{hist, at, top}`: a back/forward list, and how far down it was) and `cur` (the one shown), its
  `outlines` and drawing state. `app.outlines` = both sides' (a getter); `app.pane` = the active side,
  where links, the sidebar, search, find (`find.js` uses `app.pane.outlines`), keys and Back act (last
  clicked or focused, or a press on its part of the strip; marked by its tab's accent line;
  `Tabs.activate` stops the old side's editing, clears its block selection, `App.active` (unless on the
  new side) and find's replace Undo, so Delete/Tab/Ctrl+Z never act on the side the maintainer left). Only a real
  click or tap makes a side active: not the wheel, not a press on its scroll bar (`onScrollBar`) or the
  middle button away from a link on the other side (both also keep the focus where it was), not a
  touch that scrolls (touch: on `click`), so letters typed on one side never become shortcuts on the
  other. Only shown
  tabs are loaded: `App.draw(pane)` (the old `route()` body) draws a pane's place after saving,
  `scrollBack` puts a tab's scroll back. The address is always the active
  pane's place (`sync`, replaceState); `route()` → `fromAddress`: a new address is a new place in the
  active tab, the browser's own back/forward (`history.state.n` as before; `App.histN`, used by the
  Android test) moves it as many steps; Alt+←/→, the mouse buttons, Android Back and the phone bar's
  arrows use `move(±1)` on the active side. The strip: each side has its own Home, Back, Forward and Go to date
  (`.hb-nav[data-p]`, `sideNav`; the right one's only exist while there are two sides, drawn by
  `layout()`), acting on that side (`updateHistBar` greys each by its own tab), then its tabs (a
  `role="tablist"` of `role="tab"` only, `aria-controls` = the pane; at least 96px, then the strip
  scrolls sideways), then its "+" (`.tab-new[data-p]`, outside the scrolling part); the left half starts
  with `.hb-app` (logo, sidebar, Search), which belongs to no side. Keyboard: the shown
  tab is in the Tab order (the others tabindex -1), ←/→/Home/End move along, Enter/Space show, Delete
  closes (`tabKey`); a mouse press never gives a tab the focus (Space/arrows go on scrolling); the × is
  `aria-hidden` (screen readers hear the page's name only).
  Settings' own tabs (`#/settings/look`) rename the tab's place (`Tabs.replace`: no step for Back; in
  the address only on the active side). A page with a clash can't be left (not even redrawn, e.g. Home
  on the Journals list): `draw` puts the pane back (`drew`/`undo`); moving a tab between sides and
  closing a side check first (`App.canLeave`); rename (redraws both sides) and delete wait too
  (`clashWaiting`, again after saving; rename also refuses while typing couldn't be saved, which the
  redraw would drop). Typing that couldn't be saved goes to logseq/bak whenever a page leaves the
  screen (`keepCopy`: `draw`, `dropPane` for a side that closes, a deleted page). The same page on
  both sides never clashes with the maintainer's own words:
  - `draw` first saves the other side's unsent typing (the page it reads may be that one); one editing
    box at a time (editor.js stops editing on blur unless a pop-up is open, `.pop:not([hidden])`; the
    bars' and the message's buttons don't take the focus, `QUIET_BUTTONS`).
  - Editing that starts on one side (`Outline.edit` → `App.takeOver`) while the other has typing not
    saved yet, or a save on its way, or this side missed a save from there (`behind`): if both read the
    same file version and differ in at most one note's words (`oneNoteApart`), that typing comes over
    at once (`Outline.takeFrom`: doc, base, hash); else `editAfterSave`: the other side stops editing
    and saves first, this side reads the page again, then the clicked note opens, found again by its
    words (`findAgain`: unchanged start/end by place, else same words, else most alike; `caretAgain`).
    Meanwhile a hidden box (`.ed-wait`) has the focus and takes what the maintainer types (IME, AltGr, paste too);
    Enter, Tab/Shift+Tab, Esc, and Backspace/Delete on an empty box are kept as steps, and `App.replay`
    types it all in through the editor (split, indent) once the note opens; a word still being composed
    with an input method then is waited for (`compositionend`, at most 10 s). No time limit: after 1.5 s
    it says "Saving the other side first…". What can't go in (the maintainer clicked elsewhere, a clash, the note is
    gone, typed after Esc) goes to logseq/bak and a message (`keepTyped`), never dropped without a word.
    Closing (`lean-close` → `App.saveAll`, as before an update) waits for a note that's opening
    (`App.opening`: editAfterSave's promise) so it takes the typing and is saved too; if it can't open in
    time (a quarter of saveAll's time, at least 1 s, is kept for saving), its `keep()` puts the typing
    in logseq/bak instead (so does a page unload).
  - `saved(o, file)` (file: what the file holds now, from `Outline.save`) marks the other side
    `behind` and `catchUp`s it: one note's words changed → that note updated in place
    (`Outline.takeSaved`: no re-reading, no redrawing a long page); else read again, its reading place
    kept (`readingPlace`/`backToPlace`), selected notes let go; a side editing with nothing typed reads
    again at once and reopens the same note (`Outline.refresh`); a side with typing of its own merges on
    its save; `editing()` retries when its editing stops. A zoomed-in note is found again by its words
    (`Outline.rezoom`, in reload/refresh/applyMerged; `takeSaved` works its line out again) and the
    tab's place follows (`App.zoomMoved` → `Tabs.replace`). Zoom line numbers count each note's lines
    as the file has them (`fileLines`: its lines as read while its words have as many, else the words').
  - If it still clashes with the other side, the words say so (`Outline.elsewhere()`: "on the other side
    of this window" when `behind` at the clash, `fromSide`); a clean merge of the two sides shows no
    "Changes made elsewhere" message.
  `reloadPage` covers both sides. Settings open on both sides: ids and the capture card's radio group
  get a suffix when taken (`free` in settings.js). Choosing another notes folder
  (`useVault`): `App.leaveAll` saves and stops both sides first, then `Tabs.reset` (one side, one tab).
  Ctrl+click / middle button: a new tab; Shift+click: the other side (Logseq's Shift+click; `Tabs.how`,
  read by `App.go`); page menu: Open in a new tab / Open to the side / Close this side. Ctrl+T, Ctrl+W,
  Ctrl+Tab(+Shift), Ctrl+PageUp/Down: a capture-phase listener, before the editor's Tab. Dragging a tab
  (pointer events: HTML5 drag and drop doesn't reach the page in the Windows app while Tauri's file drop
  is on) along a strip, to the other strip, or onto a half of the notes. Kept: sessionStorage `tabs` (a
  reload, with back/forward) and localStorage `tabs` (the next start; only with 2+ tabs or two sides,
  never on Android, so one tab starts on Journals as always; with its notes folder `vault`: another
  folder doesn't get them; a page gone meanwhile, with no file and no links to it, doesn't come back).
  Narrow windows and phones: no strip, only the active side shows (`#col > .pane:not(.act)` hidden),
  Ctrl+click opens in place. CSS: the "tabs" block at the end of app.css (`#col.split` grid, the left side
  `--split` of the width; `#app.split > #histbar` in two `.hb-h` halves, the left one `--sw` + its side,
  so each side's buttons and tabs sit above it; tabs.js `layout()` sets both classes). `#histbar`, its `.hb-h` halves
  and `.tabs` are `data-tauri-drag-region` (bare: only presses on them directly move the window, so
  the gaps and the empty end of each half do; a button or a `role="tab"` never does).
- Navigation and layout (Build 29; app.js `sideExtras`/`grip`/`slide`, tabs.js `linkMenu`; t15_nav):
  - The top strip runs across the window (`#app` grid: row 1 `#histbar`, row 2 `#side` | `#col`); nothing in
    it moves when the sidebar opens or closes. Hiding (`toggleSidebar`): `--sw` (the sidebar's column)
    goes to 0 at once and the sidebar slides off by a CSS transform (`html.sliding`, 200 ms, the same
    curve as `SLIDE_EASE`); `App.slide` slides what moved (each side's `.view`, the find bar, the right
    side's strip buttons) from where it was by WAAPI transforms (FLIP): one layout, no layout per frame,
    so 3,000-note pages slide smoothly; none with reduced motion or in narrow windows. A hidden sidebar
    is `visibility: hidden` (out of the Tab order).
  - Handles (`App.grip`, role separator, ←/→, double-click resets): `.side-grip` on the sidebar's edge
    sets `--side-w` (200–480 px, at most half the window; `--side-now` caps it), `.split-grip` on the
    line between two sides sets `--split` (each side ≥ 340 px). Kept in localStorage `sideW`/`splitAt`;
    boot.js puts them (and wide mode) on `<html>` before anything paints.
  - Wide mode (`ui/toggle-wide-mode`, `t w`, configurable in `:shortcuts`; the page ⋯ menu on wide
    windows; Settings → Look; `App.setWide`, localStorage `wide`): `html.wide .view` has no max-width
    (Settings keep theirs: `.view[data-kind]`, set by `draw`).
  - Page link menu (`Tabs.linkMenu`: Open in a new tab / Open to the side, by passing the click on with
    Ctrl or Shift, then `App.linkItems(a)`: "Remove from favourites" for `#favs` entries): a right-click
    on any page link (sidebar, All pages, Tags, Properties, reference headings…) or search result
    (`#search .results li` of a page or a note: `.r-page/.r-recent/.r-hit`, not headings, commands,
    recent searches or "New page"), and the ⋯ beside the Favourites/Recent entry under the mouse (one floating
    `.side-more` button, `position: fixed`, so the entries' markup is unchanged). Wide windows only
    (`Tabs.on`).
  - Favourites by dragging (`App.dragFavourite`: mouse at once, a finger after a 450 ms hold; the entry
    moves among the others live, Esc puts it back; Alt+Shift+↑/↓ from the keyboard) → `moveFavourite` →
    `reorder_favorites` (the names in their new order; ones added or removed elsewhere meanwhile keep
    the file's places).
  - Folding: a day in the Journals list from its date (`.day-fold`, `App.foldDay`; `.sheet.day.folded`
    shows only its date) and a page's group of references from its heading (`.grp-fold` in `refGroup`,
    `foldGroup`; a group that starts folded draws its references only when opened, `grp.later`), both
    kept for the session (sessionStorage `dayFolds`, `refFolds`). Laptop: the arrow left of the date / in
    the group's margin, on hover; phones: at the right end (weekday line / heading), always faintly.
    A folded day's notes are never acted on unseen: keys and commands that don't name an outline use
    `App.mainOutline()` (the last used if it `shows`, else the active side's first that shows: Ctrl+A,
    Ctrl+Shift+A, t o, Undo's fallback), and what must change notes there opens the day first
    (`App.unfoldFor`: Undo/Redo reaching a step there, the phone's "+", find going to a match there).
  - Note menu: compact on a laptop (smaller swatches, heading buttons and rows); with `(pointer:
    coarse)` finger-sized and compact too (two to a row, "Phone chrome" below). Hover preview (`Preview`): the whole page (folded notes' sub-notes left out) in
    a box that scrolls, drawn 60 notes then 150 more each time it's scrolled near the end; its title or
    a link in it opens that page (`App.go`). Not grabby: it takes the mouse only once entered on purpose
    (`.pv-wait` = pointer-events none until the pointer rests in it 300 ms, or the wheel turns over it,
    which then scrolls the box), so a click on a note under it reaches the note; before that, the pointer
    going anywhere but the link or the box closes it in 120 ms.
- Outline drawing (app.css): each level steps in by `--ind` (= the look's `--indent`, 24px, Plain 29px
  like Logseq; 20 on narrow screens). Pale lines
  (`--guide`) only: `.blk::before` draws the lines of the levels above through a row, `.blk::after` a
  note's own line (when its children show). A line leaves room by the dots (the maintainer asked, Build 32): it starts
  `--guide-gap` (8px) under the parent's dot, the same when its words wrap onto more lines or it's a
  heading (round 2: not under its last line) and stops at its last note's words (`--guide-end` above the end of that row):
  `editor.js` `blockEl` sets `--e` on the last row of a branch (the depth of the next shown row; the
  levels from `--e` to `--d` end there, a second, shorter background layer); `showThread` (the line
  under the mouse) reads the same tokens. t16_looks measures the gaps in the drawn pixels. Phones and
  narrow windows: even sides, the outline reaches out `6.5px + --bullet-w / 2` on the right, so the
  words end as far from the right edge as the dots start from the left in every look (a note with an
  arrow keeps its words 18px + that short of it). Nothing sits on a line: the fold
  arrow is left of the dot on a laptop (hover), at the right end of the first line on phones and narrow
  windows. `--bul-h` = height of the first line (headings: `editor.viewEl` sets `--hf`; `--h-grow` 0 in
  looks with a fixed line height). No `:has()` in per-block rules (it slowed 3,000-block pages).
  `--bc-pad-y` (3px; Plain 2px) = the room above and below each
  note's words; with `--lh`/`--line-box` (1.5; Paper 1.65) a one-line note is 29.3px
  (Plain = Logseq: 16px words, 24px lines, 28px; Paper 34px, its own rhythm; Build 29 tightened them all
  from 34.8px). A folded note's dot is ringed in `--bullet-ring`. Dots on a laptop: hovering one shows
  a soft round patch (`--bullet-hover-bg` = the ring's colour, `--bullet-hover-size`,
  a `::before` made only while hovered) and scales it 1.2 (no animation with reduced motion; not on
  touch, not number lists). Done/cancelled to-dos: words at `--done-fade` of their colour (links too),
  line-through in that same colour (`--done-line`, currentcolor), as Logseq; a heading gets it too, the
  properties box doesn't (inline-block). Properties (`.props`, a note's and a page's): a pale rounded
  box, one `.prop` per line, tokens `--props-bg/-border/-radius/-pad/-gap/-size/-key-*/-val-ink`
  (Paper: a dashed pencilled box). The hand cursor: one `:where(...)` rule (zero weight) in app.css
  ("the hand") for links, buttons, tabs, selects, choices; a note's words keep the text cursor, the
  window buttons the arrow. Sidebar: the pages under Favourites/Recent step in 21px from their headings. Page properties sit in `.page-head` under the title; a page without any shows nothing
  there (the maintainer wanted it minimal): the ⋯ menu's "Add properties" opens the box (`renderPageProps` sets
  `box.edit`/`box.has`, `pageMenu` reads them). Properties written as the page's first note (only
  `key::` lines: Logseq's way, `parse.rs` takes them as the page's) show in that note, not again under
  the title. Journal days: `.day-head` (a small faint weekday above the date; no icon; in the Journals list a
  fold arrow, `.day-fold`). Journals list
  days are `.sheet.day` (the maintainer asked for room, like Logseq; roomier again Build 32): its padding + 30px above,
  + 32px below (18/20 on phones), `.day-body` 28px under the date (20), a day's references 36px under its
  notes (28), `--day-gap` between days (64px; Calm 32px, the maintainer found its gap too big, round 2; on phones at
  most `--day-gap-phone`, 40px, Calm 22px; Plain 20px = the hairline's space below it, the same as above,
  ~48px each on a laptop: kept over Logseq's 48px above and 24px below, t8_phone and t16_refs check it),
  and a least height, 250px (today 400; phones 200/300; Logseq: 250/500), so short days don't crowd
  together. A day with no notes yet (`daySheet`: one empty note; often a day only other pages link to):
  `.day-body.blank`, 140px (116 on phones) under its empty note ("Click to write…", "Tap to write…" with
  `pointer: coarse`, editor.js `viewEl`), a click there edits that note, so it's plain nothing is written and
  its references sit well below. Dates are page-title size on a laptop (`--title-size`), `clamp(26px, 8vw, 34px)` on
  phones (the longest, "September 30th, 2026", fits one line in most looks). No "On this day" (the maintainer
  removed it). Go to date: a calendar button after Forward in each side's strip (`sideNav`; the right side's
  hides in a two-sided window under 940px with the sidebar showing, else the window buttons get
  pushed off) and before Search in the phone bar (Journals list only, `#topbar.journals`, so a
  page's name keeps its room); g d opens it under the active side's. Sheet spacing: `--sheet-pad-top`/
  `--sheet-pad-bottom`/`--sheet-gap` (Plain: no cards, equal space around the hairline between days).
  Filter rows (`.chips`, `fitChips` in views.js) stay on one line, scrolling sideways only if they must.
  The phone bar (`#topbar`) has back/forward like `#histbar`; Home greys out where it would do nothing
  (on the Journals list, already at today: `App.updateHome`, also while scrolling), staying in place so
  the buttons beside it never move. The editing toolbar (icons for every button, Italics = `*…*` as
  Ctrl+I) keeps "close keyboard" (`.tb-pin`) at its end.
  Undo/Redo follow the page's changes in order across its outlines (the Journals list has one per
  day): `Outline.snap` → `App.stepped(o)`; `App.undo/redo(from)` take the newest step of an outline
  on the active side (keys, the phone bar), `App.unstep` when an outline undid one itself (a message's
  Undo, find's replace).
  Flashcards (reviewed elsewhere, e.g. in Anki through a Logseq plugin; no review mode here): `{{cloze X}}`
  shows X, marked (`.cloze`); find matches X, never `{{cloze`.
- Reading and writing (Build 18): `render.js` turns `#+BEGIN_NOTE…#+END_NOTE` (TIP, IMPORTANT, WARNING,
  CAUTION, PINNED) and `> [!KIND] title` quotes into `.callout` boxes (`--c-note`… colours in skins.css;
  `--callout-gap`/`--callout-pad` 0 in Paper so the words stay on its lines), other `>` lines and
  `#+BEGIN_QUOTE` into quotes, `#+BEGIN_SRC/EXAMPLE/QUERY` into code. A note starting with a box or quote
  gets `--lead` (editor.viewEl) so its dot moves down to the first line of words. A `#+BEGIN_` is a box
  only when its `#+END_` follows (`hasEnd`, also used by find); code fences inside a box stay code;
  VERSE keeps its spaces. Page icons: `icon::` (`PageEntry.icon`, `App.icon(name)`, `.pg-ic`; a save
  that touches `icon::` refreshes the names). Long pages: `.pins` (sticky, `Outline.pinParents`, called
  once a frame while scrolling by `App.pinSoon`; the row at the top is found by `rowAt`, a binary search
  over `Outline.divs`, the drawn rows by note, which also makes `blockDiv` a lookup) shows the parents
  of the note at the top; `#main`'s scroll-padding-top grows by the pinned rows (and `Outline.edit`
  sets it for the edited note's own parents first) so scrolling a note into view keeps it below them;
  hidden while typing on a phone. Phones: `Preview` takes a
  press and hold on a link (450ms; the click after it is swallowed, and so is the tap that closes it;
  "Open" button); a sideways swipe on a note's words moves it in/out a level (`Outline.shiftLevel`, no
  keyboard; cancelled when the finger drifts > 24px up or down or the page scrolls, or on touchcancel;
  the message offers Undo), a swipe in from the left edge (< `EDGE` = 48px) opens the menu, a swipe left
  closes it. Editing: `[` with words selected wraps them (twice = page link), a web address pasted over
  words makes `[words](address)` (not over an address, nor inside a link's `(…)`). The find keys give
  way to a note's own use of them (`:editor/highlight "ctrl+h"`).
- Pictures (Build 20): `render.js` `image()` wraps each in `.pic` (`data-md` = its link as written) and
  reads Logseq's size right after the link, `{:height 200, :width 300}` (Logseq writes it so: height
  first, ", ", whole pixels; it reads EDN, so any order, commas, decimals, one key): that width, own
  shape. Without one: at most `--pic-max-h` tall (app.css, 320px; 260 on phones). Editor: a corner handle
  `.pic-h` (hover on a laptop, always on touch; at most a third of the picture, so a small one still
  opens; none when read-only): `dragPicture` (pointer events), then `sizePicture` → `withPictureSize`
  through `setText` (Undo); double-click = no size. Touch: `touch-action: pan-y`, so an up-down swipe
  from a corner scrolls and a sideways drag resizes. Refused (with the reason) when the same picture is
  also written as code or as a property value in that note. `text.rs` `pieces()` keeps the size with
  its picture (never linked as words); the clash screen suggests the other copy when this device only
  changed a picture's size. The widget's `clean()` drops the size too.
- Linked references (Build 28, as Logseq shows them): `Vault::linked_refs` gives each referencing note
  with what's around it (`RefHit::with_context`): `parents` (the notes it sits under, first lines only:
  the faint path `.refpath` above it) and `kids` (its sub-notes, ≤ `REF_KIDS` = 50: over that, whole
  levels nearest it first; `more` = how many left out, "… N more" opens it zoomed in); a note already
  among an earlier one's sub-notes isn't listed again. Unlinked references and property matches stay one
  row each (no context fields in their JSON). UI: `App.refTree` (`groupsEl(…, {tree: true})`: a page's
  and a journal day's linked references; clicks `refClick`, one listener per list, a row or a path part
  goes to that note in its page): the reference row as in other lists, sub-notes `.kid` with the look's
  dot (`--d` = its column, `data-d` = levels below the reference), folded from
  `:ref/default-open-blocks-level` on (`Config::ref_open_level`, default 2: the note and its children
  open) or by their own `collapsed:: true`, with the outline's `.fold` arrow and ring (`--fold-x`). Rows are
  made only when they show (`drawRefs`), and a page's references are drawn after its notes, in ~12 ms
  slices (`fillRefs`): a page linked from hundreds of notes opens as fast as any (t5_long checks it). The
  hover preview shows only a count. A page shows "Linked references" only when there are some, and the
  folded "Unlinked references" only when `unlinked_any` finds a mention, asked after the page shows
  (`App.addUnlinked`, as for the Journals list's days; worst case = the bench's `day_unlinked_ms`).
  Each page's group folds from its heading (Build 29, above).
  How they look (Build 32, the maintainer asked: they read as one document; Calm's sat on the tinted page): each page's
  references (linked, unlinked, a day's) in a box of its own, `.refgrp`, sunken into the page like a well
  (tokens `--refgrp-bg/-border/-radius/-shadow/-line/-gap` per look: Calm a white well with a firm inner
  shade at the top and a light edge below (round 1's; the maintainer tried a softer one in round 2 and asked for this
  back, round 3); raised sheets' `--sheet-shadow` only blurred layers, no hard offset (round 2, the maintainer kept
  it), except Sticker/Sticker night's drawn ones); Plain/Plain night/teal Logseq's flat grey box; Paper a pencilled slip; Night/Grimoire a dark
  well), headed (`refGroup`) by its `icon::` emoji, or a small calendar (`.grp-day`) for a journal day,
  the name (16px, 600) and "N notes" (`.grp-n`); a faint line (`--refgrp-line`) between its notes. Linked references from 2+ pages (a page's, and a
  day's in the Journals list) get `App.refTools(sec, groups, host, fill)`: three small quiet icon buttons
  at the right end of the heading (`.sec-h.has-acts`: its words in `.sec-t` on the left, `.ref-acts` on the
  right; the maintainer asked, Oct 29 round 3, no row of tools): Filter (`.ref-f`; a click opens the filter box under the
  heading, `.ref-tools`, focused; again, or Esc in the empty box, closes it and empties it), Sort (`.ref-s`,
  Last changed ↔ Name, `data-sort`, its icon `ICON.sortChanged`/`sortName` and tooltip say the order now)
  and Fold all (`.ref-fa`, `ICON.foldAll`/`openAll` and the tooltip say which it does). Each `.ref-tbtn`
  has an aria-label and title; on phones 30px, 40px to a finger by `::after`, the heading no taller. Kept per page (`refPrefs`/`setRefPrefs`, localStorage
  `refTools` = [[page in small letters, open 0/1, sort]…], newest last, ≤200, a page back to closed + Last
  changed leaves it; never the words typed; t16_reftools). The filter box (every word, in the note, its
  sub-notes, its path or its page's name; capitals/accents ignored; the heading's count says "N of M
  match"; the words lit by a CSS highlight `ref-filter`, `litWords`, as `fillRefs` draws each reference),
  Sort (`sortRefs(groups, host)`, that page's or day's own: "changed" = `RefGroup.changed`,
  the page's file time that `App::page` adds from the times the app keeps (`files`), newest first; "name" =
  pages A to Z, then days newest first) and Fold all / Open all (`refFolds`, the session's). Each change
  draws the list again with `fillRefs` (still a slice at a time). Phones: the filter box across (16px, 44px
  tall). Tested by t16_refs.
  The Journals list also shows past days with no notes that other pages link to (`App::journals` +
  `Vault::linked_journal_dates`, as Logseq; bench `journals_ms`; t9_journals).
- Note menu, moving notes by their dot (Build 28; editor.js `openMenu`/`menuPick`, popups.js `noteMenu`):
  Logseq's block menu from a right-click on a dot (on a selected one: for the selection), the context-menu
  key / Shift+F10, a phone's hold-and-let-go on a dot, or the phone toolbar's ⋯. Colours as Logseq writes
  them (`background-color:: yellow|red|pink|green|blue|purple|gray`; a pale tint, tokens `--hl-*`/`--hl-tint`;
  an old "#978626" as is), H1–H6 (`withHeading`, "#"s after a to-do word as the / menu does), auto heading
  (`heading:: true`, drawn one size below its level), Select, Cut / Delete (Undo message), Copy, Copy as text
  (no hidden properties), Numbered list (`logseq.order-list-type:: number`, drawn 1./a./I. by `listMarks`;
  Enter continues it, Enter on an empty one or Backspace at its start ends it; a note moved or added next to a
  numbered one joins it, `joinList`), Next to-do state, Expand/Collapse all. Properties go where Logseq puts
  them (`withProp`); these are hidden in the editing box (HIDE). Dragging (`pressDot`/`dropAt`/`dropNotes`,
  pointer events): mouse press-and-move; phone hold 450 ms (buzz), then move (a non-passive touchmove on each
  dot only, so scrolling elsewhere never waits for it). The line: the gap nearest the pointer, the level from
  how far right (at most a child of the note above, not into a folded one, never shallower than the note
  below); in its own place any level out = Shift+Tab repeated. Edges scroll (the side under the pointer);
  Esc cancels; one Undo step. Tested by t14_blockmenu (laptop) and t8_phone. Elsewhere: next item.
- Dragging notes anywhere (Build 30; editor.js `dropTarget`/`dropRows`/`dropAt(x, y, D)`, `ui/move.js`;
  t15_drag). The target under the pointer: these notes first (as above), else the outline whose `.sheet`
  is under it (another Journals day, the other side; its rows `dropRows`, once per drag; the level from
  its own left edge, a dot 9.5px in; anywhere on its sheet counts), else a `#favs`/`#recent` sidebar link
  (lit `.drop-to`: to the end of that page, level 0). The copy says where (`.dg-to` "→ Page"). Alt held
  (Logseq's way; mouse only, also pressed/let go mid-drag): `((id))` references there instead (`dropRefs`;
  a note without `id::` gets one, `withProp`), the notes stay (not faded, `.drag-ref`). The same page (its
  own sidebar link, or open on the other side with the same `docKey`): a move within it (`dropNotes` with
  that side's place: `t.B`/`t.end` are indices of the same doc). Another page: `move.js` `transfer`, in
  this order: (1) both pages `settle`d (typing saved the usual way; a clash or failed save: nothing
  moves); (2) into the other page (an empty page's empty note makes way; `raw` dropped, so the notes are
  written in its indent and line ends; `id::` kept), saved at once (`saveNow`: one try, `o.quiet` = no
  clash screen); (3) only then out of this page, saved at once. A step that can't be saved goes back to
  what its file has (`putBack`: an error → as before, a clash → `reload(true)`); if (3) fails, (2) is
  taken back (`unstep`; by words if a merge dropped its step); if even that fails the message says the
  notes are in both pages (never lost). Alt: the ids first, then the references. While it runs both
  outlines are `locked` (no edit, drag, undo; `reload` waits) and `app.moving` refuses a second one. A page
  not on screen (sidebar): its file read and saved with `base_hash` (`addToPage`/`takeFromPage`). Undo:
  a `Link` on both outlines' undo steps (`step.link`); `Outline.undo()`/`redo()` hand a linked step to
  `link.go`, which does both in the same safe order (the page getting the notes back first; `one(p)` =
  `undo(true)`/`redo(true)`, plain = this outline only) and keeps `App.steps`/`redoSteps` itself
  (`App.step`: `act(o)` true = handled). Never one page alone: a link whose page closed or was read again
  is `drop`ped (that step and older ones on its pages go, each would bring notes back or take them away in
  one page alone); a newer change on the other side: "First undo the newer changes in …". The message
  after a move has Undo (none when a merge with a change made elsewhere dropped the steps). Phones: hold a
  dot and drag it to another day in the Journals list (the same code; no sidebar or two sides there).
- Files from outside (Build 30; `ui/filedrop.js`, t15_drag; `app::save_dropped_file`, core/tests/dropped.rs):
  dropped on a note → copied into assets/ (Logseq's name, `save_asset_file`; one in assets/ already is
  linked where it is, spaces as %20) and linked under its words, a line each (`fileLink`: pictures
  `![name](…)`, files `[name.ext](…)`, as "Upload a file"); on the note being typed in: at the caret;
  on a page/day's sheet but not on a note: a new note at its end each; elsewhere: nothing copied, a
  message. Lit while over it (`.blk.file-over`, `.outline.file-end`). One Undo step. Windows app: Tauri's
  file drop stays on (the default), its `tauri://drag-enter/over/drop/leave` events (position in window
  pixels ÷ devicePixelRatio) and the `save_asset_path` command in src-tauri lib.rs (not in `dispatch`, so
  the dev server can't copy arbitrary paths; only paths of the window's last `WindowEvent::DragDrop`
  (`DROPPED`), so the page can't ask for any other file; folders, non-files, empty and >25 MB files
  refused, read with a limit). Browser/dev server and Android: HTML5 `dragover`/`drop` with File objects →
  `save_asset`; a file dropped anywhere is kept from opening in place of the app.
- Writing (Build 29, as Logseq 0.10.9; tested by t15_edit). `/` menu: `SLASH` in popups.js ([label, hint,
  id, more words it's found by]; all shown, the list scrolls; names starting with the query first; the query
  may have spaces, "/block ref"). Block references: `((` (or / Block reference) → `Suggest.blocks` →
  `search_blocks` (vault.rs: every word, as the search box finds notes; only `- ` notes, `Block::dash`: adding an id
  to a plain paragraph or a `* ` bullet would rewrite it as `- `); `((` opens it only when not right after
  a letter or digit (`f((x`), notes from 2 letters on; picking one → `noteId` (editor.js): its `id::` if
  it has one (never replaced: one that isn't a UUID, which Logseq can't use, is refused with a message;
  `cantRefer` also refuses paragraphs and `* ` bullets), else a new UUID written with `withProp` (its page
  on screen: through that outline, Undo + its save; else `page` + `save` with base_hash, a clash adds
  nothing); `referTo` gives up if the note typed in closed or moved meanwhile, and takes in the one or two
  ")" the "((" brought. `((id))` renders as
  `span.bref[data-ref]` (render.js); `App.blockRefs` fills in the note's first line from `blocks_by_id`
  (one pass, batched per drawing, `refCache` cleared on any save/rescan; also in reference lists, `refRow`,
  and the hover preview); a click zooms to it. Link…
  (`formBox` in popups.js), Upload a file… (`addFile`: pictures `![name]`, other files `[name.ext]`, as
  `app::asset_markdown`), Underline (`<ins>…</ins>`; render.js shows `<ins>`/`<u>`), H4–H6, CANCELED,
  Number list / Number children (`numberList`). Markers and headings from the menu put the caret at the end.
  Ctrl+A (`editor/select-parent`): the words, then the note (`select`), then its parent (`selectParent`),
  then all; Ctrl+Shift+A (`editor/select-all-blocks`) all (`selectAll`); with nothing selected too (app.js
  onKey: the active outline if it shows, else the first that shows; never a folded day's). Typing pairs (`beforeInput`, Logseq's autopair): `PAIRS` ( [ { ` close themselves ("(" only after
  a space/start/"]"/"("; "`" not where a line starts with backticks: ``` keeps its code-block rule); with
  words selected those and `MARKS` * _ ~ ^ = go round them, the words staying selected (twice = **bold**);
  ) ] } ` step over the same one; Backspace between a pair (`UNPAIR`) takes both; `"` and a lone `~` aren't
  paired (Logseq pairs ~; the maintainer didn't ask). Only `insertText` outside a composition (`composing`): IME and
  AltGr typing go through untouched. Paste (`onPaste`): pictures; an address over words; Ctrl+Shift+V
  (`plainAt`) = the plain words in this note; text/html that `RICH` says carries links/bold/lists/headings/
  code → `paste.js` (`htmlToNotes`, loaded on first use: DOMParser + a small walker; styles, scripts,
  comments, hidden and Word's `mso-list:Ignore` dropped; Google Docs' style-only bold/italic, its
  `<b style="font-weight:normal">` wrapper and lists nested as `<ul>` in `<ul>`; Word's list paragraphs by
  `mso-list: lN levelK`; a code editor's box, `white-space: pre` in a fixed-width font, `codeBox`: one
  code block): one paragraph → at the caret, else notes (`pasteNotes`, as the "- " paste does; `<ol>`
  items numbered; into the zoomed-in note itself: its last sub-notes); else the old plain paste. A copy
  that starts with such a code box (VS Code: `codeCopy`) is plain words, as before. Page ⋯ → "Copy page as text…" (`export.js`, loaded on
  first use): Text (tabs / spaces / none), OPML, HTML; properties (hidden ones never), [[links]] as plain
  words; Copy (HTML as text/html too), Save as file… (`showSaveFilePicker`, else a download; not on
  Android); options remembered (`exportOpts`). Phones: the "+" (`#addnote`, small and quiet since Build 32, below; `App.addNote` →
  `Outline.addAtEnd`: today's journal on the Journals list, unfolded first; an empty last note is reused;
  hidden while the toolbar shows, and where there are no notes, `here()`; shown under 860px with
  `any-pointer: coarse`, and always on Android, `.android`: its emulator may not report a touch screen); the toolbar's "/" (`openCommands`: types "/" and
  opens the list, `Suggest.slashAt`) and date button (`dateMenu`: under a small "Link to a day" heading
  Today / Tomorrow / Yesterday / Another day…, then under "To-do date" Scheduled… / Deadline…, one column,
  `{head}` items, the maintainer picked it Oct 29; `menu(…, {keep})` leaves the keyboard up). The "/" list offers
  only TODO, DOING, DONE and CANCELED as to-do words (the maintainer asked, Oct 29): popups.js `NOT_IN_SLASH` leaves
  LATER/NOW/WAITING out of it, but they stay in `SLASH` for the command list (Ctrl+Shift+P, commands.js),
  and notes with them show and cycle as before (t15_edit).
- Pages (Build 30; core `tests/pages.rs`, UI `t15_pages.mjs`):
  - All pages (views.js `pagesView`, as Logseq's table): column heads Name / Links / Created / Changed
    (`.pg-cols`, buttons; `SORTS`: a click sorts, again the other way; localStorage `pagesOpts` {sort,
    desc}); pages with no file (no times) last; Namespaces on: A to Z, heads disabled. Rows are one grid
    (`--pg-cols`, px widths); a narrow side or phone (`@container`, `.pg-table` < 560px) shows only the
    sorted column (`data-sort`). Times come with the `pages` command (`App::pages`: `PageEntry.changed`
    = the file's change time, `.created`, seconds). "Created" = `App::born`: the earliest of the
    system's creation time (`made_of`; Windows' folder listing has it, so `scan` costs nothing more;
    Linux statx; Android none), the change time, and what the app noted before (index cache `born`,
    `born_from`): a save writes a new file under the old name (new creation time) and never makes a
    page look new; a rename carries it over; a removed file forgets it. Android without creation times:
    the change time when the app first saw the file. (Logseq's own Created/Updated are its database's:
    first parse and last edit in Logseq, reset by a re-index.)
  - Rename by clicking the title (app.js `editTitle`, `h1.renamable` > `.pt-name`, contenteditable
    plaintext-only; not journal days, read-only or unreadable pages): the caret where clicked; Enter or
    leaving renames (`renamePage(name, to)`), Esc / Android's Back (`closeTop`) puts it back; switching
    windows keeps it editable (`document.hasFocus()`); its keys don't reach the app's. A namespaced
    page edits its last part, the parents stay.
  - Merge (`App::rename_target` says whether the name is free, else which page has it (or its
    alias); `renamePage` asks "“X” already exists — Merge pages", then `App::merge_pages`, as Logseq's
    merge-pages!): the old page's notes go at the end of the target (raw None, the target's indent and
    line ends; paragraphs become bullets; depth at most one below the note before), its page
    properties first as a note of their own (`moved_notes`: Logseq lines as written, YAML as `k:: v`,
    `title::` dropped; or its properties-only first note; a YAML header with values over several lines
    or nested keys is refused, `yaml_header_simple`; so is a name another file also claims,
    `Vault::has_duplicate`, and a journal day's alias as the target), links to the old name in every file (the
    target's own notes too, `rename_doc`) point at the target's name, the old file to the bin
    (`bin_file`, as `delete_pages`). The target is written with `Expect::Bytes` (nobody saved it
    meanwhile), before the old file moves (if that fails, it's put back): its other bytes, BOM, CRLF,
    no final newline stay. A link file that can't be written is listed (`skipped`), the merge still
    finishes. A favourite follows a rename or merge (`rename_favorite`: only its entry's text changes in
    config.edn; dropped when the target is a favourite already; a merge's Undo puts config.edn back).
    `undo_merge(id)` (the toast's Undo; only the last merge, in memory): every
    file back only if each still holds what the merge wrote, the old file out of the bin; else it
    says so and changes nothing. Refused while a clash waits (`readyToRename`, shared with rename);
    tabs on the old page follow to the target (`Tabs.renamed(…, merged)`: zoomed places → the page).
  - Links (core `link.rs`, the only parser): `leanoutliner://page/<encodeURIComponent name>`,
    `…/note/<id>`, anything else a capture link as before (`Link::{Page, Note, App, Capture}`; the
    `link` command). Page ⋯ "Copy link" (`pageLinkUrl`, api.js) and the note menu's "Copy link to this
    note" (`Outline.copyNoteLink`: an `id::` the Logseq way if it has none, one Undo step). `App.openLink`
    opens a page, or a note zoomed in (`blocks_by_id`); used by `openUrl` (links in notes: render.js
    autolinks `leanoutliner://`), the `lean-link` event and `start_link` (Windows), `openShortcut`
    (Android). Windows (src-tauri `links.rs`): main.rs hands a page/note link to the open app
    (`send_to_running`: WM_COPYDATA, tag "LNK1", to its message-only window `LeanOutlinerLinks`, made by
    `listen` for the main window only; it brings the window forward and emits `lean-link`), else starts
    the app with it (`set_start`). Android: a VIEW filter for the scheme on MainActivity
    (android_overlay.py), `takeIntent` keeps it like a shortcut's pick; android_test.sh step 13d.
  - Page ⋯ "Show file in Explorer" (the Windows app only: `isApp && !isAndroid`, a page with a file):
    `reveal_file` (lib.rs) = `App::page_file` + tauri-plugin-opener's `reveal_item_in_dir` (already in
    the build: SHOpenFolderAndSelectItems).
- Looks (skins): a look is ONLY token values on `[data-skin="id"]` in `ui/skins.css` (colours, fonts,
  sheet border/shadow/band image, bullet shape, tag decorations, weekday prefix…); `app.css` reads tokens
  and never names a skin. Tokens inherit, so a sample with `data-skin` shows that look anywhere: the
  sidebar's Look button opens a list with small samples, Settings shows large previews. Add a look:
  token block + entry (id, name, note) in `SKINS` (app.js). Images live in `ui/skins/`. Looks: Plain, Plain night (near-black), Plain teal (Logseq's dark blue-green),
  Calm, Night, Paper, Sticker, Sticker night (from the first mockups), Automaton (a rule 30
  pattern around the cards), Azulejo, Calm plain (Calm without cards on a white page, a hairline between days). thinky (Build 32: the logo's
  colours laid out like Calm plain (the maintainer asked: a white page, no cards, a hairline between days; the menu a hint of
  cream #F4F2EE; the cream page was "too creamy"), ink #1D1A2E, its in-app icon an ink tile, accent #C2331A (a deeper red from the spark, so
  words in it read ≥4.5:1; the spark's own red stays `--spark`), ink-blue links with a red line, Inter; the scribble
  faint in the sidebar's corner, `ui/skins/thinky-corner.svg` as `--side-image` (no `--` in SVG comments: XML
  refuses it); its name is drawn as the wordmark where looks are listed (`SKINS` `word: true`, `lookName`)). Grimoire was
  taken out (Build 32, the maintainer asked): a saved "grimoire" opens as Calm (`setSkin`'s fallback, and boot.js's
  small map of removed looks before the first paint). Automaton (refined, Build 32): a stronger
  ultramarine (#1E56E6, also in `ui/skins/rule30.svg`, a real rule 30, rows fading 1→.3, round 2),
  the rule 30 pattern on the page around plain white cards (round 3, the maintainer's pick of two: `--page-image` =
  rule30.svg tiled at 576×38, twice its size, under a .72 wash of the #F5F5F6 page colour; no grid, no
  `--sheet-band`), square dots, the weekday in the blue (`--weekday-ink`). Plain is
  Logseq 0.10.9's default light theme (its "logseq" colours: page #FCFCFC, words #171717, links
  #1B6898 with no underline, dots rgba(199,199,199,.8) 6px, guide rgba(46,27,5,.08), hairline #DBDBDB,
  properties #F3F3F3, sidebar #F8F8F8, date 36px weight 500), Plain teal its default dark one (#002B36,
  words #A4B5B6, links #9BD3D4), Plain night the same in near-black (#141414, links #8AB4F8); font
  Inter, bundled in fonts.css (one upright variable file, 48 KB; italics slanted by the browser, as
  IBM Plex Sans' since Build 32: its italic file, 24 KB, is gone). Plain's
  accent (Build 32, the maintainer found it too black and white) is its links' blue, `--accent: var(--link)` (so a
  link colour picked in Settings carries it along): ticked boxes, the sidebar's current place
  (`--accent-tint`, a pale mix), pressed buttons, selections; quotes' bar (`--quote-bar`, default
  `--line`) and the sidebar's and strips' icons (`--icon-ink`, default currentColor; app.css `.nav svg,
  .hb-app button svg, .hb-nav svg, #topbar > button svg`) a softer share of it. Plain night the same in
  its soft blue; Plain teal keeps its teal accent, quotes and icons in its links' teal. No look colours "today" differently (`--today-bg` = the sheet's; Sticker and Sticker night
  had their own). Page links: `--link-deco` (the line under them; Plain/Plain night 0 = colour only),
  `--link-open/-close` ("[[" "]]" in `--link-bracket`; never for `[words]([[Page]])`, class `lbl`);
  Settings → Look → Page links (Look's own / Underlined / Colour only / Show [[ ]], localStorage
  `linkStyle`) sets `html[data-links]` (boot.js before paint, `App.applyTextStyle`), whose token rules
  at the end of skins.css win over every look and its samples; tags stay as they are. The Android widget gets the
  look's colours via `LeanAndroid.setWidgetColors`. Boxes and section headings (today's "Scheduled &
  deadline", references) read `--sec-font`, `--box-bg/-border/-radius`, `--refgrp-*`. Paper's notes sit
  on plain grained paper (round 2: the dot grid there distracted the maintainer); the first mockups' dot grid is on the
  sidebar, faint (`--side-image` + `--side-image-size`, a pattern on `#side` and the phone's menu); no ruled
  lines, no red margin (the maintainer asked); Sticker's today is no longer yellow (the maintainer asked). Plain/Plain night have their own link colour
  (Logseq's); the colour picked in Settings overrides every look's. Looks and the Logseq feel are
  tested by t15_looks (every look's today and done line, Plain's numbers, hover, cursors, properties,
  Page links, sidebar, phone) and t16_looks (Build 32: thread-line gaps in pixels, Plain's accent, no
  Grimoire, Automaton, the phone's even sides in every look) and t16_looks2 (round 2: soft raised
  shadows, round 1's reference wells, Paper's grid on the sidebar, Calm's day gap, lines under wrapped
  notes, Automaton's neutral page and pattern).
- Starting fresh (Build 32; `ui/welcome.js`, settings.js `folderPicker`, core `start.rs`; t16_start):
  with no notes folder ever chosen (localStorage `vault` empty) the app opens at `#/welcome` (tabs.js
  `start`, and `App.draw` sends other places there; a chosen folder that can't be opened still goes to
  Settings, saying why). It's loaded only then (dynamic import); `html.welcome` puts the sidebar and the
  bars' buttons away (a Windows window keeps its own buttons and drag strip). Logo, "Welcome to
  <APP_NAME>" (`api.js` `APP_NAME`: the one place the name lives for new code), one line, two choices:
  Open an existing notes folder → `folderPicker(…, {mode: 'open'})`; Create a new notes folder →
  `{mode: 'new'}` (starts in Documents when home has one; a name, "Notes" or the next free "Notes 2";
  the tour ticked; `new_folder` + `start_notes`, then `useVault(app, path, place)` at "Start here").
  × or Esc → Settings. Android: the access card first, as before (android_test.sh taps "Open an
  existing notes folder" first). The picker in either place: any folder can be used: a notes folder
  opens; one inside a notes folder offers that one; any other → `useHere` asks "Start a new notes folder
  here?" (empty) or warns "among other things" (what's there counted; Cancel changes nothing), with a
  tour tick box; "New folder" (`newFolder`: asks again with the reason when a name can't be used).
  Tine's welcome was the idea only (AGPL): our own layout and words.
- Phone chrome (Build 32, the maintainer asked for it quieter; t16_phone; laptop menus as before). On `(pointer:
  coarse)`: pop-up menus are compact and stay by what opened them. Round 2 (the maintainer's words: "one column,
  much smaller gaps between lines, not just cut smaller"): the note menu (popups.js `noteMenu`), the
  "/" list (`#ac`) and the toolbar's date menu (`.tb-menu`) are one column with 32px rows (shorter
  than 44 because the maintainer asked; keep ≥32 and the whole row tappable); the note menu 272px wide with 20px
  colour dots whose buttons reach 6px past them (`.nm-sw::before`); `#ac` 280px tall (8½ rows, the
  rest scrolls). The toolbar's ⋯ opens the note menu by its button (`at`); other `menu()`s (a page's ⋯)
  ≤280px wide, ≤62vh, rows 44px (`{head}` items are small headings: the date menu's); the look list ≤60vh.
  The search box (`(pointer: coarse), (max-width: 640px)`): where it always was (10vh down, over the
  28% darkening; the maintainer didn't want it at the top), compact: 44px input, 36px rows, results ≤42vh. The phone bar: `--topbar-h` 45px (was 55; 44px buttons, no padding; the find
  bar and scroll-padding follow it); the editing toolbar 45px (was 51). The drawer: `min(70vw, 280px)`, starting under the top bar, which
  stays usable above the dimming (`body.drawer #topbar` z 46; the menu button lit, `aria-expanded` kept
  by a MutationObserver on body's class); a tap beside it, the button again, a swipe left or Back close
  it. The "+": 46px, a see-through disc in the page's colour with a hairline and soft shadow, the "+" in
  the accent (tokens `--fab-bg/-ink/-border/-shadow`); `App.fabScroll` (in the scroll handler's frame)
  adds `.away` while a finger scrolls down (`touchedAt`, within 1 s of a touchmove: the app's own
  scrolling never hides it) and drops it scrolling up, near the top, on another page or when typing
  stops.
- `browser/` the Edge extension "thinky highlights" (Build 32, MV3, no build step, ~25 KB; the maintainer
  loads it unpacked from the folder `setup` makes). Permissions: activeTab, scripting, storage,
  contextMenus, nativeMessaging: no host permissions, so `page.js` is put into a page only when the maintainer uses
  it there (toolbar button, right-click menu, Alt+Shift+H highlight / J to the journal / L the box). `page.js`:
  `window.__leanOutliner` (once per page): `pageInfo` (canonical address on the same site, og:title,
  og:site_name), `highlight` (the selection → {id, plain, text: Markdown, pos, link}; marks it with the
  CSS Custom Highlight API, no change to the page's HTML), `paint` (finds kept passages again by their
  plain words, nearest `pos`), `toast`. Markdown (`md`): bold, italics, code, http links, line/paragraph
  breaks, maths as `$TeX$`/`$$TeX$$` (KaTeX/Wikipedia `annotation[encoding=application/x-tex]`,
  `math[alttext]`, MathJax 2 scripts; a selection starting/ending inside a formula takes it whole);
  `safe` puts a zero-width space in `[[ ]] (( {{ ::` and `#word`. `background.js`: lists per article in
  storage.local (`a:<articleKey>`, the same rule as `normalize_url`), sorted by `pos`; `cleanTitle` as
  core's; the badge count; `sendAll` → `clip`, cleared when ok; `toJournal` → `journal`; a missing
  receiver says to use Settings → Capture → Set up. Its icons (`browser/icons/32|48|128.png`) are the brand's
  icon-small/icon-mid/icon drawn at that size. `popup.*`: the page name (editable), the list
  (readable words, × to drop), Send N, Clear, "Send the selected text to today’s journal"; `?tab=<id>`
  for tests. Marks don't come back after a reload until the box is opened there (no host permission).
- `dev/` dev server (hand-written HTTP, one thread per connection): serves `ui/` with the app's CSP,
  `POST /api/<cmd>` → same `dispatch`, `/vault/<path>` files. `cargo run -p devserver -- <vault> [port]`.
- `android/MainActivity.kt` + `scripts/android_overlay.py`: applied after `tauri android init` in CI
  (insets, All-files-access permission, `window.LeanAndroid` JS bridge). `src-tauri/gen/` is not committed.

## File shapes in real notes folders (all must round-trip byte-for-byte; see tests/doc.rs, tests/fuzz.rs)
Logseq `- ` bullets (tabs), Obsidian `* ` bullets, plain paragraphs before any bullet (one block each;
once one is edited, later ones are written as bullets), YAML `---` headers (page props; YAML `title`
never renames), `key::` props, files without a final newline, CRLF, BOM, duplicate page names (first
file wins, `Vault::duplicates`), emoji/curly quotes in names (never slice strings by byte index),
unclosed code fences (end at the next bullet that isn't deeper). File names: Logseq triple-lowbar rules
(`file_stem_for`, Windows' reserved names in any capitals); names a file can't hold get `title::` (new
pages, and renames: `add_title_prop`). A new page never takes another page's file: when its file name
is already used (by a page named by its `title::`; capitals ignored, as Windows and Android do), it gets
the next free `<name> (2).md` with `title::` (`Vault::free_rel`, used by `page_info` for pages without
a file, so the editor's page view and first save, renames, quick capture and the capture box all follow
it; the first save of a new page writes only where no file is: one that turned up is a clash).

## Rules that protect the notes
- Files stay Logseq-compatible Markdown; other writers exist (Logseq, sync apps such
  as Google Drive, scripts and other tools). Saves send `base_hash` + the base doc: edits made elsewhere are merged
  block by block (`merge.rs`, one `stretch` rule for both `merge_blocks` and `clash_parts`: between
  notes both left alone, one side's change wins; notes edited in place on both sides merge note by note
  only when every note resolves and both line up (`aligned`); notes added at the same place on both
  sides are both kept, this device's first, unless that re-parents a note (the order, or an added note
  shallower than the next note both still have), one of them has words that were on the page (moved,
  or a repeat), or both took a note away from its place (`both_added`); else the whole stretch is one
  clash). A real clash opens the clash screen (`ui/clash.js`, from `Outline.showConflict`): `clash`
  (app.rs, `merge::clash_parts`; checks `path` like `save`) gives the file's version and the page in
  parts; only the clashing stretches (and the page properties, if both changed them) are shown, this
  device's and the other copy's side by side with how they were before, one pre-picked as suggested
  (the one that keeps more, else this device's; where nothing or only empty bullets were before, "Keep
  both", this device's then the other copy's, is offered and pre-picked: it loses nothing; but if one
  side already has every note of the other, by words, that side is, so a note moved there on both
  doesn't show twice: `prePick`; and if the pre-picked page would have a note's words more times
  than this device's page or the other copy has them, every "Keep both" item gets the usual
  suggestion instead: `noTwice`); arrows go from one to the next; "All: …" picks one side.
  While a clash waits the page exists only in memory: `backupMine`/`backupPending` copy this device's
  version to `logseq/bak` when the clash first shows and on hide/reload/close if it changed since (never
  the same version twice); rename/delete are refused (`App.clashWaiting`). Keeping backs up each version
  that loses something (the screen stays up, buttons off, until done), then saves with the file's
  version as the base (a newer change is merged or asks again). After a merge or a choice the undo
  steps are dropped (`forgetUndo`): they'd bring back what was merged in or chosen against (a merge
  arriving while more typing is pending keeps them: that Undo is merged too). If `clash` fails, the
  banner offers whole versions ("Keep mine" = forced save, the file's version to bak first; "Use the
  other version" backs the maintainer's up first; "Keep mine" waits for a save on its way, and a save queued behind
  another stays forced, `againForce`); a failed "Keep mine" keeps the page waiting. "Decide later" leaves
  a banner ("Nothing on this page is saved until you choose."); the page can't be left until the maintainer
  chooses. Never silently overwrite. Unreadable/non-UTF-8 files are read-only. Backups: `logseq/bak/`,
  bin: `logseq/.recycle/`.
- Writes go to a temp file then rename. Property values only link via `[[ ]]`/`#` (Logseq 0.8.9+),
  except keys in `:property/separated-by-commas`.
- Every write of a note or of config.edn replaces exactly the bytes it read (Build 32): `save` (and
  `rewrite` in app.rs for `save_block`, `append_to`, rename's and merge's link files and the page's own
  file, favourites, `edit_config`) write with `Expect::Bytes(<what was read>)` (`Expect::Missing` for no
  file); `write_atomic_checked` checks again right before each rename and before the direct write a
  synced drive may need, and a file it can't read just then (Google Drive holding it) is waited for
  within its ~0.5 s, never written over unseen. Saved elsewhere in between: read again and redone on
  that version (`save`: merged again, 3 tries, then `conflict: true` = the clash screen; a forced save
  backs up each newer version too; `save_block`: a clash when the note isn't there any more; link
  files: 3 tries, then listed as `skipped`; config: 2 tries, then "try again"). `read_text` keeps every
  byte (BOM, CRLF, no last line break), so the bytes compared are the file's. Tests:
  core/tests/elsewhere.rs, with `set_write_hook` (tests only: runs right before the check, as another
  program saving at the worst moment).
- The settings (config.edn) are never guessed (Build 32): `capture::read_config` is the one rule for
  opening (`App::open`, `open_read_only`) and adding notes: missing → Logseq's defaults (and on Android
  a PermissionDenied: without "all files access" the folder opens empty, `App.noAccess`); any other read
  problem, or text that isn't whole EDN, is tried again ~0.5 s, then the folder isn't opened (a file
  that stays unparseable still gives the defaults). Settings → Notes folder shows why with "Try again"
  (`.btn-row.retry`, finger-sized on touch; a fresh page load, as at a start). While open, a rescan
  stats config.edn (`App::config_stamp`; the app's own writes record theirs) and reads it when it
  changed, whole files only (`collect_changes`); `take_config` takes favourites, shortcuts, capture…
  in place, and for other folders, date formats or comma properties opens the index again (`load`,
  from the cache); `"logseq/config.edn"` in rescan's list → the UI takes the settings
  (`App.useSettings`) and redraws both sides if journals moved; the Windows app watches the new
  folders (`watch_notes` in lib.rs). Tests: core/tests/elsewhere.rs, `t16_gaps.mjs`.
- Nothing in the vault is ever deleted: a page merged into another goes to the bin (`logseq/.recycle`),
  unused pictures are moved to the bin, and only after checking
  each again right before (when unsure, a picture counts as used; pictures from the last 3 days are
  never moved); its bin name says its exact path, and putting one back never overwrites a picture.
  The one exception: the app deletes (or trims) its OWN old safety copies in `logseq/.safety-<this
  device>/` (Build 32, the maintainer agreed to keep them in the cloud): only `<id>.copy` files there, only this
  device's folder, never another device's, never through a link or junction (`real_chain`, real files
  only), and nothing else in the notes folder;
  putting a version back first keeps the current text in `logseq/bak`, never over a non-UTF-8 file;
  copy ids and note paths are validated (no `..`, only entries the copy's list names, by path and
  earlier-text number). History (history.rs) only reads what its own listing names, and puts a version
  back through the normal save (base_hash), never deleting a backup.

## Build & test
- Here: `cargo test -p outline_core`; speed: `cargo run --release -p outline_core --example bench`.
  UI: `dev/ui-tests/run.sh [test…]` (Playwright against the dev server, fresh sample vault per test,
  screenshots in `$UI_TEST_DIR/shots`; Playwright import `/opt/npm-tools/node_modules/playwright/index.mjs`).
  Run them all after UI changes; they catch CSP blocks too. Two copies of the project (git worktrees)
  can test at once with their own `UI_TEST_PORT` and `UI_TEST_DIR`. run.sh gives the dev server a fresh
  `LEAN_DATA_DIR` per test (safety copies). Pictures/safety: `tests/pictures.rs`, `tests/safety.rs`,
  `tests/safety_before.rs` (own program: sets the cache + data folders), `tests/cache.rs` (the check
  leaves the cache alone; its tests share one cache folder, which none deletes), `t10_safety.mjs` (pictures judged 4 days ahead via `X-Test-Now`: the file
  system knows each test picture was just made; a bin with 60 deleted pages); the bench times
  `pictures_ms` (1,000 pictures), `safety_copy_ms` and `open_changed_ms` (a start after 20 notes
  changed elsewhere: their earlier texts kept first). Clashes: `tests/features.rs` (merge cases),
  `t4_sync.mjs` (Undo, waiting clash backups, rename/delete refused, Keep both, fallback; `page.route`
  to slow or fail a command). Linked references with their sub-notes: `tests/vault.rs`, `t14_refs.mjs`
  (`t5_long` times a page with 450 of them); their boxes, filter, sort, Fold all and the empty days in
  Journals: `t16_refs.mjs` (`tests/pages.rs` for `RefGroup.changed`).
  Safety copies in the notes folder (two devices, moving older copies in, a folder that can't be
  written, links): `tests/safety.rs`, `tests/safety_before.rs`, `t16_safety.mjs` (a phone's copy
  planted in logseq/.safety-phone-…: listed, read, put back, in History). The widgets' colours: `t16_widget.mjs`
  (a stand-in LeanAndroid records `setWidgetColors`) and the emulator's step 7b.
  History: `tests/history.rs` (own program: sets the data folder),
  `t14_history.mjs` (merge and clash while putting back, refusals, zoom, journal day, every look, phone).
  Search and the command list: `tests/search.rs`, `t15_search.mjs`.
  Pages (All pages' columns, renaming by the title, merging, links, Explorer): `tests/pages.rs`,
  `t15_pages.mjs` (it stands in for the Windows app's bridge with an init script for Explorer and links).
  Dragging notes to other pages and dropping files: `t15_drag.mjs` (`page.route` makes saves fail or
  clash), `tests/dropped.rs`.
  Starting fresh: `tests/start.rs`, `t16_start.mjs` (its folders in `$UI_TEST_DIR/start`, stepping
  the picker there through the folders from the top). The phone's chrome: `t16_phone.mjs`.
  Browser extension: `t16_browser.mjs` (its own Chromium with browser/ loaded, given host permission in a
  copy for the test; the dev server's `chrome-extension://` mode is the receiver, the same core code,
  `LEAN_CLIP_VAULT` = a throwaway folder; highlight, reload + box, remove, send, maths, journal, not set
  up), `t16_settings.mjs` (the Settings card with the Windows commands stood in for).
  Navigation and layout: `t15_nav.mjs` (the strip staying put, the slide on a 3,000-note page, the
  handles, wide mode, the ⋯ and right-click menus, dragging favourites with config.edn checked byte for
  byte, folding days and reference groups, the note menu's size, the preview, phone).
- On a real Windows computer: `lean-outliner.exe --check <notes folder> <out.json>` is read-only; start
  the app with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` to drive it over CDP
  with Node. Never test against a real notes folder: use a throwaway folder and delete it. Any test exe
  re-points the `leanoutliner://` link handler (HKCU\Software\Classes\leanoutliner\shell\open\command)
  to itself: put it back to the installed `"%LOCALAPPDATA%\thinky\lean-outliner.exe" "%1"` afterwards.
  The capture box always adds to the notes folder in `last-vault.txt` (the real one) and takes the
  keyboard when it pops up, so an Enter meant for another window can add a line: only open it on purpose,
  and check the day's journal afterwards. Never run CI's capture-box or shortcut-key self-tests on your
  own computer (they use the clipboard and press keys). A portable/test exe never touches the installed
  shortcut-key helper (`at_start` is for the installed copy only), but its Settings → Save key would make
  a Start-menu shortcut with that key (the portable way).
- Android: put `[android-test]` in a commit message (main or `wip/**`) → `.github/workflows/android-test.yml`
  runs a debug x86_64 build on an emulator (scripts/android_test.sh: first start, folder, editing, looks,
  share text/picture, look picker, the widgets' colours per look, back button, print, app icon
  shortcuts, Quick Settings tile; 320x640
  screen) and force-pushes screenshots, log and the gzipped
  system log to the `android-test-results` branch (`git fetch origin android-test-results:refs/remotes/
  origin/android-test-results`). The log ends with PASS/FAIL lines; any FAIL fails the job. The emulator
  is plain Android (`target: default`, no Google Play services): with them it often stalled and Android
  killed the app with it ("depends on provider ... FontsProvider in dying proc"), even with EmojiCompat's
  start-up removed. If a run still fails that way, re-run it (`gh api -X POST repos/.../actions/runs/<id>/rerun`).
  Never install a wip build on a computer or phone you use: on Windows it trusts only the public TEST ONLY update
  key, so it would refuse every real update; wip and debug APKs aren't signed with the release key, so
  releases can't update them. Test with the portable exe.
  Artifact/release downloads are blocked from the cloud workspace.
- Index cache: `<app cache dir>/vault-<hash>.json` (file stamps + text); startup only re-reads changed
  files; the cache is written when the app hides/quits (or after ≥20 outside changes).
- GitHub Actions (`.github/workflows/build.yml`): tests + speed check, Windows (NSIS + portable exe),
  Android (APK), size check (each size also a notice, readable from the release job's annotations:
  `gh api repos/srikanth-iyer/thinky/check-runs/<job id>/annotations`); on main a Release "Build N" (N = one more than the newest release, from
  the `number` job; also the app's version 0.1.N, which the update check compares) here AND on the public downloads repo
  `srikanth-iyer/lean-outliner-releases` (secret `RELEASES_TOKEN`; the app checks it once a day for
  updates). `wip/**` branches build without publishing — use them to check Windows/Android compile. GitHub's
  builds take time (~27 minutes for a full build + phone test): batch features into one
  build, run the phone test once per release candidate; a newer push to a wip branch stops its older
  run (`concurrency`, never on main; the phone test's is on its job, so a push that skips it never
  stops one that's running).
  Release notes = the head commit message (trailers and `[android-test]` stripped), so write it for the maintainer.
  The Windows job also runs `lean-outliner.exe --capture-box-selftest $RUNNER_TEMP` (capture_box/
  selftest.rs: only in a fresh `<dir>\capbox-selftest` of its own, with a throwaway notes folder and
  cache, checked to be the cache in use before any box opens; four boxes worked by messages and clicks,
  plus the program started a second time for the "press the shortcut again" check); a failure fails
  the job. Its notice gives the ms from the program's start to the box on screen (`gh api
  repos/srikanth-iyer/thinky/check-runs/<job id>/annotations`); wip builds keep its pictures and
  result.txt on the `capture-box-shots` branch (pushed by the small `capture-shots` job: the build job
  can only read). The size check also notes each file's size there. Then `lean-outliner.exe
  --hotkey-selftest $RUNNER_TEMP` (hotkey/selftest.rs: a fresh `<dir>\hotkey-selftest` with its own
  notes folder and cache, LOCALAPPDATA pointed there for the helper and its boxes, its own Run value
  "Lean Outliner shortcut key (self-test)", removed after): saving a key (helper up, Run, hotkey.txt,
  update's other-copies check 0), its memory, libraries (no webview) and CPU while waiting, SendInput
  of the key → box on screen within 1 s (ms in the notice), a changed key taking over, a key the test
  holds (refused, old helper kept, problems log, an old .lnk with it kept byte for byte and `fallback`;
  a helper still trying for it: in `helper_pids`, not an other copy, `starting`, quits at once when
  asked; then `why` shown, and Try again working once the key is free), an old .lnk's
  key moving over, the real Start menu with Explorer (GitHub only: a test .lnk made with a key, then
  moved; Windows' slow path must not fire too), Remove. Its notice: box ms, helper KB; NOTE lines in a
  second notice.
  Signing (public repo, Build 34 on). No secret is a file in the repo or a repository-level secret.
  Two environments, each allowed only for `main`: `release` (required reviewer: the maintainer; secrets
  `ANDROID_KEY_PASSWORD`, `ANDROID_KEYSTORE_B64` = the locked Android keystore in base64, `UPDATE_KEY_PEM`
  = the locked P-256 update key as PEM text) and `publish` (`RELEASES_TOKEN`, a fine-grained token with
  Contents read/write on lean-outliner-releases only). The keys were made once (Oct 26, 2026) and must
  never be replaced: phones refuse an APK signed with another certificate, and installed Windows apps
  refuse an installer signed with another update key. Jobs: `update-key` (no secrets) gives the build
  the update key's public half: on main `ci/update-key.pub` (checked against the newest signed release's
  .sig on the downloads repo), on wip a throw-away key made in that run (its private half passed to
  `sign-wip` as a one-day artifact). `windows` and `android` build with no secrets and a read-only token.
  `sign` (main only, waits for approval; a fresh runner with only scripts/ and tauri.conf.json, no build
  tools) writes the keys from the secrets into the runner's temp folder (umask 077, deleted on exit),
  checks the update key matches `ci/update-key.pub`, works out the version from the build number itself
  (`update_sig.py version N`; refuses if the build claims another), signs the installer
  (`LeanOutliner-setup.exe.sig`; also one with another key, for `verify`) and the APK, whose certificate
  must equal the newest release's on the downloads repo. `sign-wip` does the same with throw-away keys.
  `verify` (windows) runs the shipped exe's `--verify-update` on the signed installer (must pass) and on
  a changed copy, another build number, an edited version and another key (must fail). `sizes` reports
  sizes; `release` (main only, environment `publish`) publishes here and on the downloads repo. Build
  numbers come from the downloads repo (`number` refuses to start below build 33). Pull requests run
  only `pr.yml` (the core's tests; no secrets, never `pull_request_target`). Every action is pinned to a
  commit; Dependabot proposes updates. The first build with updates is installed by hand.
- Pull before pushing.

## Android extras
Home-screen widgets in `android/kotlin/JournalWidget.kt`: today's journal (to-dos due *today* only, under
"DUE TODAY", then the day's notes; Markdown cleaned to plain words: links show their name or a short
address) and `QuickAddWidget`, a 1x1 round "+" in the look's accent colour. QuickCaptureActivity (both
widgets' "+" and the share sheet's "Add to journal", text or pictures, Logseq quick-capture format,
optional no-pop-up mode): a rounded card near the bottom in the look's colours, pill buttons, a preview
of a shared picture (EXIF-turned). They read what the app stores via `setWidgetConfig`,
`setCaptureConfig`, `setWidgetTasks` (`{day, tasks}`: a list worked out on another day isn't shown) and
`setWidgetColors` (called by `App.setSkin` at every start and look change, with `lookColors()`: the
colours as seen, #rrggbb, which `Color.parseColor` always reads; `JournalWidget.paint` /
`QuickAddWidget.paint` put them on the widgets: background, title, "+", empty line; the list's rows
take ink/faint in `Factory.onDataSetChanged`; the one-tap "+" its circle; `Journal.refresh` repaints
both). The emulator test proves it (step 7b: five looks, light and dark, against the test-build-only
`LeanAndroid.testWidgetColors()`, which applies the same RemoteViews to real views and reads the
colours back). Adding uses the app's own Rust code, no Kotlin copy of its rules (Build 32; a copy had drifted: it put
an "Inbox" note into the file of a page "Mail" whose file was inbox.md): `android/kotlin/LeanCore.kt`
loads the app's library itself (`System.loadLibrary`, the `[lib]` name of src-tauri/Cargo.toml, which
android_overlay.py fills in for `__RUST_LIB__`; a no-op when the app runs in that process) and calls
`LeanCore.capture(json, bytes)` = `Java_com_srikanth_leanoutliner_LeanCore_capture` in
`src-tauri/src/android_capture.rs` (the `jni` crate tao/wry already use, Android only; the overlay
checks the name against the package and adds an R8 keep rule; tests in that file run on any
computer) → `capture::capture_to_usual` (words; the quick capture page found as the app finds it,
`App::capture_to_page` from the folder opened read-only) or `save_asset_file_at` + `asset_markdown` +
`capture::capture_media_to_usual` (pictures: the media template; its own extension, else its type's
from Android; a picture copied by a try that then failed is added by its link next time, not copied
again). Kotlin passes the app's own cache/data folders (cacheDir/dataDir, as Tauri gives the app),
the phone's day and time; "where" gives the pop-up's "to …" line from config.edn. On helper threads;
a failure shows its reason in the card (`qc_error`) and keeps the text. The emulator test's step 15
proves it with the app stopped (the Inbox/Mail case). `LeanAndroid.print` opens Android's print / save-as-PDF screen; `setBarColors` paints
the status and navigation bars in the look's page colour (remembered for the next start); `leave` sends
the app to the home screen. Back: the app takes it via `window.__TAURI__.app.onBackButtonPress`
(`App.onBack`): close what's open (`closeTop`: pop-ups, search, look list, drawer, editing), else back a
page, else leave. Without "all files access" a folder opens with no notes (`App.noAccess`): Journals and
Settings say so (`accessCard`), the folder picker waits for it, and coming back with access re-opens it.
Quick Settings tile "Add note" (`android/kotlin/AddNoteTile.kt`, a `TileService` in the overlay's
COMPONENTS): opens QuickCaptureActivity and closes the shade (PendingIntent on Android 14+, `unlockAndRun`
when locked). App icon long-press shortcuts Today / Add note / Search: dynamic, set by
`MainActivity.publishShortcuts` at each start (manifest ones always start with CLEAR_TASK, which would
restart the open app); action MAIN + extra `open=today|search` (MAIN: tao reads VIEW/SEND intents itself,
and MAIN matches the launcher filter, so `am start` can send it too); Add note goes straight to the pop-up.
MainActivity keeps the pick until the page takes it (`LeanAndroid.takeShortcut()` in `App.openShortcut`,
called at the end of `start()`, or from `onNewIntent` via evaluateJavascript); `LeanAndroid.showKeyboard()`
brings up the keyboard for the search box (WebView focus() alone doesn't without a tap).
One-click update: `LeanAndroid.update(tag)` (Android 8+: first opens "Install unknown apps" for the app
and carries on in `onResume` once allowed) downloads build N's `LeanOutliner.apk` into
`<cache>/update-apk`, checks it's this package with a higher versionCode and (Android 9+,
`signedLikeThisApp`) the same signing certificate, reports `lean-update` events (permission, download %,
check, ready, install, confirm, done, error) to the page; the page saves, then `installUpdate()` abandons
this app's earlier sessions (`mySessions`) and writes a PackageInstaller session; `UpdateReceiver` (not
exported) starts Android's "Update this app?" box and reports its answer. Android itself refuses an APK
not signed with `android/release.keystore`: that is the genuineness check (ours only says it sooner).
Android doesn't restart the app. `testInstallSelf` (debuggable test builds only) hands the installer the
app's own APK. The emulator test (step 11) downloads the newest real release and expects the app to
refuse it (debug key), then hands over its own APK, sees Android's installer ask, cancels, and expects
"cancelled"; it also leaves a notice in the job's annotations (the results branch is shared: the newest
run wins).

