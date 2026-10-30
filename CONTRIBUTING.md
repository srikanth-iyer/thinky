# Contributing

Thanks for wanting to help. A few things keep thinky what it is:

- **Lean first.** It stays small and fast: no frameworks, few dependencies, no build step for the
  page. A change that adds a library, bundled files or start-up work needs a good reason; say what
  it costs (size, memory, time) in the pull request.
- **Never lose a note.** Saves keep untouched lines byte for byte, merge changes made elsewhere, and
  never write over a file unseen. Read "Rules that protect the notes" in `CLAUDE.md`.
- **Tests.** `cargo test -p outline_core` for the core and `dev/ui-tests/run.sh` for the page must
  pass. Add a test for what you change. Never test against a real notes folder.
- **Read the guide.** `docs/ARCHITECTURE.md` (the map) and `CLAUDE.md` (the detailed rules) say where
  each kind of change belongs.

Pull requests from forks run the tests only; signing and releasing happen only on `main` and need
the maintainer's approval. By contributing you agree that your work is released under the AGPL-3.0
like the rest of the project.
