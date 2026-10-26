"""Signatures for one-click updates (run by .github/workflows/build.yml; see outline_core::update).

  python3 scripts/update_sig.py pub <key.pem>
      the public key the app checks with (base64 of the P-256 point X‖Y)
  python3 scripts/update_sig.py sign <key.pem> <file> <out.sig> <version>
      write the signature file for <file> as that app version (e.g. 0.1.24)
  python3 scripts/update_sig.py check <public key> <file.sig>
      does that signature file check out with that public key (base64 X‖Y)? Uses only what the
      file itself says (file name, version, checksum), so an earlier release's .sig is enough.
  python3 scripts/update_sig.py version <N>
      the app version of build N (major.minor from src-tauri/tauri.conf.json, as ci_version.py makes
      it), so the job that signs works it out itself instead of taking the build's word for it

A locked key's password comes from the KEY_PASS environment variable, never the command line.
openssl is the one named by the OPENSSL environment variable (CI gives its full path, so making,
unlocking and using the key always go through the same program), else the first on PATH. The
private key is only ever read by openssl: never printed, copied or written unlocked.
"""
import base64, hashlib, json, os, re, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
OPENSSL = os.environ.get("OPENSSL") or "openssl"
# DER header of a P-256 public key (SubjectPublicKeyInfo), before the point 04‖X‖Y
SPKI_P256 = bytes.fromhex("3059301306072a8648ce3d020106082a8648ce3d030107034200")


def openssl(cmd, *args):
    # (the password option goes before any file name: openssl reads what follows a file as files)
    pw = ["-passin", "env:KEY_PASS"] if os.environ.get("KEY_PASS") else []
    r = subprocess.run([OPENSSL, cmd, *pw, *args], capture_output=True)
    if r.returncode != 0:
        sys.exit(f"openssl {cmd} failed: {r.stderr.decode(errors='replace').strip()}")
    return r.stdout


def public_point(key):
    """X‖Y of the key's public point (the last 64 bytes of its DER SubjectPublicKeyInfo)."""
    der = openssl("pkey", "-in", key, "-pubout", "-outform", "DER")
    if len(der) != 91 or der[:26] != SPKI_P256 or der[26] != 4:
        sys.exit("the update key isn't a P-256 key")
    return der[-64:]


def signed_text(file, version, sha256_hex):
    # exactly outline_core::update::signed_text
    return f"lean-outliner-update\n{file}\n{version}\n{sha256_hex}\n"


def der_to_raw(der):
    """ECDSA-Sig-Value (SEQUENCE { r INTEGER, s INTEGER }) -> r‖s, 32 bytes each."""
    if der[0] != 0x30:
        raise ValueError("not a DER signature")
    i = 2 + (der[1] & 0x7F if der[1] & 0x80 else 0)
    out = b""
    for _ in range(2):
        if der[i] != 0x02:
            raise ValueError("not a DER signature")
        n = der[i + 1]
        out += int.from_bytes(der[i + 2:i + 2 + n], "big").to_bytes(32, "big")
        i += 2 + n
    return out


def raw_to_der(raw):
    def integer(b):
        b = b.lstrip(b"\0") or b"\0"
        if b[0] & 0x80:
            b = b"\0" + b
        return bytes([2, len(b)]) + b
    body = integer(raw[:32]) + integer(raw[32:])
    return bytes([0x30, len(body)]) + body


def check(pub_b64, sig_path):
    """True if the signature file's signature is good for its own file/version/checksum."""
    point = base64.b64decode(pub_b64, validate=True)
    d = json.load(open(sig_path, encoding="utf-8-sig"))
    raw = base64.b64decode(d["sig"], validate=True)
    if len(point) != 64 or len(raw) != 64 or not re.fullmatch(r"[0-9a-f]{64}", d["sha256"]):
        return False
    with tempfile.TemporaryDirectory() as t:
        pub, sig, msg = (os.path.join(t, f) for f in ("pub.der", "sig.der", "msg"))
        open(pub, "wb").write(SPKI_P256 + b"\x04" + point)
        open(sig, "wb").write(raw_to_der(raw))
        open(msg, "wb").write(signed_text(d["file"], d["version"], d["sha256"]).encode())
        r = subprocess.run([OPENSSL, "dgst", "-sha256", "-verify", pub, "-keyform", "DER", "-signature", sig, msg], capture_output=True)
        return r.returncode == 0


def sign(key, path, out, version):
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version):
        sys.exit(f"not a version: {version!r}")
    name = os.path.basename(path)
    sha = hashlib.sha256(open(path, "rb").read()).hexdigest()
    with tempfile.TemporaryDirectory() as t:
        msg, sig = os.path.join(t, "msg"), os.path.join(t, "sig.der")
        open(msg, "wb").write(signed_text(name, version, sha).encode())
        openssl("dgst", "-sha256", "-sign", key, "-out", sig, msg)
        raw = der_to_raw(open(sig, "rb").read())
    data = {"file": name, "version": version, "sha256": sha, "sig": base64.b64encode(raw).decode()}
    open(out, "w", newline="\n").write(json.dumps(data, indent=1) + "\n")
    # check it the way the app will (from r‖s and the public point), before anything is published
    if not check(base64.b64encode(public_point(key)).decode(), out):
        os.remove(out)
        sys.exit("the new signature didn't check out")
    print(f"signed {name} {version} {sha}")


def version(n):
    if not re.fullmatch(r"[1-9][0-9]{0,5}", n):
        sys.exit(f"not a build number: {n!r}")
    major, minor, _ = json.load(open(os.path.join(HERE, "..", "src-tauri", "tauri.conf.json")))["version"].split(".")
    return f"{major}.{minor}.{n}"


if __name__ == "__main__":
    a = sys.argv[1:]
    if a[:1] == ["pub"] and len(a) == 2:
        print(base64.b64encode(public_point(a[1])).decode())
    elif a[:1] == ["sign"] and len(a) == 5:
        sign(*a[1:])
    elif a[:1] == ["version"] and len(a) == 2:
        print(version(a[1]))
    elif a[:1] == ["check"] and len(a) == 3:
        ok = check(a[1], a[2])
        print("ok" if ok else "the signature doesn't match this key")
        sys.exit(0 if ok else 1)
    else:
        sys.exit(__doc__)
