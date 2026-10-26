"""Stamp the build number into tauri.conf.json (0.1.<N>) so each Android build installs as an update.
N is the release number from build.yml's `number` job (one more than the newest release).
The version is also a step output (`version`), for the job that signs the Windows installer."""
import json, os
p = "src-tauri/tauri.conf.json"
c = json.load(open(p))
run = os.environ.get("BUILD_NUMBER") or os.environ.get("GITHUB_RUN_NUMBER", "0")
major, minor, _ = c["version"].split(".")
c["version"] = f"{major}.{minor}.{run}"
json.dump(c, open(p, "w"), indent=2)
print("version", c["version"])
print(f"::notice title=App version::{c['version']}")
if os.environ.get("GITHUB_OUTPUT"):
    with open(os.environ["GITHUB_OUTPUT"], "a") as f:
        f.write(f"version={c['version']}\n")
