# Changelog

thinky was built in public releases numbered "Build N". This history is told in five milestones,
each one the code exactly as it was released at its last build. Later releases add a section at
the top. (Until Build 32 the app was called Lean Outliner; its downloads and hidden id keep that
name, so updates install over older builds.)

## Milestone 1 — Builds 1 to 8 (October 25, 2026)

The first version.
- A Rust core that reads and writes Logseq-style Markdown notes, keeping every untouched line byte for byte.
- An outline editor in plain HTML, CSS and JavaScript, wrapped as a Windows and an Android app with Tauri.
- Journals, `[[links]]`, `#tags`, `key:: value` properties, backlinks and search.
- Android: a home-screen widget with today's journal, a quick-capture pop-up, and sharing into the journal.
- Nine looks with live previews.
- Obsidian-style YAML headers read as page properties; emoji and curly quotes in page names; duplicate page names handled safely.
