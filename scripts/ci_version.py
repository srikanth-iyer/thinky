"""Stamp the build number into tauri.conf.json (0.1.<run>) so each Android build installs as an update."""
import json, os
p = "src-tauri/tauri.conf.json"
c = json.load(open(p))
run = os.environ.get("GITHUB_RUN_NUMBER", "0")
major, minor, _ = c["version"].split(".")
c["version"] = f"{major}.{minor}.{run}"
json.dump(c, open(p, "w"), indent=2)
print("version", c["version"])
