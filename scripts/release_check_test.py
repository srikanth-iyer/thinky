"""Tests for scripts/release_check.py (the checks before a release, audit finding 11), with a stand-in
`gh` that answers from a table instead of asking GitHub. Each case runs a copy of the script in a
temporary folder with its own ui/version.js (deleted at the end); nothing is read from GitHub.
Run: python3 scripts/release_check_test.py (CI's `test` job and pr.yml run it)."""
import json, os, shutil, stat, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))  # scripts/
failed = 0  # how many checks failed

# The stand-in `gh`: answers `gh api … <address> …` from the table in $FAKE_GH ({address: [exit code,
# what it prints]}), and writes each call's arguments to $FAKE_GH.log, one JSON list a line.
FAKE_GH = r'''#!/usr/bin/env python3
import json, os, sys
table = json.load(open(os.environ["FAKE_GH"]))
with open(os.environ["FAKE_GH"] + ".log", "a") as log:
    log.write(json.dumps(sys.argv[1:]) + "\n")
address = next((a for a in sys.argv[1:] if a.startswith("repos/")), "")
code, out = table.get(address, [1, "gh: Not Found (HTTP 404)"])
(sys.stdout if code == 0 else sys.stderr).write(out)
sys.exit(code)
'''


def check(what, ok):
    global failed
    print(("PASS " if ok else "FAIL ") + what)
    failed += 0 if ok else 1


def run(version, table, *args, browser=None):
    """release_check.py ARGS with ui/version.js saying `version`, browser/ holding `browser` ({path:
    bytes}) and `gh` answering from `table`: (exit code, what it printed, the gh calls made)."""
    with tempfile.TemporaryDirectory() as t:
        for path, data in (browser or {}).items():  # the extension's files, if the case has some
            os.makedirs(os.path.dirname(os.path.join(t, "browser", path)), exist_ok=True)
            with open(os.path.join(t, "browser", path), "wb") as f:
                f.write(data)
        os.makedirs(os.path.join(t, "scripts"))
        os.makedirs(os.path.join(t, "ui"))
        os.makedirs(os.path.join(t, "bin"))
        for f in ("release_check.py", "update_sig.py"):  # a copy of the scripts, beside their own ui/
            shutil.copy(os.path.join(HERE, f), os.path.join(t, "scripts", f))
        with open(os.path.join(t, "ui", "version.js"), "w") as f:
            f.write(f"export const VERSION = '{version}';\n")
        gh = os.path.join(t, "bin", "gh")
        with open(gh, "w") as f:
            f.write(FAKE_GH)
        os.chmod(gh, os.stat(gh).st_mode | stat.S_IEXEC)
        fake = os.path.join(t, "table.json")
        json.dump(table, open(fake, "w"))
        env = dict(os.environ, PATH=os.path.join(t, "bin") + os.pathsep + os.environ.get("PATH", ""),
                   FAKE_GH=fake, GITHUB_REPOSITORY="me/thinky", OLD_RELEASES="me/old")
        r = subprocess.run([sys.executable, os.path.join(t, "scripts", "release_check.py"), *args], capture_output=True, text=True, env=env)
        calls = [json.loads(l) for l in open(fake + ".log")] if os.path.exists(fake + ".log") else []
        return r.returncode, (r.stdout + r.stderr).strip(), calls


LATEST = "repos/me/thinky/releases/latest"  # the newest release's address
def latest(title):
    return {LATEST: [0, title + "\n"]}


# ---- version: higher than the newest release's
code, said, calls = run("0.6.6", latest("Build 50 · version 0.6.5"), "version", "--main")
check(f"a higher version goes on ({said})", code == 0 and "::notice title=Version::0.6.6 (the newest release: 0.6.5)" in said)
check("it read the newest release's title", calls == [["api", LATEST, "--jq", ".name"]])
code, said, _ = run("0.6.5", latest("Build 50 · version 0.6.5"), "version", "--main")
check(f"the same version stops main ({said})", code == 1 and "::error::ui/version.js says 0.6.5, but the newest release is already version 0.6.5" in said)
code, said, _ = run("0.6.5", latest("Build 50 · version 0.6.5"), "version")
check(f"the same version only warns on a wip branch ({said})", code == 0 and "::warning::" in said)
code, said, _ = run("0.9.9", latest("Build 50 · version 0.10.0"), "version", "--main")
check("versions compare as numbers (0.9.9 is lower than 0.10.0)", code == 1)
code, said, _ = run("0.10.0", latest("Build 50 · version 0.9.9"), "version", "--main")
check("0.10.0 is higher than 0.9.9", code == 0)
code, said, _ = run("1.0.0", latest("Build 50 · version 0.99.99"), "version", "--main")
check("a higher first number is higher", code == 0)
code, said, _ = run("0.6.4", latest("Build 50 · version 0.6.5"), "version", "--main")
check("a lower version stops main", code == 1)
code, said, _ = run("0.6.6", latest("Build 40"), "version", "--main")
check(f"a title with no version (before Build 41) lets it go on ({said})", code == 0 and "none named" in said)
code, said, _ = run("0.6.6", {LATEST: [1, "gh: Bad credentials (HTTP 401)"]}, "version", "--main")
check(f"no answer from GitHub stops it ({said})", code == 1 and "Couldn't read repos/me/thinky/releases/latest from GitHub" in said)
code, said, _ = run("0.6.6", {}, "version", "--main")
check("no release at all (not found) stops it, as before", code == 1)

# ---- unpublished N: no tag build-N, no release build-M with M >= N, here or on the old repo
REFS = "repos/me/thinky/git/matching-refs/tags/build-51"  # tags starting with build-51
HERE_R = "repos/me/thinky/releases?per_page=100"  # this repo's releases
OLD_R = "repos/me/old/releases?per_page=100"  # the old downloads repo's
def table(refs="", here="build-50\nbuild-49\n", old="build-34\nbuild-33\n"):
    return {REFS: [0, refs], HERE_R: [0, here], OLD_R: [0, old]}


code, said, calls = run("0.6.6", table(), "unpublished", "51")
check(f"build 51, after build-50: goes on ({said})", code == 0 and "build 51 isn't published yet" in said)
check("it lists every page of both repos' releases", [c for c in calls if "--paginate" in c] == [
    ["api", "--paginate", HERE_R, "--jq", ".[].tag_name"], ["api", "--paginate", OLD_R, "--jq", ".[].tag_name"]])
# the reviewer's case: an old run (build 51, version 0.6.5) re-run after a newer run published build 51
code, said, _ = run("0.6.5", table(refs="refs/tags/build-51\n", here="build-51\nbuild-50\n"), "unpublished", "51")
check(f"the tag already there stops it ({said})", code == 1 and "::error::The tag build-51 already exists here" in said)
code, said, _ = run("0.6.5", table(refs="refs/tags/build-51\n", here="build-50\n"), "unpublished", "51")
check("a tag left with no release stops it too", code == 1)
code, said, _ = run("0.6.5", table(here="build-52\nbuild-50\n"), "unpublished", "51")
check(f"a newer release here stops it ({said})", code == 1 and "me/thinky already has build-52, and this run is build 51" in said)
code, said, _ = run("0.6.5", table(here="build-51\n"), "unpublished", "51")
check("a release with this number (its tag not listed) stops it", code == 1)
code, said, _ = run("0.6.5", table(old="build-60\n"), "unpublished", "51")
check(f"a newer release on the old downloads repo stops it ({said})", code == 1 and "me/old already has build-60" in said)
code, said, _ = run("0.6.6", table(refs="refs/tags/build-510\nrefs/tags/build-5100\n"), "unpublished", "51")
check("other tags that only start the same (build-510) don't count", code == 0)
code, said, _ = run("0.6.6", table(here="v1.0\nbuild-50-test\nbuild-x\nbuild-50\n"), "unpublished", "51")
check("tags that aren't build-N are left out", code == 0)
code, said, _ = run("0.6.6", table(here=""), "unpublished", "51")
check("no releases here yet: goes on", code == 0)
bad = table()
bad[OLD_R] = [1, "gh: Server Error (HTTP 502)"]
code, said, _ = run("0.6.6", bad, "unpublished", "51")
check(f"the old repo's list unreadable: stops (never guesses) ({said})", code == 1 and "Couldn't read" in said)
bad = table()
bad[REFS] = [1, "gh: Forbidden (HTTP 403)"]
code, said, _ = run("0.6.6", bad, "unpublished", "51")
check("the tags unreadable: stops", code == 1)

# ---- extension: browser/ changed since the newest release → its version went up
import base64, hashlib
def sha(b):  # git's id of some bytes, as GitHub's tree lists it
    return hashlib.sha1(b"blob %d\0" % len(b) + b).hexdigest()
def manifest(v):  # a manifest.json saying version v
    return json.dumps({"name": "x", "version": v}).encode()
TAG_Q = "repos/me/thinky/releases/latest"
TREE = "repos/me/thinky/git/trees/build-57:browser?recursive=1"
OLD_MANIFEST = "repos/me/thinky/contents/browser/manifest.json?ref=build-57"
def ext_table(files, old_version):
    """GitHub's answers when release build-57 had `files` ({path: bytes}) with that manifest version."""
    lines = "".join(f"{sha(b)} {p}\n" for p, b in files.items())
    return {TAG_Q: [0, "build-57\n"], TREE: [0, lines],
            OLD_MANIFEST: [0, base64.b64encode(manifest(old_version)).decode() + "\n"]}
then = {"manifest.json": manifest("1.1.1"), "page.js": b"a", "icons/32.png": b"png"}
code, said, calls = run("0.6.8", ext_table(then, "1.1.1"), "extension", "--main", browser=then)
check(f"extension unchanged: goes on, asks only the release's list ({said})", code == 0 and "unchanged since build-57 (version 1.1.1)" in said
      and [c[1] for c in calls] == [TAG_Q, TREE])
now = dict(then, **{"page.js": b"b"})
code, said, _ = run("0.6.8", ext_table(then, "1.1.1"), "extension", "--main", browser=now)
check(f"a changed file with the same version stops main ({said})", code == 1 and "::error::The browser extension changed since build-57 (page.js)" in said)
code, said, _ = run("0.6.8", ext_table(then, "1.1.1"), "extension", browser=now)
check("…and only warns on a wip branch", code == 0 and "::warning::" in said)
now2 = dict(now, **{"manifest.json": manifest("1.1.2")})
code, said, _ = run("0.6.8", ext_table(then, "1.1.1"), "extension", "--main", browser=now2)
check(f"changed and raised: goes on ({said})", code == 0 and "version 1.1.2 (was 1.1.1 in build-57); changed: manifest.json, page.js" in said)
code, said, _ = run("0.6.8", ext_table(then, "1.1.10"), "extension", "--main", browser=now2)
check("versions compare as numbers (1.1.2 is lower than 1.1.10)", code == 1)
added = dict(then, **{"new.js": b"n"})
code, said, _ = run("0.6.8", ext_table(then, "1.1.1"), "extension", "--main", browser=added)
check("a new file counts as a change", code == 1 and "(new.js)" in said)
gone = {k: v for k, v in then.items() if k != "icons/32.png"}
code, said, _ = run("0.6.8", ext_table(then, "1.1.1"), "extension", "--main", browser=gone)
check("a removed file counts as a change", code == 1 and "(icons/32.png)" in said)
hidden = dict(then, **{".DS_Store": b"junk"})
code, said, _ = run("0.6.8", ext_table(then, "1.1.1"), "extension", "--main", browser=hidden)
check("a hidden file isn't part of it (the store package leaves it out)", code == 0)
bad = ext_table(then, "1.1.1")
bad[TREE] = [1, "gh: Not Found (HTTP 404)"]
code, said, _ = run("0.6.8", bad, "extension", "--main", browser=then)
check(f"the release's files unreadable: stops ({said})", code == 1 and "Couldn't read" in said)

# ---- build.yml runs these checks where they're needed (audit finding 11)
yml = open(os.path.join(HERE, "..", ".github", "workflows", "build.yml"), encoding="utf-8").read()
def job(name):
    """The text of one job of build.yml: from its name line to the next job's (two spaces in)."""
    start = yml.index(f"\n  {name}:\n")
    nxt = [i for i in (yml.find(f"\n  {j}", start + 1) for j in "abcdefghijklmnopqrstuvwxyz") if i > start]
    return yml[start:min(nxt) if nxt else len(yml)]
rel = job("release")
steps = rel.split("\n      - ")[1:]  # its steps, in order
check("release: the first step is the checkout (the checks' scripts)", steps[0].startswith("uses: actions/checkout@"))
check("release: the next one checks that build N isn't published yet, then the version, before anything else",
      "release_check.py unpublished" in steps[1] and "release_check.py version --main" in steps[1])
check("release: the build number comes from the number job's output, through env (not pasted into the script)",
      "N: ${{ needs.number.outputs.n }}" in steps[1] and 'unpublished "$N"' in steps[1])
check("release: it may read the releases (a token)", "GH_TOKEN: ${{ github.token }}" in steps[1])
check("release: publishing comes after the checks", -1 < rel.find("release_check.py unpublished") < rel.find("softprops/action-gh-release"))
check("number: the same version check (main stops, wip warns)", "release_check.py version" in job("number") and "--main" in job("number"))
check("number: the extension's version check too, with browser/ checked out", "release_check.py extension --main" in job("number")
      and "release_check.py extension;" in job("number") and "browser" in job("number").split("sparse-checkout:")[1].split("\n")[0])

# ---- what it's asked
for args in (["unpublished"], ["unpublished", "x"], ["unpublished", "0"], ["unpublished", "-3"], ["version", "--wip"], ["extension", "--wip"], [], ["publish"]):
    code, said, calls = run("0.6.6", table(), *args)
    check(f"refuses {args} and asks GitHub nothing", code != 0 and calls == [])

print("all passed" if not failed else f"{failed} failed")
sys.exit(1 if failed else 0)
