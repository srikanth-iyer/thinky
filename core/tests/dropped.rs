//! Files dropped on the app's window from Explorer (app::save_dropped_file, ui/filedrop.js): copied
//! into assets/ under Logseq's name and linked; a file already in assets/ linked where it is; folders,
//! empty and too big files refused.
use outline_core::app::save_dropped_file;
use std::path::PathBuf;

fn tmp(tag: &str) -> PathBuf {
    let base = std::env::temp_dir().join(format!("outline_drop_{tag}_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&base);
    std::fs::create_dir_all(base.join("vault/pages")).unwrap();
    std::fs::create_dir_all(base.join("desktop")).unwrap();
    base
}

fn assets(v: &std::path::Path) -> Vec<String> {
    let mut n: Vec<String> = std::fs::read_dir(v.join("assets")).map(|d| d.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect()).unwrap_or_default();
    n.sort();
    n
}

#[test]
fn dropped_files_are_copied_into_assets_and_linked() {
    let b = tmp("copy");
    let v = b.join("vault");
    let pic = b.join("desktop/Holiday photo (1).PNG");
    std::fs::write(&pic, b"png bytes").unwrap();
    let (rel, md) = save_dropped_file(&v, &pic).unwrap();
    let file = rel.strip_prefix("../assets/").unwrap();
    assert!(file.starts_with("Holiday_photo__1_") && file.ends_with(".png"), "{rel}");
    assert_eq!(md, format!("![Holiday photo (1)]({rel})"));
    assert_eq!(std::fs::read(v.join("assets").join(file)).unwrap(), b"png bytes");
    assert!(pic.exists(), "the dropped file itself stays where it was");

    let pdf = b.join("desktop/Quarterly report.pdf");
    std::fs::write(&pdf, b"%PDF").unwrap();
    let (rel2, md2) = save_dropped_file(&v, &pdf).unwrap();
    assert_eq!(md2, format!("[Quarterly report.pdf]({rel2})"));
    // the same file twice: two copies, never one over the other
    let (rel3, _) = save_dropped_file(&v, &pdf).unwrap();
    assert_ne!(rel2, rel3);
    assert_eq!(assets(&v).len(), 3);
}

#[test]
fn a_file_in_assets_already_is_linked_where_it_is() {
    let b = tmp("inside");
    let v = b.join("vault");
    std::fs::create_dir_all(v.join("assets/sub")).unwrap();
    std::fs::write(v.join("assets/dot_1700000000000.png"), b"x").unwrap();
    std::fs::write(v.join("assets/sub/my scan (2).jpg"), b"y").unwrap();
    assert_eq!(save_dropped_file(&v, &v.join("assets/dot_1700000000000.png")).unwrap(), ("../assets/dot_1700000000000.png".into(), "![dot_1700000000000](../assets/dot_1700000000000.png)".into()));
    let (rel, md) = save_dropped_file(&v, &v.join("assets/sub/my scan (2).jpg")).unwrap();
    assert_eq!(rel, "../assets/sub/my%20scan%20%282%29.jpg");
    assert_eq!(md, "![my scan (2)](../assets/sub/my%20scan%20%282%29.jpg)");
    assert_eq!(assets(&v), vec!["dot_1700000000000.png", "sub"], "no copies made");
}

#[test]
fn folders_empty_and_big_files_are_refused() {
    let b = tmp("refuse");
    let v = b.join("vault");
    assert!(save_dropped_file(&v, &b.join("desktop")).unwrap_err().contains("folder"));
    let e = b.join("desktop/empty.txt");
    std::fs::write(&e, b"").unwrap();
    assert!(save_dropped_file(&v, &e).unwrap_err().contains("empty"));
    let big = b.join("desktop/film.mp4");
    std::fs::File::create(&big).unwrap().set_len(25_000_001).unwrap(); // (sparse: refused before it's read)
    assert!(save_dropped_file(&v, &big).unwrap_err().contains("25 MB"));
    assert!(save_dropped_file(&v, &b.join("desktop/gone.png")).is_err());
    assert!(assets(&v).is_empty(), "nothing copied");
}
