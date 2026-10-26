//! One-click updates: which builds and files are asked for, what exactly is signed, and the checks
//! that need no cryptography (the signature itself is checked by Windows, see src-tauri/src/update.rs,
//! and by CI on the app it just built: build.yml, "Sign the installer").
use outline_core::update::*;

#[test]
fn only_a_build_number_is_taken_from_the_page() {
    assert_eq!(build_number("build-24"), Some(24));
    assert_eq!(build_number("build-999999"), Some(999_999));
    for bad in ["build-0", "Build-24", "build-24x", "build-", "build-1234567", "build--1", "build-+3", " build-2", "build-2 ", "build-2/../x", "24", ""] {
        assert_eq!(build_number(bad), None, "{bad:?}");
    }
    assert_eq!(asset_url(24, SETUP_FILE), "https://github.com/srikanth-iyer/lean-outliner-releases/releases/download/build-24/LeanOutliner-setup.exe");
    assert_eq!(asset_url(24, SIG_FILE), "https://github.com/srikanth-iyer/lean-outliner-releases/releases/download/build-24/LeanOutliner-setup.exe.sig");
}

#[test]
fn versions() {
    assert_eq!(parse_version("0.1.24"), Some((0, 1, 24)));
    assert_eq!(parse_version("1.0.0"), Some((1, 0, 0)));
    for bad in ["0.1", "0.1.24.1", "a.b.c", "0.1.-1", "0..1", "", "0.1.24 ", "v0.1.24", "0.1.9999999999"] {
        assert_eq!(parse_version(bad), None, "{bad:?}");
    }
    assert!(parse_version("0.2.25") > parse_version("0.1.24"));
    assert!(parse_version("0.1.10") > parse_version("0.1.9"), "compared as numbers, not text");
}

#[test]
fn the_signed_text_is_exactly_this() {
    // scripts/update_sig.py makes the same text; changing it means installed apps refuse new builds
    assert_eq!(signed_text("LeanOutliner-setup.exe", "0.1.24", "ab12"), "lean-outliner-update\nLeanOutliner-setup.exe\n0.1.24\nab12\n");
}

#[test]
fn base64_and_hex() {
    // RFC 4648's examples
    for (enc, dec) in [("", ""), ("Zg==", "f"), ("Zm8=", "fo"), ("Zm9v", "foo"), ("Zm9vYg==", "foob"), ("Zm9vYmE=", "fooba"), ("Zm9vYmFy", "foobar"), ("Zm9vYg", "foob")] {
        assert_eq!(base64_decode(enc).as_deref(), Some(dec.as_bytes()), "{enc}");
    }
    for bad in ["Zm9v!", "Zm9vY", "Zm 9v", "Zm9v-_"] {
        assert_eq!(base64_decode(bad), None, "{bad}");
    }
    assert_eq!(base64_decode("+/8=").unwrap(), vec![0xfb, 0xff]);
    assert_eq!(hex(&[0, 0xab, 0x10, 0xff]), "00ab10ff");
}

fn sig_json(file: &str, version: &str, sha: &str, sig: &str) -> String {
    serde_json::json!({ "file": file, "version": version, "sha256": sha, "sig": sig }).to_string()
}
const SHA: &str = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
fn sig64() -> String {
    // 64 bytes 0..63, base64
    let b: Vec<u8> = (0..64).collect();
    const A: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut s = String::new();
    for ch in b.chunks(3) {
        let n = (ch[0] as u32) << 16 | (*ch.get(1).unwrap_or(&0) as u32) << 8 | *ch.get(2).unwrap_or(&0) as u32;
        for k in 0..=ch.len() {
            s.push(A[(n >> (18 - 6 * k) & 63) as usize] as char);
        }
    }
    s
}

#[test]
fn reading_a_signature_file() {
    let s = parse_sig_file(&sig_json(SETUP_FILE, "0.1.24", &SHA.to_uppercase(), &sig64())).unwrap();
    assert_eq!((s.file.as_str(), s.version.as_str(), s.sha256.as_str()), (SETUP_FILE, "0.1.24", SHA));
    assert_eq!(s.sig.to_vec(), (0..64).collect::<Vec<u8>>());
    // with a byte-order mark and a final line break, as an editor might leave it
    assert!(parse_sig_file(&format!("\u{feff}{}\n", sig_json(SETUP_FILE, "0.1.24", SHA, &sig64()))).is_ok());

    let err = |t: &str| parse_sig_file(t).unwrap_err();
    assert!(err("not json").contains("can’t be read"));
    assert!(err(&serde_json::json!({ "file": SETUP_FILE, "sha256": SHA, "sig": sig64() }).to_string()).contains("“version”"));
    assert!(err(&sig_json(SETUP_FILE, "0.1.24", "abc", &sig64())).contains("checksum"));
    assert!(err(&sig_json(SETUP_FILE, "0.1.24", &SHA.replace('9', "g"), &sig64())).contains("checksum"));
    assert!(err(&sig_json(SETUP_FILE, "0.1.24", SHA, "AAAA")).contains("signature isn’t valid"), "too short");
    assert!(err(&sig_json(SETUP_FILE, "0.1.24", SHA, "@@@@")).contains("signature isn’t valid"));
}

#[test]
fn what_is_accepted_before_the_signature_is_checked() {
    let sig = |file: &str, version: &str| parse_sig_file(&sig_json(file, version, SHA, &sig64())).unwrap();
    let own = Some((0, 1, 23));
    // the expected case: build 24 for an app at 0.1.23
    assert_eq!(text_to_verify(&sig(SETUP_FILE, "0.1.24"), SETUP_FILE, 24, own, SHA).unwrap(), signed_text(SETUP_FILE, "0.1.24", SHA));
    // the checksum the app worked out is what goes into the text (any case)
    assert_eq!(text_to_verify(&sig(SETUP_FILE, "0.1.24"), SETUP_FILE, 24, own, &SHA.to_uppercase()).unwrap(), signed_text(SETUP_FILE, "0.1.24", SHA));
    // a later major/minor version still names its build last
    assert!(text_to_verify(&sig(SETUP_FILE, "0.2.24"), SETUP_FILE, 24, own, SHA).is_ok());

    let err = |s: SigFile, n: u32, own: Option<Version>, sha: &str| text_to_verify(&s, SETUP_FILE, n, own, sha).unwrap_err();
    // an older genuine release offered as build 24 (replayed): refused
    assert!(err(sig(SETUP_FILE, "0.1.20"), 24, own, SHA).contains("not build 24"));
    // not newer than the app that's running
    assert!(err(sig(SETUP_FILE, "0.1.23"), 23, own, SHA).contains("isn’t newer"));
    assert!(err(sig(SETUP_FILE, "0.0.24"), 24, Some((0, 1, 23)), SHA).contains("isn’t newer"));
    // the download isn't what was signed
    assert!(err(sig(SETUP_FILE, "0.1.24"), 24, own, &SHA.replace('a', "b")).contains("doesn’t match"));
    // a signature file for another file
    assert!(err(sig("LeanOutliner.apk", "0.1.24"), 24, own, SHA).contains("is for LeanOutliner.apk"));
    assert!(err(sig(SETUP_FILE, "0.1.x"), 24, own, SHA).contains("can’t be read"));
    // CI checks the app it just built against its own installer: same version, no "newer" check
    assert!(text_to_verify(&sig(SETUP_FILE, "0.1.24"), SETUP_FILE, 24, None, SHA).is_ok());
}
