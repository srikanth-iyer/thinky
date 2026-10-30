# Security

thinky reads and writes your notes, starts from links (`leanoutliner://`), receives highlights from
a browser extension and installs its own updates, so security problems matter.

## Reporting a problem

Please **don't** open a public issue for a security problem. Use GitHub's private report instead:
the repository's **Security** tab › **Report a vulnerability**
(https://github.com/srikanth-iyer/thinky/security/advisories/new). Include what you found, how to
reproduce it, and which build you tried (Settings › About shows it).

You'll get an answer as soon as possible. This is a one-person project, so please allow a few days.

## Supported versions

Only the newest release is supported; the app updates itself (Settings › About › Update now).

## How updates are protected

- Windows: each installer is signed with an ECDSA P-256 key that never leaves CI's secrets. The app
  checks the signature, the file's SHA-256 and that the build number is newer before running it.
- Android: Android itself only installs an update signed with the same certificate as the app.

## Known limits

- The Edge extension's ID is fixed by the public key in `browser/manifest.json`, so another unpacked
  extension can claim it and talk to thinky's receiver. The receiver only ever adds highlights as
  plain words (no links, tags, properties or HTML) to the last notes folder, so the worst it can do
  is add notes.
- Pictures on `https://` websites that a note links to are loaded from those websites when the note
  is shown, so a website can tell its picture was viewed.
- The release program keeps two self-test modes CI runs on it (`--capture-box-selftest`,
  `--hotkey-selftest`). Only a command typed on the computer reaches them; links can't.
