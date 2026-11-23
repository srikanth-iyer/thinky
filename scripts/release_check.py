"""Checks before a release (build.yml), reading GitHub's releases with the `gh` command line:

  release_check.py version [--main]
      ui/version.js's version must be higher than the newest release's ("Build N · version X"):
      installed apps only take a higher version. On main (--main) a lower or equal one stops the job;
      on a wip branch it only warns. The `number` job runs it, and `release` again just before it
      publishes.
  release_check.py unpublished N
      Build N may still be published: no tag build-N here yet, and no release build-M with M >= N
      here or on the old downloads repo ($OLD_RELEASES). The `release` job runs it first (audit
      finding 11): re-running an old, cancelled run ("Re-run failed jobs") reuses its saved build
      number and skips the `number` job, so without this it could publish an old version over a
      newer release that took that number, and make it the latest download.

Any answer from GitHub that can't be read stops it (it never guesses "nothing there").
Tested by scripts/release_check_test.py (a stand-in `gh`); CI's `test` job and pr.yml run that."""
import os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))  # this script's folder (scripts/)
sys.path.insert(0, HERE)  # so update_sig.py next to it can be imported
from update_sig import app_version  # ui/version.js's version, read as the build and the signing read it


def gh(*args):
    """What `gh api ARGS` printed; stops (exit 1) when it fails (no answer, no rights, not found)."""
    r = subprocess.run(["gh", "api", *args], capture_output=True, text=True)  # ask GitHub
    if r.returncode != 0:
        # (an error from GitHub's side, printed as a GitHub Actions error line, and the job stops)
        address = next((a for a in args if a.startswith("repos/")), " ".join(args))  # what was asked for
        print(f"::error::Couldn't read {address} from GitHub: {(r.stderr or r.stdout).strip()}")
        sys.exit(1)
    return r.stdout


def version_tuple(v):
    """"0.6.5" → (0, 6, 5), so versions compare part by part as numbers."""
    return tuple(int(x) for x in v.split("."))


def check_version(main):
    """`version`: this build's version must be higher than the newest release's."""
    v = app_version()  # this build's version, from ui/version.js
    repo = os.environ["GITHUB_REPOSITORY"]  # this repository, "owner/name" (set by GitHub Actions)
    name = gh(f"repos/{repo}/releases/latest", "--jq", ".name").strip()  # the newest release's title
    m = re.search(r"version (\d+\.\d+\.\d+)", name)  # its version ("Build 50 · version 0.6.5")
    last = m.group(1) if m else ""  # "" when the title names none (releases before Build 41)
    if last and not version_tuple(v) > version_tuple(last):
        msg = f"ui/version.js says {v}, but the newest release is already version {last}: raise it (installed apps only take a higher version)."
        if main:
            print(f"::error::{msg}")  # main: a release would go out that no installed app takes
            sys.exit(1)
        print(f"::warning::{msg}")  # wip: a test build, only a warning
    print(f"::notice title=Version::{v} (the newest release: {last or 'none named'})")


def build_numbers(repo):
    """Every release's build number (tags build-N) in `repo`, all pages of the list."""
    tags = gh("--paginate", f"repos/{repo}/releases?per_page=100", "--jq", ".[].tag_name").split()
    return [int(t[len("build-"):]) for t in tags if re.fullmatch(r"build-[0-9]+", t)]


def check_unpublished(n):
    """`unpublished N`: build N is not published yet, and no newer build is."""
    repo = os.environ["GITHUB_REPOSITORY"]  # this repository
    tag = f"build-{n}"  # the tag this release would get
    # the tag itself, even without a release (a release made and then deleted leaves it)
    refs = gh(f"repos/{repo}/git/matching-refs/tags/{tag}", "--jq", ".[].ref").split()
    if f"refs/tags/{tag}" in refs:  # (matching-refs also lists build-{n}0 and so on: exact name only)
        print(f"::error::The tag {tag} already exists here, so this run's files would go over that release. Not publishing (was an older run re-run?).")
        sys.exit(1)
    # a release with this number or a higher one, here or where Build 33 and older look
    for r in [repo, os.environ.get("OLD_RELEASES", "")]:
        if not r:
            continue  # no old downloads repo named
        higher = [b for b in build_numbers(r) if b >= n]  # releases this build would not be newer than
        if higher:
            print(f"::error::{r} already has build-{max(higher)}, and this run is build {n}. Not publishing an older run over a newer release (was an older run re-run?).")
            sys.exit(1)
    print(f"::notice title=Release number::build {n} isn't published yet, and no newer build is")


a = sys.argv[1:]  # what the script was asked to do
if a[:1] == ["version"] and a[1:] in ([], ["--main"]):
    check_version(main=a[1:] == ["--main"])
elif a[:1] == ["unpublished"] and len(a) == 2 and a[1].isdigit() and int(a[1]) > 0:
    check_unpublished(int(a[1]))
else:
    sys.exit(__doc__)  # anything else: how to use it, and a failure
