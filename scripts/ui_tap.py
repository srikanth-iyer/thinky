"""Tap the first on-screen element whose text contains (or, with --exact, whose text or description
equals) the given text; with --last, the last one (drawn on top, e.g. in a pop-up menu); with --long,
press and hold it instead. Exits with 1 if there is none."""
import re, subprocess, sys, time
want, exact, hold, last = sys.argv[1].lower(), "--exact" in sys.argv, "--long" in sys.argv, "--last" in sys.argv
def nodes():
    subprocess.run(["adb", "shell", "uiautomator", "dump", "/sdcard/ui.xml"], capture_output=True)
    xml = subprocess.run(["adb", "shell", "cat", "/sdcard/ui.xml"], capture_output=True, text=True).stdout
    for m in re.finditer(r"<node [^>]*>", xml):
        n = m.group(0)
        names = [x.group(1).strip().lower() for x in re.finditer(r' (?:text|content-desc)="([^"]*)"', n)]
        label = " ".join(names).strip()
        b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
        if label and b:
            yield label, names, tuple(map(int, b.groups()))
for attempt in range(6):
    hits = [(label, box) for label, names, box in nodes() if ((want == label or want in names) if exact else (want in label))]
    if hits:
        label, (x1, y1, x2, y2) = hits[-1] if last else hits[0]
        x, y = (x1 + x2) // 2, (y1 + y2) // 2
        subprocess.run(["adb", "shell", "input", "swipe", str(x), str(y), str(x), str(y), "1200"] if hold else ["adb", "shell", "input", "tap", str(x), str(y)])
        print(f"{'held' if hold else 'tapped'} '{label}' at {x},{y}")
        sys.exit(0)
    time.sleep(1.5)
print(f"not found: {want}")
sys.exit(1)
