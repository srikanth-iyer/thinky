"""Makes ui/brand/wordmark.svg (and, if asked, wordmark-link.svg, unused: he didn't want [[thinky]]): the name "thinky" in Reenie Beanie, turned
into outlines once, so the app never ships the font (Oct 29, 2026: his logo, option 10, and
"[[thinky]]", option 17, of the "scribbly letters" board).

What the board's CSS did, redone here: Reenie Beanie at 104px (90px for [[thinky]]), line-height 1,
a 1.5px outline in the ink colour (-webkit-text-stroke), leaned with skewX(-14deg); "th" + a dotless
"ı" whose dot is a red four-point spark (0.3em square, centred over the ı, 0.06em below the line
box's top) + "nky"; the [[ ]] red, letter-spacing -0.14em, .04em after "[[" and .02em before "]]".
The letters use currentColor (the look's ink when drawn with <use>); the spark and brackets are red.

Get the font from npm (Google Fonts is blocked in the cloud workspace) and run:
  npm pack @fontsource/reenie-beanie && tar xzf fontsource-reenie-beanie-*.tgz
  python3 scripts/make_wordmark.py package/files/reenie-beanie-latin-400-normal.woff2
"""
import math, sys
from fontTools.ttLib import TTFont
from fontTools.pens.basePen import BasePen

INK, RED = "#1D1A2E", "#FF4B2B"
SK = math.tan(math.radians(14))  # skewX(-14deg): x' = x - SK*y (y down), so the top leans right
EM = 100  # path units: 1em = 100, so one decimal = one font unit


def n(v):
    """A number with one decimal at most, as short as it can be written."""
    t = f"{v:.1f}".rstrip("0").rstrip(".")
    t = "0" if t == "-0" else t
    return t.replace("0.", ".", 1) if t.startswith(("0.", "-0.")) else t


def join(nums):
    """Numbers with the fewest separators SVG needs: none before a minus sign."""
    out = ""
    for t in nums:
        out += t if not out or t.startswith("-") else " " + t
    return out


class Pen(BasePen):
    """SVG path data in em/100 units, y down, baseline at 0, the lean baked in; `x0` is where the
    next glyph starts. Relative commands (from the last point, worked out on the rounded numbers so
    nothing drifts), a repeated command letter left out: the files stay small. One pen per path,
    so each glyph's first move is relative to where the one before ended."""
    def __init__(self, gs, k):
        super().__init__(gs); self.d = []; self.x0 = 0; self.k = k; self.pts = []
        self.at = (0, 0); self.start = (0, 0); self.last = None
    def r(self, pt):
        x, y = self.x0 + pt[0] * self.k, -pt[1] * self.k
        x -= SK * y
        self.pts.append((x, y))
        return round(x * 10), round(y * 10)  # tenths
    def rel(self, cmd, pts):
        base = self.at
        body = join([n((c - b) / 10) for q in pts for c, b in zip(q, base)])
        sep = cmd if cmd != self.last or cmd == "m" else ("" if body.startswith("-") else " ")
        self.d.append(sep + body); self.at = pts[-1]; self.last = cmd
    def _moveTo(self, pt): self.rel("m", [self.r(pt)]); self.start = self.at
    def _lineTo(self, pt): self.rel("l", [self.r(pt)])
    def _curveToOne(self, a, b, c): self.rel("c", [self.r(q) for q in (a, b, c)])
    def _qCurveToOne(self, a, b): self.rel("q", [self.r(a), self.r(b)])
    def _closePath(self): self.d.append("z"); self.at = self.start; self.last = "z"


def spark(cx, top, size):
    """#sc-dot (M12 0Q12 12 24 12Q12 12 12 24Q12 12 0 12Q12 12 12 0Z, a 24 box) at that place."""
    k = size / 24
    def p(x, y):
        X, Y = cx - size / 2 + x * k, top + y * k
        return f"{n(X - SK * Y)} {n(Y)}", (X - SK * Y, Y)
    pts = [(12, 0), (12, 12), (24, 12), (12, 12), (12, 24), (12, 12), (0, 12), (12, 12), (12, 0)]
    s = [p(*q) for q in pts]
    d = "M" + s[0][0] + "".join(f"Q{s[i][0]} {s[i + 1][0]}" for i in (1, 3, 5, 7)) + "Z"
    return d, [q[1] for q in s]


def build(font, text, px, link):
    gs = font.getGlyphSet(); cmap = font.getBestCmap(); hmtx = font["hmtx"]
    upm = font["head"].unitsPerEm; asc = font["hhea"].ascent / upm * EM
    k = EM / upm
    stroke = 1.5 / px * EM  # 1.5px at the board's size, in em/100
    x = 0.0; inkp, redp = Pen(gs, k), Pen(gs, k); pts_all = []
    spark_d = None
    for i, ch in enumerate(text):
        if link and i == 2: x += 0.04 * EM
        if link and ch == "]" and text[i - 1] != "]": x += 0.02 * EM
        g = cmap[ord(ch)]
        pen = redp if ch in "[]" else inkp
        pen.x0 = x; gs[g].draw(pen)
        adv = hmtx[g][0] * k
        if ch == "ı":  # the dot: a spark centred over the ı, 0.06em below the line box's top
            spark_d, sp = spark(x + adv / 2, -asc + 0.06 * EM, 0.3 * EM); pts_all += sp
        x += adv + (-0.14 * EM if ch in "[]" else 0)
    pts_all += inkp.pts + redp.pts
    ink, red = inkp.d, redp.d
    pad = stroke / 2 + 0.5
    xs = [p[0] for p in pts_all]; ys = [p[1] for p in pts_all]
    vb = (math.floor(min(xs) - pad), math.floor(min(ys) - pad))
    vb += (math.ceil(max(xs) + pad) - vb[0], math.ceil(max(ys) + pad) - vb[1])
    return ink, red, spark_d, stroke, vb


def svg(font, text, px, link, label):
    ink, red, sp, stroke, vb = build(font, text, px, link)
    vbs = " ".join(str(v) for v in vb)
    sw = f'stroke-width="{stroke:.2f}" stroke-linejoin="round"'
    body = f'<path fill="currentColor" stroke="currentColor" {sw} d="{"".join(ink)}"/>'
    if red:
        body += f'<path fill="{RED}" stroke="{RED}" {sw} d="{"".join(red)}"/>'
    body += f'<path fill="{RED}" d="{sp}"/>'
    # a <symbol> for <use href="brand/….svg#m"> (the ink follows the look's colour), shown in the
    # ink colour when the file is opened on its own
    # (the outer box starts at 0 0: a <use> of a symbol fills the box from the user space's 0 0)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {vb[2]} {vb[3]}" width="{vb[2]}" height="{vb[3]}" role="img" aria-label="{label}">'
            f'<symbol id="m" viewBox="{vbs}">{body}</symbol><use href="#m" color="{INK}"/></svg>\n')


if __name__ == "__main__":
    f = TTFont(sys.argv[1])
    out = sys.argv[2] if len(sys.argv) > 2 else "ui/brand"
    open(f"{out}/wordmark.svg", "w").write(svg(f, "thınky", 104, False, "thinky"))
    open(f"{out}/wordmark-link.svg", "w").write(svg(f, "[[thınky]]", 90, True, "[[thinky]]"))
    print("written", out)
