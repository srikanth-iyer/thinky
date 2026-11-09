"""Stamp the app's version into tauri.conf.json before a build (build.yml's windows and android jobs).

Since Build 41 the version is the one people see, from ui/version.js (read by update_sig.py's
`app_version`, the same rule the signing job uses), e.g. 0.5.2; any part of it may go up. Android's
versionCode is set from it explicitly (major * 1,000,000 + minor * 1,000 + patch, Tauri's own default
rule, so it always rises with the version: 0.1.40 was 1040, 0.5.2 is 5002). The build number N (one
more than the newest release, from the `number` job) goes into ui/build.js for the app to show
("0.5.2 · Build 41"). The version is also a step output (`version`), for the job that signs."""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from update_sig import app_version

n = os.environ.get("BUILD_NUMBER") or os.environ.get("GITHUB_RUN_NUMBER", "0")
if not n.isdigit():
    sys.exit(f"not a build number: {n!r}")
version = app_version()
major, minor, patch = (int(x) for x in version.split("."))
p = "src-tauri/tauri.conf.json"
c = json.load(open(p))
c["version"] = version
c.setdefault("bundle", {}).setdefault("android", {})["versionCode"] = major * 1_000_000 + minor * 1_000 + patch
json.dump(c, open(p, "w"), indent=2)
with open("ui/build.js", "w", newline="\n") as f:
    f.write(f"// Made by scripts/ci_version.py for this build (the repository's copy says null: a test or preview build).\nexport const BUILD = {int(n)};\n")
print("version", version, "build", n, "versionCode", c["bundle"]["android"]["versionCode"])
print(f"::notice title=App version::{version} (build {n}, Android versionCode {c['bundle']['android']['versionCode']})")
if os.environ.get("GITHUB_OUTPUT"):
    with open(os.environ["GITHUB_OUTPUT"], "a") as f:
        f.write(f"version={version}\n")
