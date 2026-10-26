"""Sample vault for UI tests (dates relative to today)."""
import os, sys, shutil, datetime, base64
V = sys.argv[1]
shutil.rmtree(V, ignore_errors=True)
for d in ["logseq", "pages", "Diary", "assets"]:
    os.makedirs(os.path.join(V, d))
def w(rel, text):
    with open(os.path.join(V, rel), "w", newline="") as f:
        f.write(text)
open(os.path.join(V, "logseq/config.edn"), "w").write('''{:meta/version 1
 :journals-directory "Diary"
 :journal/page-title-format "MMMM do, yyyy"
 :journal/file-name-format "MMMM do, yyyy"
 :preferred-workflow :todo
 :favorites ["Sourdough Bread" "to read"]
 :quick-capture-templates {:text "**{time}** [[quick capture]]: #inbox {text} {url}"
                           :media "**{time}** [[quick capture]]: #inbox {url}"}
 :quick-capture-options {:insert-today? true :redirect-page? false :default-page "quick capture"}
 :shortcuts {:editor/move-block-up "shift+ctrl+up" :editor/move-block-down "shift+ctrl+down" :editor/highlight "ctrl+h"}
}
''')
today = datetime.date.today()
def title(d):
    suf = "th" if 11 <= d.day % 100 <= 13 else {1: "st", 2: "nd", 3: "rd"}.get(d.day % 10, "th")
    return d.strftime("%B ") + f"{d.day}{suf}, {d.year}"
def stamp(d):
    return d.strftime("%Y-%m-%d %a")
y1 = today - datetime.timedelta(days=1)
w(f"Diary/{title(today)}.md", "- Reading [[The Patient Baker]] by [[Marta Pell]] #reading\n\t- cold-proving is the key idea\n- TODO email [[Rosa Penhallow]] about the spice order\n- DONE submit market order\n- Meeting notes\n\tproject:: [[Pickles in brine]]\n\tstatus:: done\n\t- Jars seal better with **less salt**\n")
w(f"Diary/{title(y1)}.md", "- Walked to the bakery, thought about [[Dumplings recipe]] fillings\n- LATER read ==Bramble== on jars #reading\n")
w(f"Diary/{title(today.replace(year=today.year-1))}.md", "- A year ago today I baked my first loaf\n")
w("Diary/March 3rd, 2020.md", "Notes from the old app, before this one. [[Sourdough Bread]]")
w("pages/Sourdough Bread.md", "alias:: SB\ntags:: baking, [[home cooking]]\nstatus:: active\n\n- Mix, fold, rest, shape\n\t- [[Crumb texture chart]] is the guide\n\t- loaf 42 is #high-hydration\n\t  collapsed:: true\n\t\t- hidden child\n- # Reading list\n\t- [[Hartley]] — A Year of Baking\n")
w("pages/Pickles in brine.md", "tags:: baking\n\n- Testing three brines in glass jars\n- Helpers: [[Rosa Penhallow]], [[Tobias Wren Okafor]]\n")
w("pages/Rosa Penhallow.md", "tags:: people\n\n- Baker at Millbrook, [[Apron club]]\n")
w("pages/Marta Pell.md", "- Wrote Notes on Wild Yeast\n")
w("pages/Notes on Pell.md", "- marta pell argued for folding\n- A block with an id\n  id:: 6528aaaa-bbbb-4ccc-8ddd-eeeeffff6666\n- third block\n")
w("pages/Tasks.md", f"- TODO [#A] overdue thing\n  SCHEDULED: <{stamp(today - datetime.timedelta(days=3))}>\n- DOING today thing\n  DEADLINE: <{stamp(today)}>\n- LATER next week thing\n  SCHEDULED: <{stamp(today + datetime.timedelta(days=5))} .+1w>\n- WAITING undated thing\n- DONE finished thing\n")
w("pages/Templates.md", "- meeting\n  template:: Meeting\n\t- Attendees::\n\t- Notes from <% today %>\n")
w("pages/Maths.md", "- Fraction $\\frac{a}{b}$ and $x_i^2$ and $\\alpha + \\beta$\n- $$\\begin{bmatrix} 1 & 2 \\\\ 3 & 4 \\end{bmatrix}$$\n- Price $5 and $10 is money, not maths\n")
from PIL import Image, ImageDraw
im = Image.new("RGB", (160, 80), "#0B7B66"); ImageDraw.Draw(im).ellipse((50, 10, 110, 70), fill="#FBEFC0")
im.save(os.path.join(V, "assets/dot.png"))
w("pages/Pictures.md", "- A picture: ![dot](../assets/dot.png)\n")
w("pages/APRON.md", "- The kitchen\n")
w("pages/APRON___Spice jars.md", "- jars work\n")
w("pages/APRON___Spice jars___notes.md", "- deeper notes\n")
w("pages/Dumplings recipe.md", "- Step-by-step fermentation menu\n\t- cooked in bamboo steamers\n")
w("pages/Orphan page.md", "- nobody links here\n")
w("pages/Market stall.md", "[[Shopping]] \nOnions from the stall.\n\nLast thought.")
print("ok", title(today))
