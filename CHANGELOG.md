# Changelog

thinky was built in public releases numbered "Build N". This history is told in five milestones,
each one the code exactly as it was released at its last build. Later releases add a section at
the top. (Until Build 32 the app was called Lean Outliner; its downloads and hidden id keep that
name, so updates install over older builds.)

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
