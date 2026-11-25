# Changelog

thinky was built in public releases numbered "Build N". This history is told in five milestones,
each one the code exactly as it was released at its last build. Later releases add a section at
the top. (Until Build 32 the app was called Lean Outliner; its downloads and hidden id keep that
name, so updates install over older builds.)

Versions (decided Nov 9, 2026): the first number goes up when thinky is released to the public, the middle one for
big changes, the last for small ones (back to 0 when the middle one goes up). Until Build 40 the app itself carried
0.1.<build>; the versions in these headings were given afterwards, by what each build changed: 0.1 the first
working outliner (Builds 1–22), 0.2 safety, tabs, updates and references (23–28), 0.3 the Logseq feel (29–31),
0.4 thinky's name, brand and public releases (32–38), 0.5 day and night looks and the quieter phone (39 on).
From Build 41 these versions are the app's own: they show in Settings → About and in each release's
title on GitHub, and updates compare them, so a release is newer when its version is higher, whichever part
went up. Build 40 and older still update to it (each release keeps a signature file made their way).

## Next build (not released yet)

- The quiet days' dates slide open (he asked, Nov 25): a tap on the faint + between two days now opens the dates
  the way the menus open, growing out of the + over 0.2 s with the menus' curve, while the room under it opens
  and the older days slide down, instead of appearing in a quick cut. A second tap folds them back into the +
  (0.15 s). Nothing moves with "reduce motion" or Settings → Look → Animations off (`quietRun`, `quietSpot`,
  `.quiet.moving`; t38_build61).
- Big notes folders open faster (he asked, Nov 25; review L5 and L8): the app reads its files' notes on several
  threads at once, so starting the app, quick capture, the Edge extension's helper and the phone's "already kept"
  lookup all open a big folder about a third faster (23,000 files: start 0.6 s → about 0.4 s on a 4-core
  computer). Quick capture's "Add to another page" list now shows at once, from a small list of page names the
  app keeps beside its index cache, and is replaced by the folder's own list once it's open; a page picked before
  then waits for the folder instead of saying "try again" (`saved_page_list`, `parse_parallel`; tests/big_folder.rs).

## Build 60 · version 0.6.9 (November 2026)

The website gets clear headed sections (Why I made it, Try it or get it, Get started, What it does), small pictures for quick capture, the AI services' and apps' logos, a short "What is a Markdown note?" page, a small sun or moon icon for the look, and "Try it in your browser": an online demo with a few sample pages, nothing to install. It also gets a side menu like the app's, with its pages and the sections of the page you're on (on a phone, behind a menu button).

From his notes and asks (Nov 25), in the app and on the website:

- Quiet days in the Journals list (he picked version 2e of the mock-ups, Nov 25): between two days with days in
  between that have no notes, a faint + on the line that ends the newer day, under the notes' dots. A tap shows
  their dates there, 20px apart (24px on a phone), up to three in view; a longer run scrolls, the next ones fading
  out, and says where it is ("1 of 30"); a run longer than a year shows its newest year. A tap on a date puts that
  day in its place, its first note open; its file is made once something is written (`quietRun`, `.quiet`;
  t37_build60).
- Menus are slimmer on both the laptop and the phone (his second note, Nov 25): less room around the words, one
  soft edge instead of several, rows 34px tall on a phone (were 44px, then 38px).
- The faint "+" under a day's last note no longer sits on "Linked references" or "Scheduled & deadline": those
  start clear of it (48px under the notes, 56px on a phone, whose "+" line is 36px tall), so a tap meant for one
  doesn't hit the other. Days in the Journals list have more room between them (72px, 48px on a phone; 32px in
  the looks with a line between days, were 20px), and more under a day's last part on a phone.
- More room between a day's faint + and the line that ends it (he asked, Nov 25): about 40px on a laptop (was about
  20px), about 30px on a phone (was about 10px).
- When nothing follows a day's or a page's faint + (no "Scheduled & deadline", no references), more room still under it
  so the notes have space to breathe (he asked, Nov 25): a day about 90px on a laptop and 75px on a phone, a page about
  75px and 70px (`:has()` in app.css).
- An empty note is as tall shown as while typing in it (its least height counts its padding: `.bc`, `.ed`).
- thinky night's #tag pills are softer: a fainter orange tint and words closer to cream.
- Each day in the Journals list has a ⋯ with the day's page menu, Delete page… among it (the ⋯ on a day's own
  page already had it); Delete page… also shows once a new page's first note is saved.
- The to-do button (and Ctrl+Enter) on an empty note, or with the caret at the start of the words, leaves the caret
  after "TODO ", ready to type.
- The website's "Try it" stands out: a card at the top of the home page with one big button and a picture of the
  app that opens it too, and a "Try it" button beside "Look" on every page.

- The demo at srikanth-iyer.github.io/thinky/try/ is the app's own page and the app's own core (core/), built for
  WebAssembly (web/core-wasm, web/build-demo.sh). The visitor's notes stay in their browser (localStorage); the AI
  features and backups need the app, and pictures added in the demo aren't kept between visits.
- The website is now built rather than copied (.github/workflows/pages.yml): after each release it rebuilds the demo
  from that release's code, checks it in Chromium (web/demo-test.mjs: it starts, shows its first notes, keeps a note
  written; laptop and phone sizes) and publishes only if it passes.
- The home page says why thinky was made, and mentions the optional AI features, the backups and the extension's
  store pages; the privacy page says where the demo keeps its notes.
- The home page is laid out as a thinky page (a properties box, then an outline with bullets and the pale lines
  between a note and the notes under it), in the app's Plain look. Online (the website and the demo) there are only
  Plain and Plain night (he asked): a "Look" menu (site/look.js; in the demo the sidebar's Look) offers Light, Dark or
  System, and System is what shows at first. The looks are the newest release's own (web/site-looks.mjs copies
  ui/skins.css, its pictures and fonts, and the looks in ui/app.js WEB_LOOKS), saved like the app saves them, so the
  demo opens in the choice made on the site and the other way round. The app keeps all its looks.
- Under the hood: the core runs its work one job at a time when built for WebAssembly (no threads there) and uses a
  fixed process number there; the app's own builds are unchanged. The demo's own code (web/demo/) stays out of ui/,
  so the app doesn't carry it.

## Build 59 · version 0.6.8 (November 2026)

The browser extension now reaches the Edge and Chrome stores by itself.

- After each release, GitHub sends the extension to Edge Add-ons and the Chrome Web Store whenever its version is new to that store, and asks for the review. Once a store approves it, Edge and Chrome update everyone's copy on their own. No more uploading zips by hand.
- A release whose extension changed without a higher version number now stops, so a store never gets two different packages under one number.
- The extension is version 1.1.2: the Nov 21 fix (hidden words judged on the live page; Send keeps highlights added meanwhile) had gone out as a second "1.1.1".

Under the hood: `.github/workflows/stores.yml` and `scripts/extension_store.py` (Edge's publish API with an API key; the Chrome Web Store API with no stored key, through Google's Workload Identity Federation); `scripts/release_check.py extension` in the `number` job.

## Build 58 · version 0.6.7 (November 2026)

Fixes from two code reviews (Nov 22 and Nov 23), each checked against the code first and each with a test that fails on the old code.

- A real page could be listed as a sync app's "conflict copy" and moved to the bin: any name with the word "conflict" in it, or "X (2).md" next to "X.md", counted. Now only real sync marks count, and "X (2).md" only when it really is a copy of X. The other way round too: a sync app's copy ("Foo (1).md", OneDrive's "Foo-LAPTOP.md") can no longer take the page's place.
- Renaming a page now also changes its links inside embeds and queries ({{embed [[Foo]]}}), and in a plain-Markdown file only the link changes.
- A new name ending in "." or ":" keeps its whole name as a tag, and the app reads such tags one way everywhere (the # list, pasting, the filter buttons): "#v1.2" is "v1.2".
- A template with an odd "<%>" in it no longer stops a new journal day from opening.
- A backslash at the start of a line ("\\ -") is no longer lost when the page is saved.
- Text made "harmless" (from a web page or the phone's "Add to thinky") no longer makes hidden tags.
- A tags:: or alias:: value with a comma inside [[ ]] stays one link.
- Undo with notes selected no longer leaves the wrong notes selected (before, Delete could then delete the wrong note).
- The Journals list moves on to the new day after midnight, and the phone's "+" adds to today, not yesterday.
- A note moved to two different places on two devices now shows as one clash instead of appearing twice.
- Saving the same words a file already holds writes nothing, and a save keeps its safety copy until the note reads back whole.
- A web picture in an AI suggestion becomes a plain link, so nothing is fetched before you press Keep.
- Phone: the "Add a note" pop-up's to-do button makes a real to-do; a pages or journals folder made after the app started is now watched; a shared web page's link is now made by the same rules as on Windows (a title like {{query …}} goes in harmless).
- Keyboard: arrow keys are fast again under a big folded note; boxes keep Tab inside and give the keyboard back when they close; Esc closes a full-size picture.
- A picture bigger than 25 MB now shows a short note saying it is over thinky's 25 MB limit, instead of a broken picture.
- Under the hood: on Windows, git backup only runs git.exe from PATH, never one next to the app; the AI key check exists once, in the core; the picture server sends only pictures, at most 25 MB; re-running an old release on GitHub can no longer publish over a newer one; the phone's file-watcher and widget tests now run on every build.

## Build 57 · version 0.6.6 (November 2026)

Fixes from a fresh full review (Nov 22), each checked again by a second reviewer.

- Typing that couldn't be saved (the file locked, the folder offline) is no longer lost when the window closes or the phone puts the app away: a copy goes to logseq/bak first, and a failed save now tries again by itself every few seconds while the page is open.
- A page that another program had cut short on disk (a sync app caught halfway through writing it) could lose its last notes when you saved. Now, whenever a save removes notes you didn't remove, the old page is copied to logseq/bak first, and a file cut off in the middle of a line counts as a clash.
- Git backup: files named like git's own (`.git`, `.gitmodules`, `.gitattributes`, `.gitignore`) in the notes folder are no longer copied into the backup repo, and git runs with its risky settings switched off. Before, a file planted in a synced notes folder could make the backup run a command, fail every time, leave notes out, or push them somewhere else. Zip backups still keep those files.
- Saving a page that many other notes link to is fast again (670 ms → 4 ms with 20,000 links).
- Under the hood: the unused Play key export workflow and its key file are gone (the key is already with Google Play).

## Build 56 · version 0.6.5 (November 2026)

The rest of the outside code review (Nov 21): two more of its suggestions.

- Android updates from GitHub are now checked with a signature file too, as on Windows: the phone downloads `thinky-apk.sig` first and installs nothing unless it is signed with thinky's update key and matches the download. Phones on Build 55 or older update to this build the old way; from this build on, every update is checked.
- Under the hood: the page's JavaScript is now type-checked (`npm run typecheck`, TypeScript's checker reading ui/ with jsconfig.json; 0 errors, no checks switched off). CI's test job also runs the Android checks, the overlay test and a new signature test (scripts/update_sig_test.py). A browser test that sometimes failed on CI (t34) now waits for the menu to close.

## Build 55 · version 0.6.4 (November 2026)

Fixes from an outside code review (Nov 21): safety and security first, then smaller things.

- AI keys: a key goes only to the service it was saved for. A key for "Other" is now saved together with its address, so after updating, type the Other service's key in Settings → AI once more (OpenAI, Anthropic and the rest keep theirs).
- The phone no longer offers Ollama or LM Studio (they run on a computer, and the phone reaches only https services).
- On the phone, a YouTube video opens in its own app or the browser, outside thinky.
- Updates from GitHub on Android install only when the download is signed with the same key as the app on the phone; anything it can't check counts as "no".
- When a page changed on another device while you were editing it, thinky now shows the "which one to keep" screen in more of those cases instead of writing over the other copy.
- Backups no longer pause typing while they run, and closing the Windows window twice in a row no longer cuts a save short.
- Add to thinky (the Edge extension): up to 20,000 characters at a time and 10 sends a minute.
- Formulas that would draw far too much are refused; a link's label can't hold another link; code is never read as a formula.
- The calendar's PageUp and PageDown move by a month across a year's end; page names with & or < show as typed in breadcrumbs and questions.
- Under the hood: the dev server serves only ui/ and answers its API only to its own page; tests t34_review, core review_core and ai_keys, Android Checks and watch tests; CI builds the shell's plain tests as the package shell_pure_tests.

## Build 54 · version 0.6.3 (November 2026)

- Polish note: a click on the AI's words lets you change them by hand before keeping them (each of its notes becomes a text box; Keep or Ctrl+Enter keeps them as typed, Esc shows them drawn again). Nothing is saved before Keep, and a note emptied by hand isn't kept.
- The ✦ no longer starts anything by itself: it opens a small "AI" menu with Polish note (and Picture to text on a note with a picture). The same on the phone toolbar's ✦.
- The ✦ beside an edited linked reference is no longer cut off at the reference box's edge (it was in every look; most in Paper).
- Under the hood: polish.js `aiMenu`, `drawNotes`, `editNotes`; popups.js `menu()` takes a `title`; test t33_build54 checks the ✦ is whole in every look, t31 the menu and the editing.

## Build 53 · version 0.6.2 (November 2026)

- The laptop's note menu: resting the mouse on "More commands" opens the "/" commands beside it, with a box to narrow them (→, Enter or a click opens it from the keyboard too). The phone keeps "More commands…".
- Calm's note cards sit lower: a thin edge and a short, close shadow, so they no longer look lifted high off the page.
- Paper looks like paper: a soft, faint handmade (washi) paper under the page and the cards, drawn by thinky itself (ui/skins/washi.svg, under 2 KB), words in a deeper ink with a hair of spread as in print, a deeper ink red and dark ink-blue links; the sidebar has a plain, whiter background of its own, so its words read easily.
- Settings → AI: the note lists every AI feature now; a reply about one service's models can no longer clear a message about another (a choice made meanwhile).
- Under the hood: popups.js `slashChoices` (the "/" list's rows, shared by the submenu); skins.css `--ink-shadow` (none but in Paper); tests t28_build46 (the submenu), t16_looks2 (Calm and Paper's lower shadows, the washi).

## Build 52 · version 0.6.1 (November 2026)

The rest of the optional AI features (off until an AI is set up in Settings → AI). Each one shows what it suggests in the page, and nothing is saved until you press its one filled button.

- Picture to text: on a note with a picture (the note menu, or "/picture to text"), the AI reads the picture's words into sub-notes under it, using the model for pictures. The picture stays.
- Ask about this page (the page's ⋯ menu): a question answered from the page and every note that links to it. Each point names the page or day it came from (a click opens it); "Add to page" adds the question with the answer under it.
- Suggest aliases and a description (the page's ⋯ menu): aliases to tick and a description you can edit, added to the page's properties. It never offers a name another page already has.
- Suggest links (a ✦ button on "Unlinked references"): the AI reads the page and what links to it, then ticks the mentions that really mean this page and says why it left the others. "Link" turns the ticked words into links, with Undo.
- Polish note works with Claude's newer models: thinky no longer sends a "temperature" setting, which they refuse ("`temperature` is deprecated for this model").
- Under the hood: core ai.rs builds each request (a picture goes along as the service expects it) and checks each answer (links only to pages that exist); new ui/ai-page.js; tests core/tests/ai.rs and t32_build52.

## Build 51 · version 0.6.0 (November 2026)

A bigger step, so the middle number goes up: optional AI features, starting with Polish note. They stay off and out of sight until you choose an AI in Settings → AI.

### New
- **Settings → AI.** Pick a service from a list: Claude, OpenAI, Gemini, OpenRouter, or a program on your own computer (Ollama, LM Studio) that works offline with no key, or any other service that speaks the OpenAI format. Paste your key, press Test, and choose a model for text and one for pictures from the service's own list. Your key is kept by Windows (Credential Manager) or by Android's secure key store, never in your notes folder and never shown again.
- **Polish note.** The AI tidies one note: spelling and shorthand fixed, a to-do with its date when the note says one ("next Tue" becomes a SCHEDULED date), links only to pages that exist, and tags only from the ones you already use. Its version appears in the note, the new words fading in and lightly tinted, with one line of buttons: Keep, Changes, Retry, Undo. Nothing is saved until you press Keep, and Keep can be undone. Start it from the ✦ at the end of a note (laptop), the ✦ in the phone's toolbar, the note menu, `/polish` or the command list.
- Notes the AI writes are marked `by:: ai` (you can turn this off), and your note's own properties (its `id::`, for example) are kept.
- Settings → AI → Advanced: your own wishes for Polish note (say, "British spelling"). They're added after thinky's own instructions, which can't be changed or broken.

### Changed
- Calm plain has a colour family of its own: a rich slate teal for buttons, ticks, links and tags, in place of Calm's sage green beside purple links.

### Under the hood
- One place builds every request and reads every answer (core `ai.rs`), for both request formats (Claude's and the OpenAI-style one), with Polish note's fixed instructions and the checks on its answers. Requests go out through Windows' own curl.exe and Android's own web code: no new library, so the app doesn't grow. https only, except a program on your own computer or home network.
- A note's words are sent only when you ask, with the names of nearby pages and your tags in use; never your whole notes folder.

## Build 50 · version 0.5.11 (November 2026)

One fix, from your note of Nov 18.

### Fixed
- Settings → Safety → Backups → Choose… can now pick a clone of your backup repository with the GitHub kind, such as C:\Users\you\vault-backup. A clone holds a copy of your notes, so it has a `pages` folder, and the picker took it for a notes folder and turned "Use this folder" off. It now says "A git repository holding a copy of your notes" and lets you use it. Your open notes folder, a folder inside a notes folder, a notes folder that isn't a git clone and (with the snapshot zip kind) any notes folder are still refused.

## Build 49 · version 0.5.10 (November 2026)

Fixes from three independent reviews of Build 48, and your picks of Nov 14.

### Changed (your picks)
- ← / → with notes selected now start typing, as in Logseq: ← in the first selected note with the text cursor at its start, → in the last one with the cursor at its end. (In Build 48 they folded and unfolded.)
- Ctrl+↑ / Ctrl+↓ with nothing selected now go one level per press, as in Logseq: Ctrl+↑ folds the deepest level of notes still open, Ctrl+↓ opens the top-most folded level. (In Build 48 they folded or opened everything at once.) With a note being typed in, or notes selected, they still fold and unfold those notes.
- A page's ⋯ menu has a small icon on each row, like the phone's side menu.

### Fixed
- Settings → Typing & keys → Change: if you left Settings (or switched to another Settings tab) without pressing keys or Esc, thinky kept listening, so keys you typed later in a note were taken as the new shortcut and saved to config.edn. It now stops as soon as the row is off the screen.
- Change can be used with the keyboard alone: Tab moves to Back to default, Turn off and Cancel, Enter presses them, and the keyboard goes back to the row's Change button afterwards. Ctrl+T, Ctrl+W and Ctrl+Tab no longer open or close tabs while a row waits for keys.
- Change no longer saves keys that would never work: a two-key shortcut for an action only one-press keys reach (Search, Find, Back…), one using Space, ↑ / ↓, Home, End or Page Up / Down (they scroll the page first), one made of fixed keys (Enter then Enter), Shift+F10 or the menu key (they open the note menu), and Alt+Shift+↑ / ↓ for anything but moving a note (they also move favourites). It says why, and waits for other keys.
- A shortcut set to an F-key (F1–F12) now works.
- Shift with a sign is saved as Logseq writes it ("shift+/", not "shift+?"), so Logseq can read it, and a "shift+/" written by Logseq works in thinky too.
- Before warning that keys are taken, Change reads config.edn again, in case it changed elsewhere. When keys are taken over, the new action gets them first, so a save that fails never leaves both without keys.
- Back to default keeps your comments in config.edn: an entry takes only its own comment along, and a comment on the line before stays. A new `:shortcuts` section uses the file's own line endings (Windows or not), and a new entry goes after the last one's comment, never inside it.
- config.edn with `#_#_` (skip the next two items, as Clojure and Logseq read it) was read wrongly, and Change could then put a shortcut in the wrong place. It's read as Logseq reads it now.
- A change made to config.edn elsewhere (by your sync, or Logseq) just before thinky wrote it itself was kept in the file but not taken in until a restart; the next look at the folder takes it in now. On Windows and Android, thinky now also notices config.edn changing while its window is in front.
- With a note selected inside another one, Fold or unfold all (Ctrl+Alt+T in your setup) folded it away but left it selected, so Delete would remove a note you couldn't see. The selection now moves to the nearest note that shows.
- Show attachments on this page: on a phone the bar sits above the round "+" and above the editing toolbar while you type; the file names shown when the mouse rests on a note go away when you close it; and a link you add while it's on is counted and lit a moment later. The command list says "Hide attachments" while they show.
- Help pages and messages that still pointed to the old places: Send feedback is under Settings → Help (the starter tour, the website's home and privacy pages, the README), and deleted pages and pictures are under Settings → Safety (the starter tour, the message after deleting pages, the "Pictures nothing uses" dialog, a merge's Undo message).
- Check this folder: "Moved N pictures to the bin" has its ✓ in the same column as the others.
- The keyboard shortcuts card no longer says Logseq "uses the same keys": Logseq reads the ones it also has, and a few do slightly different things there.

### Corrections to Build 48's notes
- Ctrl/Alt shortcuts work anywhere except while typing in a note.
- On the Journals list, fold and unfold act on one day (the one you last used), not the whole list.

### Under the hood
- ui/settings.js `recordKeys` (listens only while its row shows, `app.recordingKeys()` for tabs.js; `refuse`; `KEPT_FOR`, `SCROLLS`, Shift+F10 and ContextMenu in `FIXED_KEYS`; `RUN_ACTIONS` from app.js), ui/keys.js (`evChord`'s `base` from `e.code` with Shift, `same` matching either; `SEQ_MS` shared with app.js), ui/editor.js (← / → `edit`, `foldAll` one level, `keepSelShown`), ui/attach.js (`again`, tips cleared), ui/dom.js icons and popups.js `menu()` items' `icon`.
- Core: edn.rs (`#_` drops one real form, so `#_#_` drops two; `set_entry` removal and insertion around comments; `set_path` line ends), app.rs `own_config_written`. src-tauri watch.rs: the `logseq` folder watched for config.edn only. Tests: tests/features.rs `shortcuts_change_in_place` (more cases), `a_change_made_elsewhere_survives_the_apps_own_config_write`; t29_build48 updated and extended.

## Build 48 · version 0.5.9 (November 2026)

### New
- Change your keyboard shortcuts in Settings → Typing & keys. Each shortcut has a **Change** button: press it, then the new keys (with Ctrl or Alt, like Ctrl+Alt+O, or two keys one after the other, like g then j). If another action already uses those keys, thinky says which one and asks before taking them over. **Back to default** and **Turn off** are there too. The keys are saved in `logseq/config.edn` (`:shortcuts`), the same place Logseq reads, so both apps use the same keys. The basic editing keys (Enter, Tab, Ctrl+Z and so on) stay as they are.
- "Show attachments on this page", in a page's ⋯ menu (and the command list). Every note that links to a file in `assets` (a picture, a PDF, any file) is highlighted, a small bar at the bottom says how many, and ↑ / ↓ (or the bar's arrows) step from one to the next. One inside a folded note is shown while you're on it and folded again after; nothing in the file changes. Esc, the bar's × or the menu item again clear it.
- With notes selected (press Esc while typing), ← folds the selected note and → unfolds it, like folders in a file list. A note with nothing to fold stays as it is.
- Ctrl+↑ and Ctrl+↓ fold and unfold, as in Logseq: the note you're typing in, the selected notes, or with neither, every note on the page.

### Fixed
- Shortcuts with Ctrl or Alt set in `logseq/config.edn` (for example Ctrl+Alt+T for fold or unfold all) did nothing unless you were typing in a note. They now work anywhere, and with notes selected.
- Settings → Notes → Check this folder said "pictures" for every missing file, though it checks every kind of file a note links to. It now says "files", the heading is "Missing files", and each missing file says whether it's a picture, a PDF or another kind of file.

### Changed
- Check this folder's report is easier to read: short labelled parts (Read, Saving, Longest pages, Most linked, Files in assets), the longest and most linked pages as lists with their numbers on the right (a click opens the page), every ✓ lined up in one column, and the note about pictures from the last 3 days in smaller grey text on its own line.
- Settings → Typing & keys → Keyboard shortcuts: the shortcuts in three groups (Go, Notes, Window), and the fixed keys, which were one long sentence, as a table in three groups (Editing, Selecting, While typing).
- Settings' tabs are now About, Notes, Safety, Look, Typing & keys, Capture and Help. Property display moved to Look (it decides how notes look); Writing became Typing & keys (spelling and the keyboard shortcuts); Updates & about became About (the version, updates and What's new), and Send feedback and the problems log have a Help tab of their own.

### Under the hood
- Core: `pictures::asset_links` (the files in `assets` one note links to, the rule Check this folder's missing files already used, now shared with "Show attachments"; a link inside a `{{pdf …}}` macro now ends at its braces), the `asset_links` command, `App::set_shortcut` and `edn::set_entry` (one entry of a map in config.edn set or taken out in place, every other byte kept, a new one lined up under the others with the file's own line ends). Tests: tests/features.rs `shortcuts_change_in_place`, tests/pictures.rs `links_to_files_in_assets_in_one_note`.
- The page: `ui/attach.js` (loaded on first use), the key helpers moved from app.js to keys.js (`parseChord`, `evChord`, `same`, and the new `chordText`, `sameKey`). New UI test t29_build48 (the keys, folding, Change, the tabs, attachments, the report); tests that named the old tabs and headings follow them.

## Build 47 · version 0.5.8 (November 2026)

### New
- Seeing your highlights again now includes quick captures still waiting in your journal: a passage you sent with the extension's "Send to today's journal" (or shared from your phone) is marked on the article, and listed in the extension's box and the phone's share pop-up, before you file it onto the article's page. Captures sent to the quick capture page (when they don't go to today's journal) count too.

### Fixed
- Passages that start with a quick capture's time (`**22:19** …`, as filed quick captures do) were never marked again on their article: the time was looked for on the page along with the words. It's left out now.

### Browser extension 1.1.1 (from the Edge and Chrome stores once they approve it)
- "Send the selected text to today's journal" with nothing selected no longer sends the article's bare link to your journal: it says to select some text first, and the box greys the link out until text is selected.
- "Show my highlights again" moved behind a gear at the top right of the box: it's set once and stays on, so it no longer takes room every time the box opens.
- A passage is found on the article even when its spacing differs a little from the page's (a missing space, two paragraphs that touch with no space between them on the page).
- Articles whose words appear a moment after the page loads (many news sites) get their passages marked: what wasn't found is looked for again after 2 and 6 seconds.
- A sent journal passage counts as kept at once (the extension asks thinky again instead of waiting up to 10 minutes).
- Addresses with encoded characters in their query (`?q=a%20b`) match their page in your notes.
- The "isn't set up yet" message names the right setting: Settings → Capture → "Highlights from your browser".

### Under the hood
- Core: `clip::capture_rest` (a quick capture's own beginning, from the `:quick-capture-templates` text template, with a fallback for an older template), `clip::web_addresses`, `Vault::capture_notes`, and `strip_capture_time` in `plain_words`. Tests: tests/clip.rs `a_quick_captures_time_is_not_part_of_the_passage`, `quick_captures_waiting_in_the_journal_count_as_kept` (including the extension's journal message end to end). t16_browser checks spacing, a capture's time, a journal capture, late words, the journal link with nothing selected and the gear (52 checks).

## Build 46 · version 0.5.7 (November 2026)

### New
- See your highlights again. In Edge or Chrome, open the thinky highlights extension's box on an article and the passages your notes already hold from it are marked on the page (a paler yellow, underlined) and listed in the box. To have them marked every time you come back to one of your articles, tick "Show my highlights again on pages I've highlighted" in the box; the browser asks once to let the extension see the pages you open. It compares each address with your articles on your computer and leaves every other page alone. Off until you turn it on. Pages you filed by hand count too, when their `source::` is the article's address.
- On the phone, sharing an article to thinky (Share → Add to journal) lists the passages your notes already have from it, under what you're adding. Tap the list to see them all. Nothing to set up.
- A how-to page on the website explains highlights step by step, with pictures (srikanth-iyer.github.io/thinky/highlights.html); Settings → Capture and the extension's box link to it.
- To-dos: right-click a to-do's tick box (on a phone, press and hold it) for every state: To do, Doing, Waiting, Done, Cancelled (Later and Now with the NOW workflow). Done works as ticking does, so a repeating to-do moves to its next date.
- The note menu (right-click a dot, or hold it on a phone) has "Number its sub-notes" and "More commands…", which opens the whole "/" list for that note.
- A property's page shows every value it has, with how many notes use each, as buttons. Pick one to see only the notes with that value (exactly that value: "book" doesn't also bring "ebook"); pick it again to see all.

### Changed
- Settings → Look → Text size: dragging the slider no longer changes the whole screen under your finger. While you drag, a sample line shows the size; letting go sets it everywhere. New − and + buttons change it one step at a time.
- The journal widget on the phone's home screen draws your notes as the app does: bold, italics, strike-through, highlights and code; headings a size bigger; page links, tags and web links in the look's link colour; DOING, NOW and WAITING as a word in the look's accent. To-dos have a drawn box as in the app (open, ticked, or crossed out when cancelled), a done one struck through and faded, and other notes the app's dot. A note's first picture from your notes folder shows as a small picture under its words (up to six in the widget at once, turned the way the camera held it); a picture from the web keeps its name. A formula shows its text: the home screen can't draw formulas in a widget.

### Fixed
- Settings → Notes → Check this folder on a phone: in "Pictures nothing uses", a long file name got so little room that it stood one letter per line. The name now has the row's width, with its size and "Where was it used?" on the line under it. The missing pictures' file names are listed from the left under their page, instead of right-aligned in ragged pieces.

### Under the hood
- The phone test checks how the widget draws a formatted note (step 7c, through a real widget row), and a new test checks both picture lists on a phone and a laptop (t28_build46).
- The app answers two new read-only questions from the extension: which articles have a page in the notes, and the passages of one article (core `clip::article_urls`, `kept_highlights`); the phone's pop-up asks the second through the app's own code too. The extension (version 1.1.0) asks for the "all websites" permission only when the switch is turned on, and gives it back when it's turned off. Tested in a real Chromium (t16_browser), in core tests and on the phone emulator (step 5c).
- t28_build46 also checks the to-do states menu (mouse and finger), the note menu's two new rows, a property's value buttons and the text size control.

## Build 45 · version 0.5.6 (November 2026)

### Fixed
- A page's title has room under it. The filter box of All pages, To-dos and Properties, the row of tabs in Settings, the "Rename or merge…" button on a property's page and a page's properties box sat right against the title's letters (1 to 4 pixels away; the button touched them). They now all keep the same distance from it: 16 pixels under a laptop's title, 11 under a phone's smaller one.
- Settings → Look: the ring round the look in use no longer touches the "Day look" / "Night look" heading above it.

### Under the hood
- One number sets that distance for every screen (`--title-gap`, a share of the title's size), and a new check measures it on each screen, on a laptop and a phone, and in every look (t27_build45), so a new screen can't bring the crowding back unnoticed.

## Build 44 · version 0.5.5 (November 2026)

### New
- Tables in notes. Rows of cells between "|"s, with a line of dashes under the first row (`| Loaf | Water |`, then `|---|---|`), now show as a table instead of as typed. Colons in the dashes line set which way a column lines up (`:--` left, `--:` right, `:-:` centre); a wide table scrolls sideways inside its note. The file is unchanged, so Logseq shows the same table. Find on the page looks in the cells, never at the table's own "|"s.

- The "/" list has a small icon in front of every row (a tick box for the to-do words, a clock for Scheduled, a flag for Deadline, H1 to H6 for headings and so on), so a row is found by its shape as well as its name. On the phone too.

### Changed
- In the thinky looks, the drawing in the sidebar has room of its own between the lists and Look / Settings. A long Recent list used to run over it; now the list ends above it. With little room the drawing gets smaller (down to 52px) before Recent shows fewer pages, and a window under 520px tall leaves it out.
- On a phone, while you type, the notes move up into the top bar's strip instead of leaving it empty, and the toolbar above the keyboard shows a whole number of tools (the last one used to show cut in half). Its edge fades softly where more tools are hidden, and scrolling it stops on whole tools.
- The app's own words and corners follow one short scale: six text sizes for the interface and two for headings (there were 17, many half a pixel apart), five corner roundings (there were 13). Nothing moves much; screens just sit more evenly next to each other. The sidebar's menu and its lists are now the same size. The notes' own text size, titles and each look's own shapes are unchanged.

### Fixed
- A save is now put on the disk before the page's file is replaced. Before, a power cut or crash in the moment after a save could, rarely, leave that note's file empty or cut short.
- Renaming a page, merging pages and renaming a property change many files in one go. They now work on 8 files at the same time: each file is still put on the disk before it replaces the old one, but the waits overlap, so a slow disk no longer makes these take seconds.
- Faint words (the menu's headings, counts, property names, dates) are darker in thinky, Sticker, Automaton and Plain teal, so they read clearly (at least 4.5 to 1 against what they sit on; they were between 3.0 and 4.2). Sticker's overdue dates and Plain teal's highlighted words too. The other looks already met this.
- On a phone, small things are easier to hit without looking any bigger: a note's dot answers a tap in the margin to its left, a to-do's box a tap just above, below or left of it, and filter buttons, small buttons and the page's icon buttons answer a tap 36 to 40px tall (they are drawn 28 to 34). The menu's rows are a little taller (35px, were 29). Nothing reaches over a note's words, so a tap on its first letters still edits it.
- Long pages stay quick to edit. Enter, Tab, Backspace at the start of a note and Undo used to draw the whole page again each time, which took 40 to 100 ms on an 850-note page; now only the rows that changed are drawn (about 20 ms, most of it the screen's own next frame).
- The To-dos list opens faster with thousands of to-dos: it draws the first 150 and the rest as you scroll towards them. Its counts, filter and sort work on all of them as before, and ticking one far down keeps your place.
- After a long scroll back through the Journals list, typing in today's notes no longer slows down (with 300 days loaded, Enter took 45 ms; now 7 to 10): days far from the screen are left undrawn until you come back near them.
- Today's "Scheduled & deadline" draws the overdue to-dos only when you unfold them.

### Removed
- The Azulejo look. If it was your look, thinky shows instead.

### Under the hood
- `write_atomic_checked` flushes the temp file (`sync_all`) before the rename; a drive that can't flush still saves. `each_file` (app.rs) runs a rename's and a merge's link files, a merge's Undo and `rename_property` on 8 threads when there are 8 files or more (results in order, each file's stamp taken right after its own write); the speed check times a rename across 300 files (`rename_ms`), and its reference for a save is 5 ms now that a save waits for the disk. `SLASH_ICON` (dom.js). `.side-art` (app.css, `--side-art` in skins.css). `App.fitTools`, `html.typing-in`. The scale: `--fs-*` and `--r-*` in skins.css; app.css has no fixed text size or rounding of its own (t26 checks). `Outline.keepRows` (editor.js) keeps the rows whose `rowSig` is unchanged at the start and end of the page. `drawInParts` (views.js) draws long lists a part at a time. Journal days far from the screen get `content-visibility: auto` (`.sheet.day.far`). New UI test t26_build44 measures all of it (contrast of every drawn word in all 12 looks, what answers a tap on a phone, a page after each change against one drawn from scratch).

## Build 43 · version 0.5.4 (November 2026)

### New
- A hidden sidebar peeks out when the mouse rests on its button, floating over your notes without moving them. Its links and buttons work as usual, and it slides away when the mouse leaves it (or with Esc). A click on the button still keeps it open, as before.
- Each property's own page (Properties → its name) now has the same "shows on notes as" choice as Settings → Writing → Property display: Show, Quiet, Icon or Hidden, and a mark. A change in either place shows in the other.
- The Tags list has a filter box and A to Z / Most used, like the Properties list. The order you pick is remembered.
- On a phone, Settings' tab row shows a small › (and ‹) at its edge while more tabs are hidden there; a tap scrolls the row. The first time, the row also gives a short nudge so it's plain that it scrolls.
- Backups: a "Choose…" button beside the folder opens a folder picker, so the folder needn't be typed. It won't take a notes folder or a folder inside one, and for a GitHub backup it says whether the folder is a git clone.
- In "Check this folder", a click on a picture nothing uses (or its name) shows it big, so you can see what it is before moving it to the bin. Its tick box works on its own.
- In "Deleted pages and pictures", a click on a page shows what it holds (read-only, with "Restore this page" there too), and a click on a picture shows it big, so you can decide before bringing one back.
- "Pictures nothing uses" has "Where was it used?" beside each picture: it looks through the older copies of your pages (the backups in logseq/bak, the safety copies, and your backups when they're on) and shows the notes that used the picture, with the notes above them and the date. "Open the page…" asks before taking you there, since the note isn't on the page now.
- Sync-conflict copies (like "Page (conflict 2026-11-08-13-18-30).md") have "Compare and merge…" in "Check this folder". It opens the page and shows it side by side with the copy, only where they differ, with "Keep both" suggested where each has its own words, so nothing is lost by default. After you choose, the page is saved (its earlier version kept in logseq/bak) and the copy goes to the bin. A copy that says exactly what its page says is simply offered to the bin.
- Compare and merge highlights what differs: in two versions of a note, only the words that changed are marked, each side in its own colour; a note only one side has is tinted; the same words indented differently say so. Spaces at line ends and a note's folded state no longer count as differences, so those spots aren't shown at all. Where the two versions of a note differ only by a word or an indent, this page's is suggested (keeping both would show the note twice).
- "Check this folder" keeps its report: go elsewhere and come back, and the last results are still there, saying when they were made, with "Check again".

## Build 42 · version 0.5.3 (November 2026)

### New
- A Google Play version of the Android app, for its listing on the Play Store. It is the same app; it updates through Google Play, so it has no "Update now" and doesn't ask to install apps. The downloadable APK is unchanged and keeps its one-click updates.

## Build 41 · version 0.5.2 (November 2026)

### New
- A calmer top strip on the laptop. Above the sidebar, each button has a spot of its own that never moves: the sidebar button, Search, Back, Forward and one spot that is the calendar on today's journal and Home anywhere else. Back and Forward appear only when there's somewhere to go. The tabs and the "+" always start just past the sidebar's edge, whether the sidebar is open or hidden, and with one tab there's only the "+".
- The logo and the name moved from the strip into the top of the sidebar.
- Search opens in place: the search box grows out of the magnifier, to the right and down in one movement, with your recent pages under it, and folds back into it with Esc. The page behind it stays as it is.
- Menus open out of the button that opened them in the same way: the page's ⋯ menu, a note's dot (its menu now opens from the dot even with a right-click), Go to date, the Sort menus and the others; each folds back into its button when it closes.
- One feel for everything that opens and closes: opening takes 0.2 seconds and closing a little less, with the same smooth start and gentle stop. New tabs widen into place and the others slide over when one closes. Settings → Look → Animations turns it all off.
- The app's version is now the one people see (0.5.2), shown with its build number in Settings → Updates & about. Updates compare versions, so any part of the version can go up; Build 40 updates to this build as usual.

## Build 40 · version 0.5.1 (November 2026)

### New
- Settings has six tabs: Updates & about (first), Notes, Safety (the bin, safety copies, backups), Look, Writing (spell check, property display, keyboard shortcuts) and Capture. On a phone the row scrolls sideways.
- An "Update ready" button at the right of the laptop's top strip when a newer build is out, with Update now and What's new; on the phone, a line at the top of the menu. The app looks for updates every 2 hours and whenever you come back to it.
- What's new, in the app (Settings → Updates & about): each build's notes, newest first, with yours marked.
- Property display shows an example note for each choice.

### Fixed
- In the night looks, the page behind the search box and dialogs goes darker instead of lighter grey.

## Build 39 · version 0.5.0 (November 2026)

### New
- thinky night: thinky's layout on a warm charcoal, with cream words and the spark's red.
- Light / Dark / Match system (Settings → Look): pick a day look and a night look; thinky shows one, the other, or follows your computer or phone.
- The phone's top bar is lighter (42px) and gets out of the way: it slides away while you scroll down to read and while you type, and comes back solid with a soft fade under it. Back and Forward show only when there's somewhere to go, and the page's name appears only once its big title has scrolled away. Beside Search: the calendar on today's journal, Home everywhere else.
- Press and hold (or right-click) Back or Forward to see the pages that way and jump straight to one, like a browser.
- On a phone, swipe sideways on the note you're typing in to move it in or out a level, even when it's empty; the keyboard stays up.
- Tap or click anywhere on the empty line under the last note to add a note, not only on the "+".
- Sort menus (linked references, "Pages in …", "Pages tagged with …") have headings and a dot by the order in use.
- The phone's "Add a note" pop-up is a compact card: the words, one row of tool buttons ([[ ]], #, to-do, new line, paste) and a round Add.
- Dots and the lines that show a note's level are softer in every look, and the dots are 6px, Logseq's size.

### Fixed
- A button that opened a menu, the calendar or the "/" list closes it when pressed again (the phone's calendar button too), and pressing outside a pop-up only closes it.
- Choosing from the "/" list with a finger no longer also adds an empty note.

### Under the hood
- Typing on long pages is faster, and the app loads less when it starts.

## Build 38 · version 0.4.6 (November 2026)

### New
- YouTube videos written Logseq's way (`{{video …}}`) show as the video's picture with a play button, and play in place.
- Settings → Look → Animations: turn off the fades and slides.
- "Pages in …" also lists pages named under the page's aliases, and Check this folder lists clashing pairs.
- The date picker's quick buttons sit on one line.

### Fixed
- A menu's own button closes it, and a finger's press outside a menu no longer also taps what's under it.
- The phone's search box keeps its size when the keyboard comes up.
- Pages without cards end with no line, with room under the "+".

## Build 37 · version 0.4.5 (November 2026)

### New
- Tabs: the "+" for a new tab always shows on the laptop, at the page's top-left corner just right of the sidebar, and moves along after the last tab. A note's menu (right-click its dot) has Open in a new tab and Open to the side.
- Filter buttons (To-dos and Linked references) work like a shop's filters: a click shows only the notes mentioning that page and a second click lets it go; right-click (or press and hold on a phone) hides them instead. Chosen buttons come first with a small ×, at most two rows show (then "N more"), and typing in the filter narrows the buttons too.
- To-dos: the order (Newest, Oldest, By date) sits on the right with a ⇅ mark; the page buttons are behind a filter button, with a box to find a page. Closing it lets every pick go; open or closed is remembered.
- "Pages in …" on a namespace's page sorts like Linked references (last changed, name or date created, either way), each level of the tree on its own. "Pages tagged with …" folds, filters and sorts too, and long names end in "…" on a phone.
- Property display (Settings → Look): for any property, show it as usual, quiet (smaller and lighter), as a small icon (its words on hover) or hidden, and optionally mark its notes with a thin coloured line. Saved in the notes folder (`logseq/thinky.json`), so the laptop and phone agree. Properties in Logseq's `:block-hidden-properties` are hidden too.
- Backups (Settings → Notes, laptop): optional, off unless you turn them on. A dated zip of the notes folder in a folder you choose (keeping the last few), or a copy into a git repository such as GitHub. Made once a day or once a week, only when something changed, with a warning if many files vanished. Check this folder offers to put a missing picture back from the backups.
- Android: "Add to thinky" in the menu over selected text in other apps adds the words to where your quick captures go (today's journal), with no window, as plain words.
- The Tags list counts a tag and its page's aliases as one tag.

### Fixed
- Check this folder no longer lists pictures and files as missing when their names have brackets, an apostrophe or a `#` in them.

### Under the hood
- Every browser test now runs on GitHub before a build is signed.

## Build 36 · version 0.4.4 (November 2026)

### New
- All pages → Namespaces: each namespace folds and unfolds with an arrow (folded at first, and remembered), the parent page in bold with how many pages are under it. A namespace shows only when it has two or more pages under it.
- Ctrl+R and F5 (Ctrl+Shift+R too) show the notes as their files are now, keeping your place, instead of reloading the whole window. On a phone, pull the page down from its top. Typing that's still saving is saved first.
- To-dos count the links of the notes they sit under: write `[[page]]` once on a parent note, put the to-dos under it, and that page's button on To-dos finds them (each shows "under page").
- The note menu (a dot's right-click, or press and hold): Show hidden properties lists a note's `id::`, `collapsed::` and the like, with Copy.
- Properties: a property's page has Rename or merge…, which renames it in every note (`authors::` → `author::`). A note that has both keeps one line with both values.
- Settings → Notes → Check this folder also lists notes that link to a picture missing from `assets`, such as one added on another device that never synced.

## Build 35 · version 0.4.3 (November 2026)

### New
- The browser extension, thinky highlights, can now come from the Edge Add-ons store or the Chrome Web Store, besides being loaded by hand: thinky answers all three. Settings → Capture → "Highlights from your browser" (it was "Highlights from Edge") has a button for each store, and where to change its keys in Edge and in Chrome.
- The downloads are named thinky: `thinky-setup.exe`, `thinky-portable.exe` and `thinky.apk`. Each release also has them under the old Lean Outliner names, so older builds still find their updates.

### Under the hood
- Newer GitHub Actions for the builds (Node 24).

## Build 34 · version 0.4.2 (October 31, 2026)

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

## Milestone 5 — Builds 32 and 33 · versions 0.4.0–0.4.1 (October 29 and 30, 2026)

- The app is now called **thinky**, with its own logo, and a new look of the same name.
- Highlights from Edge: highlight passages while reading and send them to one page per article.
- Neat web links in quick captures.
- Safety copies kept in the notes folder (so a synced folder keeps them too); an alias counts as its page.
- A welcome screen that can start a new notes folder with a short tour.
- Quieter phone menus and bars.
- Edit linked references right where they are; `#tags` counted in Tags; simpler to-do filters; a sort menu for references.
- A faint "+" after the last note, and a calm start-up.
- Send feedback (Settings › About) opens a new issue on GitHub, with nothing personal added.

## Milestone 4 — Builds 27 to 31 · versions 0.2.4–0.3.2 (October 27, 2026)

- Tabs, and two pages side by side on the laptop.
- Roomier journal days, Go to date, Undo across days.
- Linked references show the notes under them, as in Logseq.
- History for every page: its earlier versions, and one tap to put one back.
- A menu on each note's dot, and moving notes by dragging them, even to other pages; files dropped from Explorer.
- A shortcut key that opens the Add to journal box at once.
- The Logseq feel: Plain looks like Logseq, smarter search with recent searches, a command list (Ctrl+Shift+P), block references, typing pairs, formatted paste, Copy page as text, a sliding sidebar, drag handles, wide mode and folding.
- All pages as a table, renaming by the title, merging pages, `leanoutliner://` links to pages and notes.
- The Inter font bundled for the Plain looks.

## Milestone 3 — Builds 23 to 26 · versions 0.2.0–0.2.3 (October 26, 2026)

- Reading and writing: coloured note boxes and quotes, page icons, easier links, find and replace, press and hold to preview a link, pinned parent notes, swipes on the phone.
- The clash screen: when a page changed here and elsewhere, both versions side by side with a suggested pick, and nothing is ever lost.
- Safety copies of recently changed notes, and a bin for pictures nothing uses.
- Pictures you can resize, as in Logseq.
- An "Add note" tile in Android's Quick Settings and shortcuts on the app icon.
- A native "Add to journal" box on Windows that opens at once.
- One-click updates from Settings › About, checked against a signing key.

## Milestone 2 — Builds 13 to 22 · versions 0.1.12–0.1.21 (October 26, 2026)

- To-dos with dates and repeats, a calendar, templates, unlinked references, rename and delete with a bin.
- Quick capture from the laptop (a link, a box and a shortcut key) and from the phone.
- Safer syncing: edits made elsewhere are merged, unreadable files are never overwritten.
- The app's own title bar with back and forward, Logseq-style thread lines, link colours and fonts.
- Phone fixes: cleaner lines, the toolbar, file access, widgets, the Back button.
- Journals show each day's linked and unlinked references and a "Scheduled & deadline" box.
- A Home button, Settings in tabs, and a new look, Plain night.
- The Windows "Add to journal" box, launcher-style.

## Milestone 1 — Builds 1 to 8 · versions 0.1.0–0.1.7 (October 25, 2026)

The first version.
- A Rust core that reads and writes Logseq-style Markdown notes, keeping every untouched line byte for byte.
- An outline editor in plain HTML, CSS and JavaScript, wrapped as a Windows and an Android app with Tauri.
- Journals, `[[links]]`, `#tags`, `key:: value` properties, backlinks and search.
- Android: a home-screen widget with today's journal, a quick-capture pop-up, and sharing into the journal.
- Nine looks with live previews.
- Obsidian-style YAML headers read as page properties; emoji and curly quotes in page names; duplicate page names handled safely.
