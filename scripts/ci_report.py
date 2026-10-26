"""Size and speed check for CI (Markdown for the job summary, ::warning:: lines for growth).

  python3 scripts/ci_report.py bench <bench output file>
  python3 scripts/ci_report.py sizes <folder with the built files>
"""
import json, os, sys

base = json.load(open(os.path.join(os.path.dirname(__file__), "..", "ci", "baseline.json")))
kind, arg = sys.argv[1], sys.argv[2]
out = []
warn = []

def mb(n):
    return f"{n / 1e6:.2f} MB"

if kind == "sizes":
    out.append("### App size\n\n| File | Size | Reference | Change |\n|---|---:|---:|---:|")
    for name, ref in base["sizes"].items():
        p = os.path.join(arg, name)
        if not os.path.exists(p):
            out.append(f"| {name} | (not built) | {mb(ref)} | |")
            continue
        n = os.path.getsize(p)
        ch = (n - ref) / ref * 100
        out.append(f"| {name} | {mb(n)} | {mb(ref)} | {ch:+.1f}% |")
        # also as a notice: readable from the job's annotations (the summary isn't, from the API)
        print(f"::notice title=Size of {name}::{n} bytes ({mb(n)}, {ch:+.1f}% vs the reference)", file=sys.stderr)
        if n > ref * base["size_warn_ratio"]:
            warn.append(f"{name} grew to {mb(n)} ({ch:+.1f}% vs {mb(ref)})")
elif kind == "bench":
    line = next((l for l in open(arg) if l.startswith("BENCH ")), None)
    if not line:
        print("::warning::speed check produced no result")
        sys.exit(0)
    got = json.loads(line[6:])
    out.append("### Speed (sample vault: 930 pages + 600 journals)\n\n| Step | Time | Reference |\n|---|---:|---:|")
    for k, v in got.items():
        ref = base["bench"].get(k)
        out.append(f"| {k.replace('_ms', '').replace('_', ' ')} | {v:.2f} ms | {ref if ref is not None else '–'} ms |")
        if ref and v > ref * base["bench_warn_ratio"]:
            warn.append(f"{k} took {v:.1f} ms (reference {ref} ms)")
print("\n".join(out) + "\n")
for w in warn:
    print(f"::warning::{w}", file=sys.stderr)
    print(f"> ⚠️ {w}\n")
