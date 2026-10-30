# Third-party notices

thinky's own code is under the AGPL-3.0 (`LICENSE`). It includes or is built from these works,
which keep their own licences.

## Fonts (SIL Open Font License 1.1, full text in `LICENSES/OFL-1.1.txt`)

Bundled in `ui/fonts/`:
- **Inter**, Copyright (c) 2016 The Inter Project Authors.
- **IBM Plex Sans** and **IBM Plex Mono**, Copyright (c) 2017 IBM Corp., with Reserved Font Name "Plex".
- **Newsreader**, Copyright 2020 The Newsreader Project Authors.
- **Bricolage Grotesque**, Copyright 2022 The Bricolage Grotesque Project Authors.

The thinky wordmark (`ui/brand/wordmark.svg`) is drawn from letter outlines of **Reenie Beanie**,
Copyright (c) 2010 James Grieshaber, under the same licence. No font file of it is bundled.

## Libraries

The Rust crates (Tauri and others, listed in `Cargo.lock`) are under MIT, Apache-2.0 and similar
permissive licences. Run `cargo deny check licenses` (or `cargo about generate`) for the full list
with each crate's licence text. The page uses no JavaScript libraries.
