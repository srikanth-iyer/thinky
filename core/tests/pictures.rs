//! "Check this folder": pictures nothing uses, and moving them to the bin (core/src/app/pictures.rs).
//! Pictures changed in the last 3 days are left alone, so most tests look as from 4 days later
//! (`later()`): the pictures they make are new.
use outline_core::app::{check_vault, dispatch, App};
use serde_json::json;
use std::path::{Path, PathBuf};

fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs()
}

/// Four days from now: every picture made by a test is older than 3 days then.
fn later() -> u64 {
    now() + 4 * 86_400
}

fn tmp_vault(tag: &str) -> PathBuf {
    let base = std::env::temp_dir().join(format!("outline_pics_{tag}_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&base);
    for d in ["pages", "journals", "logseq", "assets"] {
        std::fs::create_dir_all(base.join(d)).unwrap();
    }
    base
}

fn put(root: &Path, rel: &str, bytes: &[u8]) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, bytes).unwrap();
}

/// A picture of `n` bytes (the content doesn't matter here).
fn pic(root: &Path, rel: &str, n: usize) {
    put(root, rel, &vec![7u8; n]);
}

const HL: &str = "6528aaaa-bbbb-4ccc-8ddd-eeeeffff6666";

/// Every way a note, whiteboard or setting can point at a picture, plus pictures nothing uses.
fn sample(root: &Path) {
    put(
        root,
        "pages/Shapes.md",
        b"cover:: cover.jpg\n\n- relative ![a](../assets/rel.png){:width 300}\n- written plainly: assets/plain.png\n- encoded ![b](../assets/My%20pic.png)\n- obsidian embed ![[embed.png]]\n- html <img src=\"../assets/html.webp\" width=\"200\">\n- a percent sign ![](../assets/100%25.png) and accents ![](../assets/%C3%A9t%C3%A9.png)\n",
    );
    put(root, "pages/hls__paper.md", format!("file:: [paper.pdf](../assets/paper.pdf)\n\n- [:span]\n  ls-type:: annotation\n  hl-page:: 3\n  hl-type:: area\n  id:: {HL}\n  hl-stamp:: 1698765432100\n").as_bytes());
    put(root, "journals/2026_10_20.md", b"- a deep one ![](../assets/sub/deep.gif)\n");
    put(root, "pages/Latin.md", b"- caf\xe9 ![](../assets/latin.png)\n"); // not UTF-8: still read
    put(root, "whiteboards/board.edn", b"{:blocks [] :pages [{:block/name \"board\"}] :assets [{:id \"a1\" :src \"../assets/wb.svg\"}]}\n");
    put(root, "logseq/custom.css", b"body { background: url(\"../assets/style.avif\"); }\n");
    put(root, "logseq/config.edn", b"{:meta/version 1\n :custom-icon \"../assets/conf.ico\"}\n");
    put(root, "Notes/Obsidian note.md", b"An Obsidian note outside pages: ![[obs.bmp]]\n");
    put(root, "logseq/.recycle/pages_Old.md", b"- a deleted page can come back: ![](../assets/binned.tiff)\n");
    put(root, "logseq/bak/pages/Shapes/2026-01-01_00_00_00.md", b"- an old copy: ![](../assets/onlybak.png)\n");
    put(root, "assets/notes.html", b"<p><img src=\"inhtml.jpeg\"></p>\n");
    for (rel, n) in [
        ("assets/rel.png", 10),
        ("assets/plain.png", 11),
        ("assets/My pic.png", 12),
        ("assets/Embed.PNG", 13),
        ("assets/cover.jpg", 14),
        ("assets/html.webp", 15),
        ("assets/100%.png", 16),
        ("assets/été.png", 17),
        ("assets/sub/deep.gif", 18),
        ("assets/latin.png", 19),
        ("assets/wb.svg", 20),
        ("assets/style.avif", 21),
        ("assets/conf.ico", 22),
        ("assets/obs.bmp", 23),
        ("assets/binned.tiff", 24),
        ("assets/inhtml.jpeg", 25),
        (&format!("assets/paper/3_{HL}_1698765432100.png"), 26),
        ("assets/paper/5_11111111-2222-4333-8444-555555555555_1698765432100.png", 1000),
        ("assets/unused.png", 2000),
        ("assets/sub/Unused2.HEIC", 3000),
        ("assets/onlybak.png", 4000),
    ] {
        pic(root, rel, n);
    }
    pic(root, "assets/paper.pdf", 5000); // not a picture: never listed
    pic(root, "assets/.hidden.png", 6000); // hidden: never listed
}

const UNUSED: [&str; 4] = [
    "assets/onlybak.png",
    "assets/paper/5_11111111-2222-4333-8444-555555555555_1698765432100.png",
    "assets/sub/Unused2.HEIC",
    "assets/unused.png",
];

#[test]
fn every_reference_shape_counts_as_used() {
    let v = tmp_vault("shapes");
    sample(&v);
    let r = App::open(&v).unwrap().picture_check_at(later());
    let unused: Vec<&str> = r.unused.iter().map(|(p, _)| p.as_str()).collect();
    assert_eq!(unused, UNUSED, "only pictures nothing mentions (backups in logseq/bak don't count)");
    assert_eq!(r.unused.iter().map(|(_, b)| *b).collect::<Vec<_>>(), vec![4000, 1000, 3000, 2000]);
    assert_eq!(r.bytes, 10_000);
    assert_eq!((r.pictures, r.recent), (21, 0), "the PDF and the hidden file aren't pictures to check");
    assert!(r.unreadable.is_empty());
    // today they're all new: none is offered yet (the check report says how many were left out)
    let r = check_vault(&v).unwrap();
    assert_eq!((r.pictures, r.pictures_recent, r.unused_pictures.len()), (21, 21, 0));
    // the check reads; it changes nothing
    assert!(v.join("assets/unused.png").exists() && !v.join("logseq/.recycle/assets_unused.png").exists());
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn each_shape_on_its_own() {
    // one note, one picture: is it used?
    let cases: [(&str, &str, &[u8], bool); 12] = [
        ("assets/x.png", "pages/A.md", b"- ![](../assets/x.png)\n", true),
        ("assets/x.png", "pages/A.md", b"- see assets/x.png\n", true),
        ("assets/My pic.png", "pages/A.md", b"- ![](../assets/My%20pic.png)\n", true),
        ("assets/My pic.png", "pages/A.md", b"- ![](<../assets/My pic.png>)\n", true),
        ("assets/Shot.PNG", "pages/A.md", b"- ![[shot.png]]\n", true),
        ("assets/c.jpg", "pages/A.md", b"cover:: c.jpg\n\n- text\n", true),
        ("assets/h.webp", "pages/A.md", b"- <img src=\"../assets/h.webp\">\n", true),
        ("assets/w.png", "whiteboards/w.edn", b"{:assets [{:src \"../assets/w.png\"}]}\n", true),
        ("assets/s.png", "logseq/custom.css", b".x { background: url(../assets/s.png) }\n", true),
        ("assets/x.png", "pages/A.md", b"- nothing here\n", false),
        ("assets/x.png", "pages/A.md", b"- ![](../assets/x.jpeg) is another picture\n", false),
        ("assets/x.pdf", "pages/A.md", b"- nothing here\n", false), // not a picture: not listed either
    ];
    for (i, (picture, note, text, used)) in cases.into_iter().enumerate() {
        let v = tmp_vault(&format!("one{i}"));
        pic(&v, picture, 5);
        put(&v, note, text);
        let r = App::open(&v).unwrap().picture_check_at(later());
        let listed = r.unused.iter().any(|(p, _)| p == picture);
        let picture_type = !picture.ends_with(".pdf");
        assert_eq!(listed, picture_type && !used, "case {i}: {picture} with {}", String::from_utf8_lossy(text));
        assert_eq!(r.pictures, usize::from(picture_type), "case {i}");
        let _ = std::fs::remove_dir_all(&v);
    }
}

#[test]
fn moving_takes_only_unused_pictures_in_assets() {
    let v = tmp_vault("bin");
    sample(&v);
    put(&v, "logseq/.recycle/assets%2Funused.png", b"an older one"); // the bin already has that name
    put(&v, "secret.png", b"outside assets");
    let app = App::open(&v).unwrap();
    let ask: Vec<String> = [
        "assets/unused.png",
        "assets/sub/Unused2.HEIC",
        "assets/unused.png", // twice: moved once
        "assets/rel.png",    // used
        "assets/paper.pdf",  // not a picture
        "pages/Shapes.md",
        "secret.png",
        "../secret.png",
        "assets/../secret.png",
        "assets/./unused.png",
        "/etc/passwd",
        "assets\\onlybak.png",
        "C:/assets/x.png",
        "assets/.hidden.png",
        "assets/missing.png",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    let r = app.bin_pictures_at(&ask, later()).unwrap();
    assert_eq!(r.moved, vec!["assets/unused.png", "assets/sub/Unused2.HEIC"]);
    let why = |p: &str| r.skipped.iter().find(|(x, _)| x == p).map(|(_, w)| w.as_str()).unwrap_or("");
    assert_eq!(why("assets/rel.png"), "a note uses it now");
    assert_eq!(why("assets/missing.png"), "it isn’t there any more");
    for p in ["assets/paper.pdf", "pages/Shapes.md", "secret.png", "../secret.png", "assets/../secret.png", "assets/./unused.png", "/etc/passwd", "assets\\onlybak.png", "C:/assets/x.png", "assets/.hidden.png"] {
        assert_eq!(why(p), "it isn’t a picture in assets", "{p}");
    }
    assert_eq!(r.skipped.len(), 12);
    // moved into the bin, nothing deleted, nothing else touched
    assert!(!v.join("assets/unused.png").exists() && !v.join("assets/sub/Unused2.HEIC").exists());
    // named by where each came from ("%~2": the bin had that name already)
    assert_eq!(std::fs::read(v.join("logseq/.recycle/assets%2Funused%~2.png")).unwrap().len(), 2000);
    assert_eq!(std::fs::read(v.join("logseq/.recycle/assets%2Funused.png")).unwrap(), b"an older one");
    assert_eq!(std::fs::read(v.join("logseq/.recycle/assets%2Fsub%2FUnused2.HEIC")).unwrap().len(), 3000);
    // their file time is when they were moved (the bin lists them newest first), not the picture's own
    let moved_at = std::fs::metadata(v.join("logseq/.recycle/assets%2Funused%~2.png")).unwrap().modified().unwrap();
    assert!(moved_at.elapsed().map_or(true, |d| d.as_secs() < 60), "{moved_at:?}");
    for p in ["assets/rel.png", "assets/paper.pdf", "pages/Shapes.md", "secret.png", "assets/onlybak.png", "assets/.hidden.png"] {
        assert!(v.join(p).exists(), "{p} stays");
    }
    // the bin lists the pages and the pictures (each with where it goes back to)
    let mut bin: Vec<(String, String, Option<String>)> = app.recycled().into_iter().map(|r| (r.file, r.name, r.picture)).collect();
    bin.sort();
    let row = |f: &str, n: &str, p: Option<&str>| (f.to_string(), n.to_string(), p.map(String::from));
    assert_eq!(bin, vec![
        row("assets%2Fsub%2FUnused2.HEIC", "Unused2.HEIC", Some("assets/sub/Unused2.HEIC")),
        row("assets%2Funused%~2.png", "unused.png", Some("assets/unused.png")),
        row("assets%2Funused.png", "unused.png", Some("assets/unused.png")),
        row("pages_Old.md", "Old", None),
    ]);
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn checked_again_right_before_moving() {
    let v = tmp_vault("recheck");
    sample(&v);
    let mut app = App::open(&v).unwrap();
    let listed: Vec<String> = app.picture_check_at(later()).unused.into_iter().map(|(p, _)| p).collect();
    assert_eq!(listed, UNUSED);
    // meanwhile, outside the app (no rescan): a new note uses one, an edited note another (by its id)
    put(&v, "pages/New.md", b"- found a use for ![](../assets/onlybak.png)\n");
    std::fs::write(v.join("pages/Shapes.md"), std::fs::read_to_string(v.join("pages/Shapes.md")).unwrap() + "- ((11111111-2222-4333-8444-555555555555))\n").unwrap();
    let r = serde_json::to_value(app.bin_pictures_at(&listed, later()).unwrap()).unwrap();
    assert_eq!(r["moved"], json!(["assets/sub/Unused2.HEIC", "assets/unused.png"]));
    assert_eq!(
        r["skipped"],
        json!([
            ["assets/onlybak.png", "a note uses it now"],
            ["assets/paper/5_11111111-2222-4333-8444-555555555555_1698765432100.png", "a note uses it now"]
        ])
    );
    assert!(v.join("assets/onlybak.png").exists());
    // a picture the app itself just linked (saved, not yet anywhere else) is used too
    pic(&v, "assets/fresh.png", 3);
    app.append_to("pages/Shapes.md", "![](../assets/fresh.png)").unwrap();
    let r = app.bin_pictures_at(&["assets/fresh.png".to_string()], later()).unwrap();
    assert!(r.moved.is_empty() && r.skipped[0].1 == "a note uses it now");
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn bench_sized_folder_is_quick() {
    // 1,500 notes and 1,200 pictures, half of them used: well under a second (in a release build
    // it is a few tens of ms; see examples/bench.rs)
    let v = tmp_vault("speed");
    for i in 0..1500 {
        let mut s = String::new();
        for j in 0..20 {
            s.push_str(&format!("- note {j} about [[Page {}]] with some words. And a sentence. Another one.\n", (i + j) % 900));
        }
        if i % 3 == 0 {
            s.push_str(&format!("- ![](../assets/image_{}.png) and ![[photo {}.jpg]]\n", i / 3, i / 3));
        }
        put(&v, &format!("pages/Page {i}.md"), s.as_bytes());
    }
    for i in 0..600 {
        pic(&v, &format!("assets/image_{i}.png"), 1);
        pic(&v, &format!("assets/photo {i}.jpg"), 1);
    }
    let app = App::open(&v).unwrap();
    let t = std::time::Instant::now();
    let r = app.picture_check_at(later());
    let took = t.elapsed();
    assert_eq!(r.pictures, 1200);
    assert_eq!(r.unused.len(), 1200 - 2 * 500);
    assert!(took.as_secs_f64() < 3.0, "took {took:?} (debug build)");
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn pictures_from_the_last_3_days_are_left_alone() {
    // the phone's pop-up saves a picture first, then the note using it; Drive syncs them one by one
    let v = tmp_vault("recent");
    put(&v, "pages/A.md", b"- nothing uses the pictures yet\n");
    pic(&v, "assets/just arrived.png", 10);
    pic(&v, "assets/older.png", 20);
    // a copy or a sync app can give a picture that just arrived an old change time: when the system
    // knows when the file was made here, that counts too
    let t = std::time::SystemTime::now() - std::time::Duration::from_secs(5 * 86_400);
    std::fs::File::options().write(true).open(v.join("assets/older.png")).unwrap().set_modified(t).unwrap();
    let made_here_known = std::fs::metadata(v.join("assets/older.png")).unwrap().created().is_ok();
    let mut state = Some(App::open(&v).unwrap());
    let r = dispatch(&mut state, "check", json!({})).unwrap();
    assert_eq!((r["pictures"].as_u64(), r["pictures_recent"].as_u64()), (Some(2), Some(if made_here_known { 2 } else { 1 })));
    if !made_here_known {
        assert_eq!(r["unused_pictures"], json!([["assets/older.png", 20]]));
    }
    // moving refuses it too (checked again right before), whatever the list said
    let r = dispatch(&mut state, "bin_pictures", json!({ "paths": ["assets/just arrived.png"] })).unwrap();
    assert_eq!(r["moved"], json!([]));
    assert_eq!(r["skipped"], json!([["assets/just arrived.png", "it’s from the last 3 days (a note using it may still be on its way)"]]));
    assert!(v.join("assets/just arrived.png").exists());
    // three days later it can go
    let app = state.as_ref().unwrap();
    assert_eq!(app.picture_check_at(later()).unused.len(), 2);
    assert_eq!(app.bin_pictures_at(&["assets/just arrived.png".to_string()], later()).unwrap().moved, vec!["assets/just arrived.png"]);
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn a_picture_in_the_bin_can_be_put_back() {
    let v = tmp_vault("putback");
    put(&v, "pages/A.md", b"- no pictures used\n");
    // names that look like the bin's own marks, or like a folder's name: they come back exactly
    let pics = [
        "assets/Screenshot (2).png", // Windows names screenshots like this
        "assets/photo_2024.png",     // a folder "assets/photo" exists
        "assets/paper_notes.png",    // a folder "assets/paper" exists (PDF highlights)
        "assets/sub/deep.png",
        "assets/gone/x.png", // its folder goes away meanwhile
        "assets/100%.png",
        "assets/a%~3.png",
        "assets/twice.png",
    ];
    for (i, p) in pics.iter().enumerate() {
        pic(&v, p, 10 + i);
    }
    std::fs::create_dir_all(v.join("assets/photo")).unwrap();
    std::fs::create_dir_all(v.join("assets/paper")).unwrap();
    let app = App::open(&v).unwrap();
    let all: Vec<String> = pics.iter().map(|s| s.to_string()).collect();
    assert_eq!(app.bin_pictures_at(&all, later()).unwrap().moved.len(), pics.len());
    pic(&v, "assets/twice.png", 99); // another picture of that name, binned too
    assert_eq!(app.bin_pictures_at(&["assets/twice.png".to_string()], later()).unwrap().moved.len(), 1);
    std::fs::remove_dir(v.join("assets/gone")).unwrap();
    // the bin lists each picture under its own name, with where it goes back to
    let listed: Vec<(String, Option<String>)> = app.recycled().into_iter().map(|r| (r.name, r.picture)).collect();
    for p in pics {
        assert!(listed.iter().any(|(n, h)| h.as_deref() == Some(p) && p.ends_with(n.as_str())), "{p}: {listed:?}");
    }
    let mut st = Some(app);
    let files: Vec<String> = std::fs::read_dir(v.join("logseq/.recycle")).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
    let mut back = vec![];
    for f in &files {
        if f == "assets%2Ftwice%~2.png" {
            continue; // the second "twice.png": below
        }
        let r = dispatch(&mut st, "restore", json!({ "file": f })).unwrap_or_else(|e| panic!("{f}: {e}"));
        back.push(r.as_str().unwrap().to_string());
    }
    // each says where it went (for "Put “deep.png” back in assets/sub.")
    back.sort();
    let mut want: Vec<String> = pics.iter().map(|p| p.to_string()).collect();
    want.sort();
    assert_eq!(back, want);
    for (i, p) in pics.iter().enumerate() {
        assert_eq!(std::fs::read(v.join(p)).map(|b| b.len()).ok(), Some(10 + i), "{p} is back, exactly there");
    }
    assert_eq!(std::fs::read(v.join("assets/twice.png")).unwrap().len(), 17);
    // never over a picture that's there: it says so, and both stay as they are
    let e = dispatch(&mut st, "restore", json!({ "file": "assets%2Ftwice%~2.png" })).unwrap_err();
    assert!(e.contains("already a picture called “twice.png” in assets"), "{e}");
    assert_eq!(std::fs::read(v.join("logseq/.recycle/assets%2Ftwice%~2.png")).unwrap().len(), 99);
    // only pictures from assets, by their name in the bin
    for bad in ["..%2Fx.png", "assets%2F..%2Fx.png", "assets%2F.hidden.png", "photo.png", "assets_old.png", "assets%2Fx.pdf", "assets%2Fx%~.png", "assets%3Ax.png", "pages_Old.md"] {
        assert!(dispatch(&mut st, "restore", json!({ "file": bad })).is_err(), "{bad}");
    }
    let _ = std::fs::remove_dir_all(&v);
}
