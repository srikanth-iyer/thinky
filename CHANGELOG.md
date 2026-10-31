# Changelog

thinky was built in public releases numbered "Build N". This history is told in five milestones,
each one the code exactly as it was released at its last build. Later releases add a section at
the top. (Until Build 32 the app was called Lean Outliner; its downloads and hidden id keep that
name, so updates install over older builds.)

## Build 34 — not released yet (October 31, 2026)

### New
- To-dos: newest first (or oldest first, or by date as before), and buttons for the pages they're on or mention: a click shows only those, a second hides them.
- Linked references fold from their heading, like unlinked ones, and remember it. Their filter has the same page buttons.
- All pages → Namespaces lists only pages that really are in a namespace, and its columns sort it.
- A spelling check while typing (Settings → Look), with your computer's or keyboard's own suggestions.
- Ctrl+Enter also reaches CANCELED.
- The top strip's buttons are evenly spaced over the sidebar.
- Android's Add-a-note pop-up is more compact, with the same text sizes.
- The Windows capture box has small [[ ]], # and To-do buttons right on it.
- Faint words (counts, the weekday, reference paths, property names) are easier to read in Plain, Plain night, Calm, Paper and Night, and Plain's #tags in the full link colour.
- The Edge extension's Highlight key is Ctrl+Shift+H for a new setup; Settings → Capture lists the keys and where to change them.
- Updates now come from this repo's releases (github.com/srikanth-iyer/thinky). Build 34 is also on the old downloads page, so older builds still find it; from Build 35 on, releases are only here.

### Security fixes
Fixes from a security review made before the code went public. None of these were known to be used against anyone.

- A picture link can no longer point at another computer on the network or at a drive: on Windows, opening one could have sent the computer's sign-in to that computer.
- No web page can add a note any more: the "Add to journal" bookmark button is gone, and thinky ignores the links it made. Edge's "Send to today's journal" does the same job.
- Words that arrive from the web (Edge highlights) are always kept as plain words: they can't become links, tags, properties, to-dos, boxes or HTML in your notes.
- Pictures on the old, open web (`http://`) are no longer fetched; their address stays a link you can open in your browser.
- thinky's window only ever shows thinky itself, never another web page.
- Files in the notes folder are shown as pictures or files only, never as pages that can run anything.
- One unusual note can no longer stop a whole page from drawing.
- The notes folder's settings file can't send notes to a folder outside the notes folder.
- Android's share pop-up always shows and waits for Add (the "no pop-up" setting is gone), and only takes pictures that another app really shares, never the app's own files.
- The Edge extension listens only to itself, skips words hidden on a page, and its receiver runs only for it.
- Web pictures no longer tell their website which page they were shown on.
- A web link opened with a middle click or Ctrl/Shift goes to your browser, never to a window of thinky's own.

## Milestone 5 — Builds 32 and 33 (October 29 and 30, 2026)

- The app is now called **thinky**, with its own logo, and a new look of the same name.
- Highlights from Edge: highlight passages while reading and send them to one page per article.
- Neat web links in quick captures.
- Safety copies kept in the notes folder (so a synced folder keeps them too); an alias counts as its page.
- A welcome screen that can start a new notes folder with a short tour.
- Quieter phone menus and bars.
- Edit linked references right where they are; `#tags` counted in Tags; simpler to-do filters; a sort menu for references.
- A faint "+" after the last note, and a calm start-up.
- Send feedback (Settings › About) opens a new issue on GitHub, with nothing personal added.

## Milestone 4 — Builds 27 to 31 (October 27, 2026)

- Tabs, and two pages side by side on the laptop.
- Roomier journal days, Go to date, Undo across days.
- Linked references show the notes under them, as in Logseq.
- History for every page: its earlier versions, and one tap to put one back.
- A menu on each note's dot, and moving notes by dragging them, even to other pages; files dropped from Explorer.
- A shortcut key that opens the Add to journal box at once.
- The Logseq feel: Plain looks like Logseq, smarter search with recent searches, a command list (Ctrl+Shift+P), block references, typing pairs, formatted paste, Copy page as text, a sliding sidebar, drag handles, wide mode and folding.
- All pages as a table, renaming by the title, merging pages, `leanoutliner://` links to pages and notes.
- The Inter font bundled for the Plain looks.

## Milestone 3 — Builds 23 to 26 (October 26, 2026)

- Reading and writing: coloured note boxes and quotes, page icons, easier links, find and replace, press and hold to preview a link, pinned parent notes, swipes on the phone.
- The clash screen: when a page changed here and elsewhere, both versions side by side with a suggested pick, and nothing is ever lost.
- Safety copies of recently changed notes, and a bin for pictures nothing uses.
- Pictures you can resize, as in Logseq.
- An "Add note" tile in Android's Quick Settings and shortcuts on the app icon.
- A native "Add to journal" box on Windows that opens at once.
- One-click updates from Settings › About, checked against a signing key.

## Milestone 2 — Builds 13 to 22 (October 26, 2026)

- To-dos with dates and repeats, a calendar, templates, unlinked references, rename and delete with a bin.
- Quick capture from the laptop (a link, a box and a shortcut key) and from the phone.
- Safer syncing: edits made elsewhere are merged, unreadable files are never overwritten.
- The app's own title bar with back and forward, Logseq-style thread lines, link colours and fonts.
- Phone fixes: cleaner lines, the toolbar, file access, widgets, the Back button.
- Journals show each day's linked and unlinked references and a "Scheduled & deadline" box.
- A Home button, Settings in tabs, and a new look, Plain night.
- The Windows "Add to journal" box, launcher-style.

## Milestone 1 — Builds 1 to 8 (October 25, 2026)

The first version.
- A Rust core that reads and writes Logseq-style Markdown notes, keeping every untouched line byte for byte.
- An outline editor in plain HTML, CSS and JavaScript, wrapped as a Windows and an Android app with Tauri.
- Journals, `[[links]]`, `#tags`, `key:: value` properties, backlinks and search.
- Android: a home-screen widget with today's journal, a quick-capture pop-up, and sharing into the journal.
- Nine looks with live previews.
- Obsidian-style YAML headers read as page properties; emoji and curly quotes in page names; duplicate page names handled safely.
