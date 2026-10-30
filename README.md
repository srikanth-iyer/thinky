# thinky

A small, fast outliner for Logseq-style Markdown notes, on Windows and Android.

Journals, `[[links]]`, `#tags`, `key:: value` properties, linked references, to-dos and quick
capture, on the same plain Markdown files Logseq uses. Your notes stay ordinary files in a folder
you choose; thinky has no accounts, no servers and no tracking.

**Website:** https://srikanth-iyer.github.io/thinky ·
**Download:** https://github.com/srikanth-iyer/lean-outliner-releases/releases/latest

(Until Build 32 the app was called Lean Outliner. The downloads, the program's file names and its
hidden id keep that name, so updates install over older versions.)

## What it does

- Journals, pages, links, tags, properties, linked and unlinked references, search (Ctrl+K).
- Edits Logseq's files in place: lines you didn't touch are written back byte for byte.
- Works next to sync apps (Google Drive, Syncthing…): changes made elsewhere are merged, a real
  clash shows both versions side by side, and nothing is ever silently overwritten.
- Quick capture: a shortcut key and a browser button on Windows, widgets, a Quick Settings tile and
  the share sheet on Android, and highlights from Edge.
- Tabs and two pages side by side, page history, safety copies, many looks.

## Building

You need Rust (stable), Node.js and, for the apps, the Tauri 2 prerequisites.

```
cargo test -p outline_core                 # the core's tests
cargo run -p devserver -- <notes folder>   # the app in a browser at http://127.0.0.1:8765
dev/ui-tests/run.sh                        # the browser tests (Playwright)
npm ci && npx tauri build --bundles nsis  # the Windows installer
```

The Android app is built by CI (`.github/workflows/build.yml`). `CLAUDE.md` is the detailed guide
to how everything works, and `docs/ARCHITECTURE.md` the map; read them before changing anything.

## Feedback and problems

Use **Settings › About › Send feedback** in the app, or open an issue:
https://github.com/srikanth-iyer/thinky/issues. Security problems: please see `SECURITY.md`.

## Licence

thinky is free software under the GNU Affero General Public License, version 3 (`LICENSE`).
Copyright (C) 2026 Srikanth Iyer. Bundled fonts and libraries keep their own licences
(`THIRD-PARTY-NOTICES.md`).
