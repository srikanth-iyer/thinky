//! The rules of one-click updates (Settings → About → "Update now"), apart from the platform code
//! (src-tauri/src/update.rs on Windows, android/MainActivity.kt on Android) so they can be tested:
//! where a build's files are, what exactly is signed, and which versions are accepted.
//!
//! A release "build-N" carries `thinky-setup.exe` and signature files: JSON `{"file", "version",
//! ["build",] "sha256", "sig"}` made by CI (scripts/update_sig.py), where `sig` is an ECDSA P-256 /
//! SHA-256 signature (base64 of the raw r‖s) of a short text naming the file, its version (and build)
//! and checksum, so an older genuine installer can't be passed off as a newer one.
//! Since Build 41 the app's version is the one people see (ui/version.js, any part may go up) and it
//! reads `thinky-update.sig` ([`update_text`]: version higher than its own, made for build N). Every
//! release also keeps `thinky-setup.exe.sig` ([`signed_text`], version 0.1.N, which must end in N)
//! for Build 40 and older, which compare that way.

/// The Windows installer and its signature file, as named on the downloads page (since Build 35;
/// releases also carry the same installer as `LeanOutliner-setup.exe` with its own signature file,
/// signed for that name, for Build 34 and older, which look for it).
pub const SETUP_FILE: &str = "thinky-setup.exe";
pub const SIG_FILE: &str = "thinky-setup.exe.sig";
/// Since Build 41: the signature file Build 41 and later read ([`update_text`]), whose version is the
/// one people see (ui/version.js). `SIG_FILE` stays on every release, signed the old way with
/// version 0.1.N, for Build 40 and older.
pub const UPDATE_SIG_FILE: &str = "thinky-update.sig";
/// The public downloads page's files: `<DOWNLOADS>/build-N/<file>`.
const DOWNLOADS: &str = "https://github.com/srikanth-iyer/thinky/releases/download";

/// (major, minor, build), e.g. 0.1.24 → (0, 1, 24).
pub type Version = (u32, u32, u32);

/// "build-24" → 24. Only that exact shape: the number is all that is ever taken from the page.
pub fn build_number(tag: &str) -> Option<u32> {
    let d = tag.strip_prefix("build-")?;
    if d.is_empty() || d.len() > 6 || !d.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    d.parse().ok().filter(|&n| n > 0)
}

/// Where a file of build `n` is downloaded from.
pub fn asset_url(n: u32, file: &str) -> String {
    format!("{DOWNLOADS}/build-{n}/{file}")
}

/// "0.1.24" → (0, 1, 24); anything else → None.
pub fn parse_version(s: &str) -> Option<Version> {
    let mut parts = s.split('.').map(|p| (!p.is_empty() && p.len() <= 9 && p.bytes().all(|b| b.is_ascii_digit())).then(|| p.parse::<u32>().ok()).flatten());
    let v = (parts.next()??, parts.next()??, parts.next()??);
    parts.next().is_none().then_some(v)
}

/// The exact text CI signs for a release file (scripts/update_sig.py writes the same).
pub fn signed_text(file: &str, version: &str, sha256_hex: &str) -> String {
    format!("lean-outliner-update\n{file}\n{version}\n{sha256_hex}\n")
}

/// A signature file, read.
#[derive(Debug, Clone, PartialEq)]
pub struct SigFile {
    pub file: String,
    pub version: String,
    /// The build it was made for (`thinky-update.sig` since Build 41; the older kind has none).
    pub build: Option<u32>,
    pub sha256: String,
    /// r‖s, 32 bytes each.
    pub sig: [u8; 64],
}

pub fn parse_sig_file(text: &str) -> Result<SigFile, String> {
    let v: serde_json::Value = serde_json::from_str(text.trim_start_matches('\u{feff}')).map_err(|_| "the signature file can’t be read".to_string())?;
    let field = |k: &str| v.get(k).and_then(|x| x.as_str()).map(str::to_string).ok_or_else(|| format!("the signature file has no “{k}”"));
    let sha256 = field("sha256")?.to_ascii_lowercase();
    if sha256.len() != 64 || !sha256.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("the signature file’s checksum isn’t valid".into());
    }
    let sig = base64_decode(&field("sig")?).and_then(|b| <[u8; 64]>::try_from(b).ok()).ok_or("the signature isn’t valid")?;
    let build = match v.get("build") {
        None => None,
        Some(b) => Some(b.as_u64().and_then(|b| u32::try_from(b).ok()).filter(|&b| b > 0).ok_or("the signature file’s build number isn’t valid")?),
    };
    Ok(SigFile { file: field("file")?, version: field("version")?, build, sha256, sig })
}

/// The checks that need no cryptography, then the text whose signature must be valid for build
/// `n` to be installed: the signature file is for `file` and for build `n`, newer than `own` (the
/// running app's version; None skips that, for CI's check of the app it just built), and its
/// checksum is that of the downloaded bytes (`sha256_hex`, worked out by the caller). The text is
/// made from what the app asked for and worked out itself, so nothing in the file is taken on trust.
pub fn text_to_verify(sig: &SigFile, file: &str, n: u32, own: Option<Version>, sha256_hex: &str) -> Result<String, String> {
    if sig.file != file {
        return Err(format!("the signature file is for {}, not {file}", sig.file));
    }
    let v = parse_version(&sig.version).ok_or_else(|| format!("the signature file’s version ({}) can’t be read", sig.version))?;
    if v.2 != n {
        return Err(format!("the signature file is for version {}, not build {n}", sig.version));
    }
    if let Some(o) = own {
        if v <= o {
            return Err(format!("version {} isn’t newer than this one ({}.{}.{})", sig.version, o.0, o.1, o.2));
        }
    }
    if !sig.sha256.eq_ignore_ascii_case(sha256_hex) {
        return Err("the download doesn’t match its signature file (it may be damaged)".into());
    }
    Ok(signed_text(file, &sig.version, &sha256_hex.to_ascii_lowercase()))
}

/// Since Build 41 (he decided, Nov 9: the version is a name, set by hand, that can go up in any part):
/// the exact text CI signs in `thinky-update.sig` (scripts/update_sig.py `sign-update`). Its own first
/// line, so it can't be mistaken for the older kind, and the build number, so a genuine file can only
/// be offered as the build it was made for.
pub fn update_text(file: &str, version: &str, build: u32, sha256_hex: &str) -> String {
    format!("thinky-update-2\n{file}\n{version}\nbuild {build}\n{sha256_hex}\n")
}

/// The checks before the signature of a `thinky-update.sig`, for build `n` (the release asked for):
/// the file is `file`, made for build `n`, its version higher than `own` (the running app's; None
/// skips that, for CI's check of what it just built), and its checksum that of the download. Any part
/// of the version may have gone up. Returns the text whose signature must be valid.
pub fn update_text_to_verify(sig: &SigFile, file: &str, n: u32, own: Option<Version>, sha256_hex: &str) -> Result<String, String> {
    if sig.file != file {
        return Err(format!("the signature file is for {}, not {file}", sig.file));
    }
    if sig.build != Some(n) {
        return Err(format!("the signature file isn’t for build {n}"));
    }
    let v = parse_version(&sig.version).ok_or_else(|| format!("the signature file’s version ({}) can’t be read", sig.version))?;
    if let Some(o) = own {
        if v <= o {
            return Err(format!("version {} isn’t newer than this one ({}.{}.{})", sig.version, o.0, o.1, o.2));
        }
    }
    if !sig.sha256.eq_ignore_ascii_case(sha256_hex) {
        return Err("the download doesn’t match its signature file (it may be damaged)".into());
    }
    Ok(update_text(file, &sig.version, n, &sha256_hex.to_ascii_lowercase()))
}

/// Standard base64 (with or without `=` padding); None for anything else.
pub fn base64_decode(s: &str) -> Option<Vec<u8>> {
    let s = s.trim().trim_end_matches('=');
    let mut out = Vec::with_capacity(s.len() * 3 / 4);
    let (mut acc, mut bits) = (0u32, 0u32);
    for c in s.bytes() {
        let v = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return None,
        } as u32;
        acc = (acc << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
            acc &= (1 << bits) - 1;
        }
    }
    (bits < 6).then_some(out) // a lone last character can't be a whole byte
}

/// Lowercase hex, e.g. for a SHA-256 checksum.
pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
