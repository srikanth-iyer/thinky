"""Write a small sample vault (journals in Diary/, 'MMMM do, yyyy') and print today's journal name."""
import datetime, os, sys
root = sys.argv[1]
for d in ("logseq", "pages", "Diary"):
    os.makedirs(os.path.join(root, d), exist_ok=True)
def name(d):
    suf = "th" if 11 <= d.day % 100 <= 13 else {1: "st", 2: "nd", 3: "rd"}.get(d.day % 10, "th")
    return f"{d.strftime('%B')} {d.day}{suf}, {d.year}"
today = datetime.date.today()
files = {
    "logseq/config.edn": '{:journals-directory "Diary"\n :journal/page-title-format "MMMM do, yyyy"\n :journal/file-name-format "MMMM do, yyyy"}\n',
    f"Diary/{name(today)}.md": "- Reading [[The Patient Baker]] by [[Marta Pell]] #reading\n\t- cold-proving is the key idea\n\t- goes well with [[Sourdough Bread]] too\n- TODO email [[Rosa Penhallow]] about the spice order\n",
    f"Diary/{name(today - datetime.timedelta(days=1))}.md": "- Walked to the bakery, thought about [[Dumplings recipe]]\n- LATER read ==Bramble== on jars #reading\n",
    "pages/Sourdough Bread.md": "alias:: SB\ntags:: baking\n\n- Mix, fold, rest, shape\n\t- [[Crumb texture chart]] is the guide\n"
        f"- TODO redo the tasting\n  SCHEDULED: <{today.isoformat()} {today.strftime('%a')}>\n",
    "pages/Plain note.md": "Written in another app, no bullets. Mentions [[Sourdough Bread]].",
    # where shared notes go (Logseq's default); no final line break, which adding must keep
    "pages/quick capture.md": "- written before the share",
}
# a month of older days, so scrolling the journals has more to load
for k in range(2, 32):
    d = today - datetime.timedelta(days=k)
    files[f"Diary/{name(d)}.md"] = f"- Day {k}: cooked the [[Dumplings recipe]] again\n\t- batch {k} came out well\n- Read a chapter of Bramble\n- Walked {k % 5 + 1} km\n"
for rel, text in files.items():
    with open(os.path.join(root, rel), "w") as f:
        f.write(text)
print(name(today))
