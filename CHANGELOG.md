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
From Build 41 these versions are the app's own: they show in Settings → Updates & about and in each release's
title on GitHub, and updates compare them, so a release is newer when its version is higher, whichever part
went up. Build 40 and older still update to it (each release keeps a signature file made their way).

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
