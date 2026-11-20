//! The optional AI features (ai.rs, Build 51): addresses, the two request formats, reading answers,
//! sending with curl, and Polish note's question and the checks on its answer.
use outline_core::ai::{self, check_base, polish_answer, polish_question, Setup};
use outline_core::app::{set_cache_dir, App};
use serde_json::Value;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

const TODAY: (i32, u32, u32) = (2026, 11, 18);

fn vault(tag: &str) -> PathBuf {
    let v = std::env::temp_dir().join(format!("outline_ai_{tag}_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&v);
    for d in ["pages", "journals", "logseq"] {
        std::fs::create_dir_all(v.join(d)).unwrap();
    }
    std::fs::write(v.join("logseq/config.edn"), "{:journal/page-title-format \"MMM do, yyyy\"}\n").unwrap();
    put(&v, "pages/Diogo Silva.md", "alias:: Diogo\n\n- finance contact\n");
    put(&v, "pages/CBeRa.md", "- the project\n");
    put(&v, "pages/Luis Rocha.md", "- collaborator\n");
    put(&v, "pages/Recipes.md", "- soup\n");
    put(&v, "journals/2026_11_17.md", "- noise sweep plots #dct\n- groceries #errand\n");
    v
}
fn put(v: &Path, rel: &str, text: &str) {
    std::fs::write(v.join(rel), text).unwrap();
}
fn open(v: &Path) -> App {
    set_cache_dir(std::env::temp_dir().join(format!("outline_ai_cache_{}", std::process::id())));
    App::open(v).unwrap()
}
fn setup(provider: &str, model: &str) -> Setup {
    Setup { provider: provider.into(), base: String::new(), model: model.into() }
}

#[test]
fn addresses_https_anywhere_http_only_at_home() {
    assert_eq!(check_base("https://api.anthropic.com/v1/").unwrap(), ("https://api.anthropic.com/v1".to_string(), false));
    assert_eq!(check_base("http://localhost:11434/v1").unwrap().1, true);
    assert!(check_base("http://192.168.1.20:1234/v1").unwrap().1);
    assert!(check_base("http://172.20.0.5/v1").unwrap().1);
    assert!(check_base("http://[::1]:8080/v1").unwrap().1);
    assert!(check_base("http://example.com/v1").is_err(), "http to the internet is refused");
    assert!(check_base("http://172.40.0.5/v1").is_err(), "172.40 isn't a home network");
    assert!(check_base("ftp://x").is_err());
    assert!(check_base("https://a.com/v1\"\nurl = \"https://evil").is_err(), "no quotes or line breaks (the curl settings)");
    assert!(check_base("https://user@evil.com").is_err());
    assert!(check_base("").is_err());
}

#[test]
fn each_format_asks_its_own_way_and_never_carries_the_key() {
    let r = ai::chat_request(&setup("claude", "claude-x"), "rules", "the note", 1024).unwrap();
    assert_eq!(r.url, "https://api.anthropic.com/v1/messages");
    assert_eq!(r.auth.as_deref(), Some("x-api-key"));
    assert!(r.headers.iter().any(|(k, v)| k == "anthropic-version" && v == "2023-06-01"));
    let b: Value = serde_json::from_str(r.body.as_deref().unwrap()).unwrap();
    assert_eq!(b["system"], "rules");
    assert_eq!(b["messages"][0]["content"], "the note");
    assert_eq!(b["max_tokens"], 1024);
    assert!(b.get("temperature").is_none() && b.get("top_p").is_none(), "newer Claude models refuse temperature (Build 52)");

    let r = ai::chat_request(&setup("gemini", "gemini-x"), "rules", "the note", 1024).unwrap();
    assert_eq!(r.url, "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    assert_eq!(r.auth.as_deref(), Some("bearer"));
    let b: Value = serde_json::from_str(r.body.as_deref().unwrap()).unwrap();
    assert_eq!(b["messages"][0]["role"], "system");
    assert_eq!(b["messages"][1]["content"], "the note");
    assert!(b.get("max_tokens").is_none(), "(some newer models refuse it)");

    let r = ai::chat_request(&setup("ollama", "llama3.2"), "rules", "the note", 1024).unwrap();
    assert_eq!(r.url, "http://localhost:11434/v1/chat/completions");
    assert!(r.local && r.auth.is_none(), "a program on this computer: no key");

    let other = Setup { provider: "other".into(), base: "https://ai.example.org/api/".into(), model: "m".into() };
    assert_eq!(ai::chat_request(&other, "a", "b", 9).unwrap().url, "https://ai.example.org/api/chat/completions");
    assert!(ai::chat_request(&setup("claude", ""), "a", "b", 9).is_err(), "no model picked");
    assert!(ai::chat_request(&setup("nobody", "m"), "a", "b", 9).is_err());

    assert_eq!(ai::models_request(&setup("claude", "")).unwrap().url, "https://api.anthropic.com/v1/models?limit=100");
    assert_eq!(ai::models_request(&setup("openrouter", "")).unwrap().url, "https://openrouter.ai/api/v1/models");
}

#[test]
fn answers_and_errors_are_read() {
    let c = setup("claude", "m");
    assert_eq!(ai::read_chat(&c, 200, r#"{"content":[{"type":"text","text":"Hello"},{"type":"text","text":" there"}]}"#).unwrap(), "Hello there");
    let o = setup("openai", "m");
    assert_eq!(ai::read_chat(&o, 200, r#"{"choices":[{"message":{"content":"Tidy"}}]}"#).unwrap(), "Tidy");
    let e = ai::read_chat(&o, 401, r#"{"error":{"message":"bad key"}}"#).unwrap_err();
    assert!(e.contains("refused the key"), "{e}");
    let e = ai::read_chat(&o, 500, r#"{"error":{"message":"overloaded"}}"#).unwrap_err();
    assert!(e.contains("overloaded"), "{e}");
    assert!(ai::read_chat(&o, 200, r#"{"choices":[]}"#).is_err());
    let m = ai::read_models(&o, 200, r#"{"data":[{"id":"b-model"},{"id":"a-model"}]}"#).unwrap();
    assert_eq!(m, vec!["a-model", "b-model"]);
}

#[test]
fn the_question_offers_only_nearby_pages_and_the_tags_in_use() {
    let v = vault("question");
    let app = open(&v);
    let (system, user) = polish_question(&app.vault, "call diogo abt sibera invoice\nid:: 6f0e8b1e-1111-4222-8333-444455556666", TODAY, "British spelling, please");
    assert!(system.contains("Never make up a page name"));
    assert!(system.ends_with("British spelling, please"), "the person's wishes come after the fixed rules");
    assert!(user.contains("Today is Wednesday 2026-11-18"), "{user}");
    assert!(user.contains("[[Nov 18th, 2026]]"), "a day link as this notes folder writes it");
    assert!(user.contains("Diogo Silva (also called: Diogo)"), "{user}");
    assert!(!user.contains("Recipes"), "pages that share no word with the note aren't sent");
    assert!(user.contains("dct") && user.contains("errand"), "the tags in use");
    assert!(!user.contains("id::"), "the note's properties are never sent");
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn an_answer_may_only_link_what_exists() {
    let v = vault("answer");
    let app = open(&v);
    let original = "call diogo abt sibera invoice next tue. also ask luis re plots\nid:: 6f0e8b1e-1111-4222-8333-444455556666\ncollapsed:: true";
    let answer = "- TODO Call [[Diogo Silva]] about the [[CBeRa]] invoice\n  SCHEDULED: <2026-11-24 Tue>\n- TODO Ask [[Luis Rocha]] about the [[Noise plots]] #dct #urgent\n  priority:: high";
    let r = polish_answer(&app.vault, original, answer, true).unwrap();
    let notes: Vec<String> = serde_json::from_value(r["notes"].clone()).unwrap();
    assert_eq!(notes.len(), 2);
    assert_eq!(notes[0], "TODO Call [[Diogo Silva]] about the [[CBeRa]] invoice\nSCHEDULED: <2026-11-24 Tue>\nid:: 6f0e8b1e-1111-4222-8333-444455556666\ncollapsed:: true\nby:: ai");
    assert_eq!(notes[1], "TODO Ask [[Luis Rocha]] about the Noise plots #dct urgent\nby:: ai", "an invented page and tag become plain words; no new properties");
    assert_eq!(r["unlinked"], serde_json::json!(["Noise plots", "urgent"]));
    assert_eq!(r["same"], false);

    // without the mark, in a code block, an alias and a day link are fine
    let r = polish_answer(&app.vault, "see diogo on nov 20", "```\nSee [[Diogo]] on [[Nov 20th, 2026]]\n```", false).unwrap();
    assert_eq!(r["notes"][0], "See [[Diogo]] on [[Nov 20th, 2026]]");
    // a note that already says who wrote it keeps that
    let r = polish_answer(&app.vault, "hi\nby:: claude", "Hi.", true).unwrap();
    assert_eq!(r["notes"][0], "Hi.\nby:: claude");
    // nothing changed
    let r = polish_answer(&app.vault, "Groceries: milk, eggs", "Groceries: milk, eggs", true).unwrap();
    assert_eq!(r["same"], true);
    // refused: empty, far too long, too many pieces
    assert!(polish_answer(&app.vault, "x", "   ", true).is_err());
    assert!(polish_answer(&app.vault, "x", &"word ".repeat(2000), true).is_err());
    assert!(polish_answer(&app.vault, "x", &"- a\n".repeat(9), true).is_err());
    let _ = std::fs::remove_dir_all(&v);
}

/// A tiny web server for one request: answers `reply`, hands back what it was sent.
fn serve_once(reply: &'static str) -> (u16, std::thread::JoinHandle<String>) {
    let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = l.local_addr().unwrap().port();
    let h = std::thread::spawn(move || {
        let (mut s, _) = l.accept().unwrap();
        s.set_read_timeout(Some(std::time::Duration::from_secs(5))).unwrap();
        let mut got = vec![];
        let mut buf = [0u8; 4096];
        loop {
            let n = s.read(&mut buf).unwrap_or(0);
            if n == 0 {
                break;
            }
            got.extend_from_slice(&buf[..n]);
            let t = String::from_utf8_lossy(&got);
            if let Some(i) = t.find("\r\n\r\n") {
                let len = t.lines().find_map(|l| l.to_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap_or(0))).unwrap_or(0);
                if got.len() >= i + 4 + len {
                    break;
                }
            }
        }
        let _ = write!(s, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", reply.len(), reply);
        String::from_utf8_lossy(&got).into_owned()
    });
    (port, h)
}

#[test]
fn curl_sends_the_key_in_a_header_and_reads_the_answer() {
    let curl = Path::new("/usr/bin/curl");
    if !curl.is_file() {
        eprintln!("(no curl here: skipped)");
        return;
    }
    let (port, h) = serve_once(r#"{"choices":[{"message":{"content":"Tidy words"}}]}"#);
    let s = Setup { provider: "other".into(), base: format!("http://127.0.0.1:{port}/v1"), model: "local-m".into() };
    let req = ai::chat_request(&s, "rules", "the \"note\" \\ here", 100).unwrap();
    let tmp = std::env::temp_dir().join(format!("outline_ai_send_{}", std::process::id()));
    let (status, body) = ai::send_with_curl(curl, &req, Some("sk-test-123"), &tmp).unwrap();
    assert_eq!(status, 200);
    assert_eq!(ai::read_chat(&s, status, &body).unwrap(), "Tidy words");
    let got = h.join().unwrap();
    assert!(got.starts_with("POST /v1/chat/completions"), "{got}");
    assert!(got.contains("Authorization: Bearer sk-test-123"), "{got}");
    assert!(got.contains(r#"the \"note\" \\ here"#), "the body as written: {got}");
    assert!(std::fs::read_dir(&tmp).map(|d| d.count()).unwrap_or(0) == 0, "the body's file is removed");
    // a key with a line break in it is refused before anything is sent
    assert!(ai::send_with_curl(curl, &req, Some("a\nb"), &tmp).is_err());
    // nobody there
    let gone = Setup { provider: "other".into(), base: "http://127.0.0.1:9/v1".into(), model: "m".into() };
    let e = ai::send_with_curl(curl, &ai::chat_request(&gone, "a", "b", 9).unwrap(), None, &tmp).unwrap_err();
    assert!(e.contains("Is it running"), "{e}");
}

// ---------------------------------------------------------------- Build 52: the other AI features

#[test]
fn a_picture_goes_with_the_question_in_each_format() {
    assert_eq!(ai::base64(b"Man"), "TWFu");
    assert_eq!(ai::base64(b"Ma"), "TWE=");
    assert_eq!(ai::base64(b"M"), "TQ==");
    assert_eq!(ai::picture_type("a.JPG"), Some("image/jpeg"));
    assert_eq!(ai::picture_type("a.svg"), None);
    let pic = ai::Picture { media_type: "image/png", data: "AAAA".into() };
    let r = ai::chat_request_with(&setup("claude", "c"), "rules", "words", Some(&pic), 100).unwrap();
    let b: Value = serde_json::from_str(r.body.as_deref().unwrap()).unwrap();
    assert_eq!(b["messages"][0]["content"][0]["source"]["media_type"], "image/png");
    assert_eq!(b["messages"][0]["content"][1]["text"], "words");
    let r = ai::chat_request_with(&setup("openai", "o"), "rules", "words", Some(&pic), 100).unwrap();
    let b: Value = serde_json::from_str(r.body.as_deref().unwrap()).unwrap();
    assert_eq!(b["messages"][1]["content"][0]["image_url"]["url"], "data:image/png;base64,AAAA");
}

#[test]
fn picture_to_text_gives_notes_with_depths_and_only_known_links() {
    let v = vault("pic");
    let app = open(&v);
    let (_, user) = ai::picture_question(&app.vault, "Photo of the whiteboard ![b](../assets/b.png)");
    assert!(user.contains("Diogo Silva (also called: Diogo)"), "the most linked pages are offered");
    let a = "```\n- Talk plan for [[CBeRa]]\n  - 1. why noise helps\n      - deep\n  - ask [[Nobody Here]]\nkey:: value\n```";
    let r = ai::picture_answer(&app.vault, "note", a, true).unwrap();
    let notes = r["notes"].as_array().unwrap();
    assert_eq!(notes[0]["text"], "Talk plan for [[CBeRa]]\nby:: ai");
    assert_eq!(notes[1]["text"], "why noise helps");
    assert_eq!(notes[1]["depth"], 1);
    assert_eq!(notes[2]["depth"], 2, "never more than one deeper than the note before");
    assert_eq!(notes[3]["text"], "ask Nobody Here");
    assert_eq!(notes.len(), 4, "a property line is dropped");
    assert_eq!(r["unlinked"][0], "Nobody Here");
    assert!(ai::picture_answer(&app.vault, "note", "  \n", true).is_err());
}

#[test]
fn ask_this_page_reads_the_page_and_what_links_to_it() {
    let v = vault("ask");
    put(&v, "journals/2026_10_28.md", "- asked Rita whether [[CBeRa]] covers the fees\n\t- needs the invoice by Dec 15\n");
    put(&v, "journals/2026_10_09.md", "- [[CBeRa]] report due end of January\n");
    let app = open(&v);
    let (_, user, sources) = ai::ask_question(&app.vault, "cbera", "What do I owe?").unwrap();
    assert_eq!(sources[0], "CBeRa");
    assert_eq!(sources.len(), 3);
    assert!(user.contains("needs the invoice by Dec 15"), "a linking note's sub-notes come along");
    assert!(user.contains("[1] The page \"CBeRa\""));
    assert!(ai::ask_question(&app.vault, "cbera", "  ").is_err());
    let r = ai::ask_answer(&app.vault, "- The invoice, by Dec 15. [2]\n- The report [3][2][9]\n- About [[Made Up]] [x]", &sources).unwrap();
    let p = r["points"].as_array().unwrap();
    assert_eq!(p[0]["text"], "The invoice, by Dec 15.");
    assert_eq!(p[0]["sources"][0], sources[1]);
    assert_eq!(p[1]["sources"].as_array().unwrap().len(), 2, "an unknown number is dropped");
    assert_eq!(p[2]["text"], "About Made Up [x]");
    assert_eq!(ai::ask_answer(&app.vault, "Your notes don't say.", &sources).unwrap()["none"], true);
}

#[test]
fn link_suggestions_number_the_mentions_and_read_yes_or_no() {
    let v = vault("links");
    put(&v, "journals/2026_11_19.md", "- ask Luis Rocha about the plots\n- Luis Rocha the footballer scored\n");
    let app = open(&v);
    let m = ai::link_mentions(&app.vault, "Luis Rocha");
    assert_eq!(m.len(), 2);
    let (_, user) = ai::links_question(&app.vault, "Luis Rocha", &m).unwrap();
    assert!(user.contains("1: (in \"Nov 19th, 2026\") ask Luis Rocha about the plots"), "{user}");
    let r = ai::links_answer("1: yes - the collaborator\n2: No — a footballer\n7: yes - out of range", 2).unwrap();
    assert_eq!(r[0]["link"], true);
    assert_eq!(r[0]["why"], "the collaborator");
    assert_eq!(r[1]["link"], false);
    assert_eq!(r[1]["why"], "a footballer");
    assert!(ai::links_answer("I think so", 2).is_err());
    assert!(ai::links_question(&app.vault, "Recipes", &[]).is_err());
}

#[test]
fn aliases_never_take_another_pages_name() {
    let v = vault("names");
    let app = open(&v);
    let a = "description: The CBR-funded project for my [[fellowship]]\nalias: Sibera\nalias: Diogo, CBR fellowship\nalias: CBeRa\nalias: [[x]]\nalias: Nov 17th, 2026";
    let r = ai::names_answer(&app.vault, "CBeRa", a).unwrap();
    assert_eq!(r["description"], "The CBR-funded project for my fellowship");
    let al: Vec<&str> = r["aliases"].as_array().unwrap().iter().map(|x| x.as_str().unwrap()).collect();
    assert_eq!(al, ["Sibera", "CBR fellowship"], "not Diogo (Diogo Silva's), not its own name, not a day");
    assert!(ai::names_answer(&app.vault, "CBeRa", "nothing here").is_err());
}
