"""Tests for scripts/update_sig.py's APK signature file (thinky-apk.sig, the outside review's item 3):
CI signs thinky.apk with `sign-update` and checks it with `check-update` and `apk-check`. Makes a
throw-away key with openssl in a temporary folder (deleted at the end); nothing real is signed.
Run: python3 scripts/update_sig_test.py (CI's `test` job runs it)."""
import json, os, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SIG = os.path.join(HERE, "update_sig.py")
OPENSSL = os.environ.get("OPENSSL") or "openssl"
failed = 0


def check(what, ok):
    global failed
    print(("PASS " if ok else "FAIL ") + what)
    failed += 0 if ok else 1


def run(*args):
    """update_sig.py with these arguments: (exit code, what it printed)."""
    env = {k: v for k, v in os.environ.items() if k != "KEY_PASS"}  # (the test keys aren't locked)
    r = subprocess.run([sys.executable, SIG, *args], capture_output=True, text=True, env=env)
    return r.returncode, (r.stdout + r.stderr).strip()


with tempfile.TemporaryDirectory() as t:
    key, other = os.path.join(t, "key.pem"), os.path.join(t, "other.pem")
    for k in (key, other):  # two throw-away P-256 keys
        subprocess.run([OPENSSL, "genpkey", "-algorithm", "EC", "-pkeyopt", "ec_paramgen_curve:P-256", "-out", k], check=True, capture_output=True)
    pub = run("pub", key)[1]
    apk = os.path.join(t, "thinky.apk")
    open(apk, "wb").write(os.urandom(5000))  # stands in for the signed APK
    sig = os.path.join(t, "thinky-apk.sig")

    code, said = run("sign-update", key, apk, sig, "0.7.0", "56")
    check(f"signs the APK ({said})", code == 0)
    d = json.load(open(sig))
    check("the file is the same kind as thinky-update.sig", sorted(d) == ["build", "file", "sha256", "sig", "version"])
    check("it names thinky.apk, the version and build 56", (d["file"], d["version"], d["build"]) == ("thinky.apk", "0.7.0", 56))
    check("check-update accepts it", run("check-update", pub, sig)[0] == 0)
    check("apk-check accepts it as build 56", run("apk-check", pub, apk, sig, "56") == (0, "ok"))

    def refused(what, code_said, says):
        code, said = code_said
        check(f"{what} is refused ({said})", code == 1 and says in said)

    refused("another build", run("apk-check", pub, apk, sig, "57"), "isn't for build 57")
    changed = os.path.join(t, "changed", "thinky.apk")
    os.makedirs(os.path.dirname(changed))
    b = bytearray(open(apk, "rb").read()); b[2500] ^= 1; open(changed, "wb").write(b)
    refused("a changed APK", run("apk-check", pub, changed, sig, "56"), "doesn't match")
    refused("another key", run("apk-check", run("pub", other)[1], apk, sig, "56"), "doesn't check out")

    def edited(field, value):
        e = dict(d); e[field] = value
        p = os.path.join(t, f"edited-{field}.sig"); json.dump(e, open(p, "w")); return p

    refused("its version edited", run("apk-check", pub, apk, edited("version", "0.8.0"), "56"), "doesn't check out")
    refused("its build edited to match", run("apk-check", pub, apk, edited("build", 57), "57"), "doesn't check out")
    refused("its build as text", run("apk-check", pub, apk, edited("build", "56"), "56"), "isn't for build")
    refused("another file named", run("apk-check", pub, apk, edited("file", "thinky-setup.exe"), "56"), "not thinky.apk")
    # the installer's signature file can't be passed off as the APK's (another name in the signed text)
    setup = os.path.join(t, "thinky-setup.exe"); open(setup, "wb").write(open(apk, "rb").read())
    win = os.path.join(t, "thinky-update.sig")
    run("sign-update", key, setup, win, "0.7.0", "56")
    refused("the Windows installer's file", run("apk-check", pub, apk, win, "56"), "not thinky.apk")

print("update_sig_test:", "everything passed" if not failed else f"{failed} FAILED")
sys.exit(1 if failed else 0)
