//! Where an AI key may go (review claims 1 and 3): `check_base`'s strict reading of an address,
//! `key_header` (the header comes from the service, never the page), `key_may_go` (a preset
//! service's key only under its own fixed address, "Other"'s only under the address saved with it),
//! a preset service ignoring a typed address, and `send_with_curl` / `send_keyed` taking the address
//! and its local-ness from `check_base` itself, reading it literally (globoff), and sweeping old
//! request files.
use outline_core::ai::{self, check_base, key_header, key_may_go, Setup, KEY_ELSEWHERE, PROVIDERS};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

fn setup(provider: &str, base: &str) -> Setup {
    Setup { provider: provider.into(), base: base.into(), model: "m".into() }
}

// ---------------------------------------------------------------- check_base (claim 3)

#[test]
fn an_at_sign_never_hides_the_real_computer() {
    // the review's addresses: curl would send to attacker.example, in plain http
    for u in [
        "http://localhost:80@attacker.example/v1",
        "http://[::1]@attacker.example/v1",
        "http://localhost@attacker.example/v1",
        "http://127.0.0.1@attacker.example/v1",
        "https://user:pw@api.openai.com/v1",
        "https://api.openai.com/v1/@evil",
        "https://api.openai.com/v1?x=@evil",
    ] {
        assert!(check_base(u).is_err(), "{u} must be refused");
    }
}

#[test]
fn the_name_ends_at_a_slash_question_mark_or_hash() {
    // before: the host was read up to the first "/" only, so "?.lan" / "#.local" made it "local"
    for u in ["http://attacker.example#.local/v1", "http://attacker.example?.lan/v1", "http://attacker.example?x=.local", "http://attacker.example#.localhost"] {
        assert!(check_base(u).is_err(), "{u}: http to the internet");
    }
    // https to the same addresses is fine (it isn't local, and https may go anywhere)
    assert_eq!(check_base("https://ai.example.org?x=1").unwrap(), ("https://ai.example.org?x=1".to_string(), false));
    assert_eq!(check_base("https://ai.example.org#frag").unwrap().1, false);
    // a local name with a query is still local
    assert_eq!(check_base("http://box.lan?x=1").unwrap().1, true);
}

#[test]
fn braces_are_refused_and_never_globbed() {
    for u in ["http://{attacker.example?,x}.local/v1", "https://{a,b}.example.com/v1", "https://api.openai.com/v1/{x}", "https://a.com/}"] {
        assert!(check_base(u).is_err(), "{u}");
    }
}

#[test]
fn number_addresses_are_read_strictly() {
    // leading zeros (octal to some readers), short forms, big numbers, out-of-range parts
    for u in [
        "http://0127.0.0.1/v1",
        "http://010.0.0.1/v1",
        "http://127.1/v1",
        "http://2130706433/v1",
        "http://127.999.0.1/v1",
        "http://256.0.0.1/v1",
        "http://1.2.3.4.5/v1",
        "http://127.0.0.1./v1",
        "http://.127.0.0.1/v1",
        "https://0127.0.0.1/v1",
    ] {
        assert!(check_base(u).is_err(), "{u}");
    }
    // the usual ones still work
    assert!(check_base("http://127.0.0.1:11434/v1").unwrap().1);
    assert!(check_base("http://10.0.0.7/v1").unwrap().1);
    assert!(check_base("http://192.168.0.2:1234/v1").unwrap().1);
    assert!(check_base("http://172.16.0.1/v1").unwrap().1);
    assert!(check_base("http://172.31.255.255/v1").unwrap().1);
    assert!(check_base("http://172.15.0.1/v1").is_err(), "172.15 isn't a home network");
    assert!(check_base("http://172.32.0.1/v1").is_err(), "172.32 isn't a home network");
    assert!(check_base("http://8.8.8.8/v1").is_err());
    assert_eq!(check_base("https://8.8.8.8/v1").unwrap().1, false, "https to a number address is fine, not local");
    assert_eq!(check_base("https://127.0.0.1/v1").unwrap().1, false, "local only matters for http");
}

#[test]
fn ipv6_addresses_must_be_real_ones() {
    assert!(check_base("http://[::1]/v1").unwrap().1);
    assert!(check_base("http://[::1]:8080/v1").unwrap().1);
    assert!(check_base("http://[0:0:0:0:0:0:0:1]:8080/v1").unwrap().1, "::1 written out");
    for u in [
        "http://[::1/v1",
        "http://[localhost]/v1",
        "http://[::1]x/v1",
        "http://[::1]:/v1",
        "http://[2001:db8::1]/v1",
        "http://[]/v1",
        "http://[::1]:99999/v1",
    ] {
        assert!(check_base(u).is_err(), "{u}");
    }
    assert_eq!(check_base("https://[2001:db8::1]/v1").unwrap().1, false);
}

#[test]
fn names_and_ports_are_plain() {
    for u in [
        "https://exa%6Dple.com/v1",
        "https://a!b.com/v1",
        "https://a.com:x/v1",
        "https://a.com:0/v1",
        "https://a.com:65536/v1",
        "https://a.com:/v1",
        "https://a.com:123456/v1",
        "https:///v1",
        "https://:443/v1",
        "http://local host/v1",
        "https://a.com/v1\\x",
    ] {
        assert!(check_base(u).is_err(), "{u}");
    }
    assert!(check_base("https://api.example.com:8443/v1").is_ok());
    assert!(check_base("http://my_box.local:65535/v1").unwrap().1);
    assert!(check_base("http://LOCALHOST:11434/v1").unwrap().1, "names in any capitals");
    assert!(check_base("http://ollama.localhost/v1").unwrap().1);
    assert!(check_base("http://localhost.example.com/v1").is_err(), "a name that only starts with localhost");
    assert!(check_base("http://evil.com.local.example/v1").is_err());
}

#[test]
fn every_preset_address_passes() {
    for p in PROVIDERS.iter().filter(|p| !p.base.is_empty()) {
        let (b, local) = check_base(p.base).unwrap_or_else(|e| panic!("{}: {e}", p.id));
        assert_eq!(b, p.base);
        assert_eq!(local, p.base.starts_with("http://"), "{}", p.id);
    }
}

// ---------------------------------------------------------------- key_header (claim 1)

#[test]
fn the_key_header_comes_from_the_service() {
    assert_eq!(key_header("claude"), Some("x-api-key"));
    for s in ["openai", "gemini", "openrouter", "other"] {
        assert_eq!(key_header(s), Some("bearer"), "{s}");
    }
    for s in ["ollama", "lmstudio", "", "Claude", "CLAUDE", "nobody", "claude "] {
        assert_eq!(key_header(s), None, "{s:?}");
    }
    // the requests built here say the same
    for p in PROVIDERS {
        let base = if p.id == "other" { "https://ai.example.org/v1" } else { "" };
        let r = ai::chat_request(&setup(p.id, base), "a", "b", 9).unwrap();
        assert_eq!(r.auth.as_deref(), key_header(p.id), "{}", p.id);
    }
}

// ---------------------------------------------------------------- key_may_go (claim 1)

#[test]
fn a_preset_key_goes_only_under_its_own_address() {
    assert!(key_may_go("claude", "https://api.anthropic.com/v1/messages", None));
    assert!(key_may_go("claude", "https://api.anthropic.com/v1/models?limit=100", None));
    assert!(key_may_go("openai", "https://api.openai.com/v1/chat/completions", None));
    assert!(key_may_go("gemini", "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", None));
    assert!(key_may_go("openrouter", "https://openrouter.ai/api/v1/models", None));
    // an "other" base given for a preset service changes nothing
    assert!(key_may_go("openai", "https://api.openai.com/v1/models", Some("https://evil.example/v1")));
    for (s, u) in [
        ("claude", "https://attacker.example/v1/messages"),
        ("claude", "https://api.openai.com/v1/messages"),
        ("claude", "https://api.anthropic.com/v1"),
        ("claude", "https://api.anthropic.com/v1x/messages"),
        ("claude", "https://api.anthropic.com.attacker.example/v1/messages"),
        ("claude", "https://api.anthropic.com:443/v1/messages"),
        ("claude", "http://api.anthropic.com/v1/messages"),
        ("claude", "HTTPS://api.anthropic.com/v1/messages"),
        ("claude", "https://API.anthropic.com/v1/messages"),
        ("claude", "https://api.anthropic.com@attacker.example/v1/messages"),
        ("claude", "https://api.anthropic.com/v1/@attacker.example"),
        ("claude", " https://api.anthropic.com/v1/messages"),
        ("claude", "https://api.anthropic.com/v1/messages\nurl = \"https://evil\""),
        ("openai", "https://api.anthropic.com/v1/messages"),
        ("openai", "https://openrouter.ai/api/v1/models"),
        ("gemini", "https://generativelanguage.googleapis.com/v1/models"),
        ("openrouter", "https://openrouter.ai/v1/models"),
        ("openrouter", ""),
    ] {
        assert!(!key_may_go(s, u, None), "{s} -> {u:?}");
    }
}

#[test]
fn keyless_and_unknown_services_never_send_a_key() {
    assert!(!key_may_go("ollama", "http://localhost:11434/v1/chat/completions", None));
    assert!(!key_may_go("lmstudio", "http://localhost:1234/v1/models", None));
    assert!(!key_may_go("ollama", "http://localhost:11434/v1/x", Some("http://localhost:11434/v1")));
    assert!(!key_may_go("nobody", "https://api.openai.com/v1/models", None));
    assert!(!key_may_go("", "https://api.openai.com/v1/models", None));
    assert!(!key_may_go("Claude", "https://api.anthropic.com/v1/messages", None), "ids are exact");
}

#[test]
fn an_other_key_goes_only_under_the_address_saved_with_it() {
    let saved = Some("https://ai.example.org/api/");
    assert!(key_may_go("other", "https://ai.example.org/api/chat/completions", saved));
    assert!(key_may_go("other", "https://ai.example.org/api/models", Some("  https://ai.example.org/api  ")), "trimmed as check_base does");
    assert!(key_may_go("other", "http://192.168.1.5:8080/v1/models", Some("http://192.168.1.5:8080/v1")), "a program at home");
    assert!(!key_may_go("other", "https://ai.example.org/api/chat/completions", None), "no saved address: no key");
    assert!(!key_may_go("other", "https://ai.example.org/api/chat/completions", Some("")));
    assert!(!key_may_go("other", "https://attacker.example/api/chat/completions", saved));
    assert!(!key_may_go("other", "https://ai.example.org/apix/chat", saved));
    assert!(!key_may_go("other", "https://ai.example.org.attacker.example/api/x", saved));
    assert!(!key_may_go("other", "https://ai.example.org/api", saved), "only under it, with a /");
    // a saved address that check_base refuses never lets a key go
    assert!(!key_may_go("other", "http://attacker.example/v1/x", Some("http://attacker.example/v1")));
    assert!(!key_may_go("other", "http://localhost:80@attacker.example/v1/x", Some("http://localhost:80@attacker.example/v1")));
    assert!(!key_may_go("other", "http://0127.0.0.1/v1/x", Some("http://0127.0.0.1/v1")));
}

// ---------------------------------------------------------------- setup_base (claim 1)

#[test]
fn a_service_that_needs_a_key_ignores_a_typed_address() {
    for (id, want) in [
        ("claude", "https://api.anthropic.com/v1/messages"),
        ("openai", "https://api.openai.com/v1/chat/completions"),
        ("gemini", "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"),
        ("openrouter", "https://openrouter.ai/api/v1/chat/completions"),
    ] {
        for typed in ["https://attacker.example/v1", "http://localhost:80@attacker.example/v1", "not an address", ""] {
            let r = ai::chat_request(&setup(id, typed), "a", "b", 9).unwrap();
            assert_eq!(r.url, want, "{id} with {typed:?}");
            assert!(key_may_go(id, &r.url, None), "{id}: its own requests may carry its key");
            assert!(!r.local);
        }
        assert!(ai::models_request(&setup(id, "https://attacker.example/v1")).unwrap().url.starts_with(PROVIDERS.iter().find(|p| p.id == id).unwrap().base));
    }
    // a program on this computer may be on another port, and "Other" is what was typed
    assert_eq!(ai::chat_request(&setup("ollama", "http://localhost:9999/v1"), "a", "b", 9).unwrap().url, "http://localhost:9999/v1/chat/completions");
    assert_eq!(ai::chat_request(&setup("ollama", ""), "a", "b", 9).unwrap().url, "http://localhost:11434/v1/chat/completions");
    assert_eq!(ai::chat_request(&setup("lmstudio", ""), "a", "b", 9).unwrap().url, "http://localhost:1234/v1/chat/completions");
    assert_eq!(ai::chat_request(&setup("other", "https://ai.example.org/v1/"), "a", "b", 9).unwrap().url, "https://ai.example.org/v1/chat/completions");
    assert!(ai::chat_request(&setup("other", ""), "a", "b", 9).is_err(), "Other needs an address");
    assert!(ai::chat_request(&setup("other", "http://localhost@attacker.example/v1"), "a", "b", 9).is_err());
}

// ---------------------------------------------------------------- sending

fn curl() -> Option<&'static Path> {
    let c = Path::new("/usr/bin/curl");
    c.is_file().then_some(c)
}

fn tmp(tag: &str) -> PathBuf {
    let t = std::env::temp_dir().join(format!("outline_ai_keys_{tag}_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&t);
    t
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

fn get(url: String, local: bool, auth: Option<&str>) -> ai::Request {
    ai::Request { method: "GET".into(), url, auth: auth.map(str::to_string), headers: vec![], body: None, local, key_required: false }
}

#[test]
fn whether_an_address_is_local_comes_from_the_address_not_the_page() {
    let Some(curl) = curl() else { return eprintln!("(no curl here: skipped)") };
    // the page says "not local" for an http address at home: before, curl was told https only and
    // refused; now the address itself decides
    let (port, h) = serve_once(r#"{"data":[]}"#);
    let (status, _) = ai::send_with_curl(curl, &get(format!("http://127.0.0.1:{port}/v1/models"), false, None), None, &tmp("local")).unwrap();
    assert_eq!(status, 200);
    assert!(h.join().unwrap().starts_with("GET /v1/models"));
    // and "local" from the page never lets http go to the internet
    let e = ai::send_with_curl(curl, &get("http://attacker.example/v1/models".into(), true, None), None, &tmp("local")).unwrap_err();
    assert!(e.contains("http://"), "{e}");
    let e = ai::send_with_curl(curl, &get("http://localhost:80@attacker.example/v1".into(), true, None), None, &tmp("local")).unwrap_err();
    assert!(e.contains('@'), "{e}");
}

#[test]
fn curl_reads_the_address_literally() {
    let Some(curl) = curl() else { return eprintln!("(no curl here: skipped)") };
    // with globbing, "[1-2]" would be two requests (models1, models2)
    let (port, h) = serve_once(r#"{"data":[]}"#);
    let (status, _) = ai::send_with_curl(curl, &get(format!("http://127.0.0.1:{port}/v1/models[1-2]"), true, None), None, &tmp("glob")).unwrap();
    assert_eq!(status, 200);
    let got = h.join().unwrap();
    assert!(got.starts_with("GET /v1/models[1-2] "), "{got}");
    // the address is sent trimmed, as check_base gives it
    let (port, h) = serve_once(r#"{"data":[]}"#);
    ai::send_with_curl(curl, &get(format!("  http://127.0.0.1:{port}/v1/models/  "), true, None), None, &tmp("glob")).unwrap();
    assert!(h.join().unwrap().starts_with("GET /v1/models "));
}

#[test]
fn send_keyed_takes_the_header_from_the_service_and_keeps_the_key_home() {
    let Some(curl) = curl() else { return eprintln!("(no curl here: skipped)") };
    let t = tmp("keyed");
    // "Other" at home, saved with its address: the key goes, as a Bearer header even when the page
    // asked for x-api-key
    let (port, h) = serve_once(r#"{"data":[]}"#);
    let base = format!("http://127.0.0.1:{port}/v1");
    let req = get(format!("{base}/models"), true, Some("x-api-key"));
    let (status, _) = ai::send_keyed(curl, "other", &req, Some("sk-home-1"), Some(&base), &t).unwrap();
    assert_eq!(status, 200);
    let got = h.join().unwrap();
    assert!(got.contains("Authorization: Bearer sk-home-1"), "{got}");
    assert!(!got.to_lowercase().contains("x-api-key"), "{got}");

    // a key for a service elsewhere: refused, nothing sent (no server is listening: a send would fail
    // with "Is it running", not this)
    for (svc, url, saved) in [
        ("other", format!("http://127.0.0.1:9/v1/models"), Some(base.as_str())),
        ("other", format!("{base}/models"), None),
        ("claude", format!("{base}/messages"), Some(base.as_str())),
        ("openai", "http://127.0.0.1:9/v1/chat/completions".to_string(), None),
    ] {
        let e = ai::send_keyed(curl, svc, &get(url.clone(), true, Some("bearer")), Some("sk-secret"), saved, &t).unwrap_err();
        assert_eq!(e, KEY_ELSEWHERE, "{svc} {url}");
    }

    // a service that takes no key: the request goes, without a key, whatever the page asked
    let (port, h) = serve_once(r#"{"data":[]}"#);
    let req = get(format!("http://127.0.0.1:{port}/v1/models"), true, Some("bearer"));
    ai::send_keyed(curl, "ollama", &req, Some("sk-should-not-go"), None, &t).unwrap();
    let got = h.join().unwrap();
    assert!(!got.contains("sk-should-not-go") && !got.contains("Authorization"), "{got}");

    // no key saved: the request goes without one (the service answers 401 itself)
    let (port, h) = serve_once(r#"{"data":[]}"#);
    let req = get(format!("http://127.0.0.1:{port}/v1/models"), true, None);
    ai::send_keyed(curl, "other", &req, None, None, &t).unwrap();
    assert!(!h.join().unwrap().contains("Authorization"));
}

#[test]
fn old_request_files_are_swept_and_new_ones_kept() {
    let t = tmp("sweep");
    std::fs::create_dir_all(&t).unwrap();
    let me = std::process::id();
    let other = std::fs::File::create(t.join("ai-1-0.json")).unwrap();
    drop(other);
    std::fs::write(t.join(format!("ai-{me}-999.json")), "on its way").unwrap();
    std::fs::write(t.join("notes.json"), "not ours").unwrap();
    std::fs::write(t.join("ai-1-0.txt"), "not ours").unwrap();
    std::fs::create_dir_all(t.join("ai-2-0.json")).unwrap(); // a folder is never touched
    // one of ours, but old (from a run with the same number, long ago)
    let old = t.join(format!("ai-{me}-1000.json"));
    std::fs::write(&old, "old").unwrap();
    let f = std::fs::File::options().write(true).open(&old).unwrap();
    f.set_modified(std::time::SystemTime::now() - std::time::Duration::from_secs(3600)).unwrap();
    drop(f);
    ai::sweep_temp(&t);
    assert!(!t.join("ai-1-0.json").exists(), "another run's left-over file is taken away");
    assert!(!old.exists(), "an old one is taken away");
    assert!(t.join(format!("ai-{me}-999.json")).exists(), "a request on its way is kept");
    assert!(t.join("notes.json").exists() && t.join("ai-1-0.txt").exists() && t.join("ai-2-0.json").is_dir());
    ai::sweep_temp(&t.join("not-there")); // no folder: nothing happens
}

#[test]
fn curl_that_cant_start_leaves_no_file() {
    let t = tmp("nocurl");
    let req = ai::Request { method: "POST".into(), url: "https://api.openai.com/v1/chat/completions".into(), auth: None, headers: vec![], body: Some("{}".into()), local: false, key_required: false };
    let e = ai::send_with_curl(Path::new("/no/such/curl"), &req, None, &t).unwrap_err();
    assert!(e.contains("curl"), "{e}");
    assert_eq!(std::fs::read_dir(&t).map(|d| d.count()).unwrap_or(0), 0, "the body's file is removed");
}

#[test]
fn link_answers_never_make_more_than_the_mentions_asked() {
    let r = ai::links_answer("1: yes - same person", usize::MAX).unwrap();
    assert_eq!(r.as_array().unwrap().len(), ai::MAX_MENTIONS);
    let r = ai::links_answer("1: yes - same person\n2: no - another", 2).unwrap();
    assert_eq!(r.as_array().unwrap().len(), 2);
    assert_eq!(r[0]["link"], true);
    assert_eq!(r[1]["link"], false);
    assert!(ai::links_answer("nothing useful", 3).is_err());
    assert!(ai::links_answer("41: yes - x", usize::MAX).is_err(), "a number past the cap is ignored");
}
