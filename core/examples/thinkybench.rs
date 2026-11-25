// thinkybench: times how long thinky takes to open a big made-up notes folder.
// It is used by scripts/bench_big_folders.ps1 and works with both the old and the new version of the core,
// because it only calls things both versions have. It never touches your real notes.
//
// Use: thinkybench <test folder> <cache folder> <pages> <journal days>
// It prints one line starting with RESULT that the script reads.

use outline_core::app::{set_cache_dir, App}; // the app's core: opening a folder, its cache folder
use std::path::Path; // a file or folder path
use std::time::Instant; // a stopwatch

/// A tiny random-number maker that always gives the same numbers, so both versions get the same notes.
struct Rng(u64);
impl Rng {
    // the next number in the sequence
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407); // mix the number
        self.0 >> 33 // keep the better-mixed top bits
    }
    // a number from 0 up to (but not including) n
    fn pick(&mut self, n: usize) -> usize {
        (self.next() as usize) % n
    }
}

// the words the made-up notes are written with
const WORDS: &[&str] = &["canal", "noise", "robust", "rule", "walker", "signal", "outline", "garden", "river", "lamp", "paper", "model", "draft", "seminar", "coffee", "budget", "laptop", "visa", "train", "journal", "network", "agent", "schelling", "density", "fitness", "search", "memory", "quiet", "window", "phone"];

/// Makes the test folder once (pages, journal days and a settings file). A "done" file marks it finished.
fn make(root: &Path, pages: usize, days: usize) {
    if root.join("done").exists() {
        return; // already made by an earlier run: both versions use the very same files
    }
    let _ = std::fs::remove_dir_all(root); // a half-made folder from a stopped run: start again
    for d in ["pages", "journals", "logseq"] {
        std::fs::create_dir_all(root.join(d)).unwrap(); // the three folders thinky expects
    }
    // the journal file names thinky's settings use
    std::fs::write(root.join("logseq/config.edn"), "{:journal/file-name-format \"yyyy_MM_dd\"}\n").unwrap();
    let mut r = Rng(42); // always the same start, so always the same notes
    // one note line: 6 to 15 words, sometimes a link to another page, a hub page or a tag
    let line = |r: &mut Rng| -> String {
        let mut s = String::new(); // the line being built
        for _ in 0..(6 + r.pick(10)) {
            s.push_str(WORDS[r.pick(WORDS.len())]); // a word
            s.push(' '); // and a space
        }
        let k = r.pick(10); // what kind of extra this line gets
        if k < 3 {
            s.push_str(&format!("[[Page {}]] ", r.pick(pages))); // a link to a random page
        }
        if k == 3 {
            s.push_str("[[Hub]] "); // a link to the one page many link to
        }
        if k == 4 {
            s.push_str("#project "); // a tag
        }
        s
    };
    for i in 0..pages {
        let mut t = String::new(); // the page's text
        for b in 0..(5 + r.pick(20)) {
            let ind = if b > 0 && r.pick(3) == 0 { "\t" } else { "" }; // sometimes indented under the line above
            t.push_str(&format!("{ind}- {}\n", line(&mut r))); // one note
        }
        std::fs::write(root.join(format!("pages/Page {i}.md")), t).unwrap(); // save the page
    }
    std::fs::write(root.join("pages/Hub.md"), "- the hub page\n").unwrap(); // the hub page itself
    let mut d: (i32, u32, u32) = (2018, 1, 1); // the first journal day
    for _ in 0..days {
        let mut t = String::new(); // the day's text
        for _ in 0..(3 + r.pick(12)) {
            t.push_str(&format!("- {}\n", line(&mut r))); // one note
        }
        std::fs::write(root.join(format!("journals/{:04}_{:02}_{:02}.md", d.0, d.1, d.2)), t).unwrap(); // save the day
        d = outline_core::date::add_days(d, 1); // the next day
    }
    std::fs::write(root.join("done"), "").unwrap(); // mark the folder as finished
}

/// Milliseconds since a stopwatch was started.
fn ms(s: Instant) -> f64 {
    s.elapsed().as_secs_f64() * 1000.0
}

/// The middle value of a list of times (less thrown off by one slow run than the average).
fn median(mut v: Vec<f64>) -> f64 {
    v.sort_by(|a, b| a.partial_cmp(b).unwrap()); // smallest first
    v[v.len() / 2] // the one in the middle
}

/// Reads the page list the new version keeps for quick capture (pages-*.json in the cache folder).
/// Returns how long that took and how many names it had, or None for the old version (no such file).
fn saved_list(cache: &Path) -> Option<(f64, usize)> {
    let s = Instant::now(); // start the stopwatch
    for e in std::fs::read_dir(cache).ok()?.flatten() {
        if e.file_name().to_string_lossy().starts_with("pages-") {
            let bytes = std::fs::read(e.path()).ok()?; // read the file
            let v: serde_json::Value = serde_json::from_slice(&bytes).ok()?; // turn it into data
            let n = v["pages"].as_array().map(|a| a.len()).unwrap_or(0); // count the page names
            return Some((ms(s), n));
        }
    }
    None // no such file: the old version
}

fn main() {
    let a: Vec<String> = std::env::args().collect(); // what the script passed in
    let root = Path::new(&a[1]); // the test notes folder
    let cache = Path::new(&a[2]); // the app's cache folder for this test
    let pages: usize = a[3].parse().unwrap(); // how many pages to make
    let days: usize = a[4].parse().unwrap(); // how many journal days to make
    make(root, pages, days); // make the folder if it isn't there yet
    let _ = std::fs::remove_dir_all(cache); // start with no cache, like a first start
    std::fs::create_dir_all(cache).unwrap();
    set_cache_dir(cache.to_path_buf()); // the app keeps its cache here, not in your real app folder

    let s = Instant::now();
    let app = App::open(root).unwrap(); // the very first start: no cache yet
    let first = ms(s);
    drop(app); // close it (this writes the cache the usual start uses)

    let mut usual = vec![]; // the usual start, with the cache from last time
    for _ in 0..5 {
        let s = Instant::now();
        let app = App::open(root).unwrap();
        usual.push(ms(s));
        drop(app);
    }

    let mut read = vec![]; // quick capture: reading the whole folder just to read it
    let mut close = vec![]; // and putting it away again
    for _ in 0..5 {
        let s = Instant::now();
        let app = App::open_read_only(root).unwrap();
        read.push(ms(s));
        let s = Instant::now();
        drop(app);
        close.push(ms(s));
    }

    // the saved page list (new version only); -1 means there's none
    let (saved, names) = saved_list(cache).unwrap_or((-1.0, 0));
    println!(
        "RESULT first={:.0} usual={:.0} capture={:.0} close={:.0} saved={:.1} names={} cores={}",
        first,
        median(usual),
        median(read),
        median(close),
        saved,
        names,
        std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1)
    );
}
