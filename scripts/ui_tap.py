"""Tap the first on-screen element whose text contains (or, with --exact, equals) the given text."""
import re, subprocess, sys, time
want, exact = sys.argv[1].lower(), "--exact" in sys.argv
def nodes():
    subprocess.run(["adb", "shell", "uiautomator", "dump", "/sdcard/ui.xml"], capture_output=True)
    xml = subprocess.run(["adb", "shell", "cat", "/sdcard/ui.xml"], capture_output=True, text=True).stdout
    for m in re.finditer(r"<node [^>]*>", xml):
        n = m.group(0)
        label = " ".join(x.group(1) for x in re.finditer(r' (?:text|content-desc)="([^"]*)"', n)).strip().lower()
        b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
        if label and b:
            yield label, tuple(map(int, b.groups()))
for attempt in range(6):
    for label, (x1, y1, x2, y2) in nodes():
        if (label == want) if exact else (want in label):
            subprocess.run(["adb", "shell", "input", "tap", str((x1 + x2) // 2), str((y1 + y2) // 2)])
            print(f"tapped '{label}' at {(x1 + x2) // 2},{(y1 + y2) // 2}")
            sys.exit(0)
    time.sleep(1.5)
print(f"not found: {want}")
