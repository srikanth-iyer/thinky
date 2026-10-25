//! Synthetic vault benchmark: `cargo run --release --example bench [dir]`.
//! With no dir, generates 5,000 pages + 730 journals in a temp folder.
use outline_core::Vault;
use std::time::Instant;

fn main() {
    let root = match std::env::args().nth(1) {
        Some(d) => std::path::PathBuf::from(d),
        None => {
            let root = std::env::temp_dir().join("outline_bench");
            let _ = std::fs::remove_dir_all(&root);
            std::fs::create_dir_all(root.join("pages")).unwrap();
            std::fs::create_dir_all(root.join("journals")).unwrap();
            for i in 0..5000 {
                let mut s = format!("tags:: topic{}, area{}\nstatus:: s{}\n\n", i % 50, i % 7, i % 3);
                for j in 0..20 {
                    s.push_str(&format!("- note {j} about [[Page {}]] and #tag{} with some more words here\n\t- child line\n", (i * 7 + j) % 5000, j % 30));
                }
                std::fs::write(root.join("pages").join(format!("Page {i}.md")), s).unwrap();
            }
            for d in 0..730 {
                let (y, m, day) = (2025 + d / 365, 1 + (d % 365) / 31 % 12, 1 + d % 28);
                let mut s = String::new();
                for j in 0..10 {
                    s.push_str(&format!("- journal entry {j} [[Page {}]]\n", (d * 13 + j) % 5000));
                }
                std::fs::write(root.join("journals").join(format!("{y}_{m:02}_{day:02}.md")), s).unwrap();
            }
            root
        }
    };
    let t = Instant::now();
    let mut v = Vault::new();
    let n = v.load_dir(&root).unwrap();
    println!("loaded {n} files in {:?}", t.elapsed());
    let t = Instant::now();
    let g = v.linked_refs("Page 42");
    println!("linked refs for 'Page 42': {} pages in {:?}", g.len(), t.elapsed());
    let t = Instant::now();
    let s = v.search("words", 50);
    println!("search: {} hits in {:?}", s.len(), t.elapsed());
    let t = Instant::now();
    v.upsert("pages/Page 1.md", "- edited [[Page 42]]\n");
    println!("re-index one file after save: {:?}", t.elapsed());
}
