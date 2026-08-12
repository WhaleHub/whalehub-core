#!/usr/bin/env python3
"""Generate print-ready inline SVG charts for the SCF proposal PDF.

No matplotlib on this machine, so coordinates are computed here and emitted as
hand-built SVG. Everything is vector, so it stays sharp in the PDF.
"""

INK = "#12202b"
INK2 = "#5a6b7c"
INK3 = "#8c9aa8"
GRID = "#dfe6ec"
TEAL = "#0d7a63"
TEAL_L = "#d9efe9"
BLUE = "#2a6f9e"
AMBER = "#a8700c"
RED = "#b23528"

out = {}

# ─────────────────────────────────────────────────────────────────────────────
# CHART 1 — net APY vs borrow rate, L = 2.5, for three LP-yield levels.
# The teaching point: leverage beats unleveraged exactly while borrow < LP APY.
# ─────────────────────────────────────────────────────────────────────────────
W, H = 760, 340
ml, mr, mt, mb = 58, 132, 18, 46
pw, ph = W - ml - mr, H - mt - mb
XMAX, YMIN, YMAX = 24.0, -12.0, 52.0
L = 2.5


def x(v):
    return ml + v / XMAX * pw


def y(v):
    return mt + (YMAX - v) / (YMAX - YMIN) * ph


s = [f'<svg viewBox="0 0 {W} {H}" xmlns="http://www.w3.org/2000/svg" role="img">']
s.append('<rect width="100%" height="100%" fill="#fff"/>')

# zero line + gridlines
for gv in (-10, 0, 10, 20, 30, 40, 50):
    yy = y(gv)
    strong = gv == 0
    s.append(
        f'<line x1="{ml}" y1="{yy:.1f}" x2="{ml+pw}" y2="{yy:.1f}" '
        f'stroke="{INK2 if strong else GRID}" stroke-width="{1.1 if strong else 0.8}"/>'
    )
    s.append(
        f'<text x="{ml-9}" y="{yy+3.6:.1f}" text-anchor="end" font-size="10.5" '
        f'fill="{INK3}" font-family="monospace">{gv}%</text>'
    )
for gv in range(0, 25, 4):
    xx = x(gv)
    s.append(f'<line x1="{xx:.1f}" y1="{mt}" x2="{xx:.1f}" y2="{mt+ph}" stroke="{GRID}" stroke-width="0.8"/>')
    s.append(
        f'<text x="{xx:.1f}" y="{mt+ph+17}" text-anchor="middle" font-size="10.5" '
        f'fill="{INK3}" font-family="monospace">{gv}%</text>'
    )

series = [(20, TEAL), (15, BLUE), (10, AMBER)]
for lp, col in series:
    pts = []
    for i in range(0, 241):
        b = i * XMAX / 240
        net = lp * L - b * (L - 1)
        if net < YMIN:
            continue
        pts.append(f"{x(b):.1f},{y(net):.1f}")
    s.append(f'<polyline points="{" ".join(pts)}" fill="none" stroke="{col}" stroke-width="2.4"/>')
    # unleveraged baseline
    s.append(
        f'<line x1="{ml}" y1="{y(lp):.1f}" x2="{ml+pw}" y2="{y(lp):.1f}" '
        f'stroke="{col}" stroke-width="1.1" stroke-dasharray="4 3" opacity="0.55"/>'
    )
    # crossing point: leverage == unleveraged at borrow == LP
    s.append(f'<circle cx="{x(lp):.1f}" cy="{y(lp):.1f}" r="3.6" fill="#fff" stroke="{col}" stroke-width="2"/>')
    # right-edge labels
    s.append(
        f'<text x="{ml+pw+10}" y="{y(lp*L - XMAX*(L-1))+3.6:.1f}" font-size="10.5" fill="{col}" '
        f'font-family="monospace">LP {lp}% · 2.5x</text>'
    )

# legend note pinned top-right: the LP-10% series label lands near the baseline,
# so keeping this at the bottom collided with it.
s.append(
    f'<text x="{ml+pw+10}" y="{mt+12}" font-size="9.5" fill="{INK3}" font-family="monospace">'
    f'dashed = unleveraged</text>'
)
s.append(
    f'<text x="{ml+pw/2}" y="{H-7}" text-anchor="middle" font-size="10.5" fill="{INK2}">'
    f'USDC borrow APR</text>'
)
s.append(
    f'<text x="14" y="{mt+ph/2}" font-size="10.5" fill="{INK2}" transform="rotate(-90 14 {mt+ph/2})" '
    f'text-anchor="middle">net APY on equity</text>'
)
s.append("</svg>")
out["apy"] = "\n".join(s)

# ─────────────────────────────────────────────────────────────────────────────
# CHART 2 — max leverage implied by collateral factor, with the launch band
# and the contract's current (too-high) cap marked.
# ─────────────────────────────────────────────────────────────────────────────
W2, H2 = 760, 258
ml2, mr2, mt2, mb2 = 58, 26, 20, 46
pw2, ph2 = W2 - ml2 - mr2, H2 - mt2 - mb2
CFMIN, CFMAX, LMAX = 0.35, 0.85, 7.0


def x2(v):
    return ml2 + (v - CFMIN) / (CFMAX - CFMIN) * pw2


def y2(v):
    return mt2 + (LMAX - v) / (LMAX - 1.0) * ph2


s = [f'<svg viewBox="0 0 {W2} {H2}" xmlns="http://www.w3.org/2000/svg" role="img">']
s.append('<rect width="100%" height="100%" fill="#fff"/>')

# launch band 0.50–0.60
s.append(
    f'<rect x="{x2(0.50):.1f}" y="{mt2}" width="{x2(0.60)-x2(0.50):.1f}" height="{ph2}" '
    f'fill="{TEAL_L}"/>'
)
s.append(
    f'<text x="{(x2(0.50)+x2(0.60))/2:.1f}" y="{mt2+13}" text-anchor="middle" font-size="9.5" '
    f'fill="{TEAL}" font-family="monospace">launch band</text>'
)

for gv in (1, 2, 3, 4, 5, 6, 7):
    yy = y2(gv)
    s.append(f'<line x1="{ml2}" y1="{yy:.1f}" x2="{ml2+pw2}" y2="{yy:.1f}" stroke="{GRID}" stroke-width="0.8"/>')
    s.append(
        f'<text x="{ml2-9}" y="{yy+3.6:.1f}" text-anchor="end" font-size="10.5" fill="{INK3}" '
        f'font-family="monospace">{gv}.0x</text>'
    )
for gv in (0.4, 0.5, 0.6, 0.7, 0.8):
    xx = x2(gv)
    s.append(f'<line x1="{xx:.1f}" y1="{mt2}" x2="{xx:.1f}" y2="{mt2+ph2}" stroke="{GRID}" stroke-width="0.8"/>')
    s.append(
        f'<text x="{xx:.1f}" y="{mt2+ph2+17}" text-anchor="middle" font-size="10.5" fill="{INK3}" '
        f'font-family="monospace">{gv:.2f}</text>'
    )

pts = []
for i in range(0, 201):
    cf = CFMIN + i * (CFMAX - CFMIN) / 200
    lv = 1 / (1 - cf)
    if lv > LMAX:
        continue
    pts.append(f"{x2(cf):.1f},{y2(lv):.1f}")
s.append(f'<polyline points="{" ".join(pts)}" fill="none" stroke="{INK}" stroke-width="2.4"/>')

# current contract cap 3.0x — above the band
s.append(
    f'<line x1="{ml2}" y1="{y2(3.0):.1f}" x2="{ml2+pw2}" y2="{y2(3.0):.1f}" '
    f'stroke="{RED}" stroke-width="1.6" stroke-dasharray="5 3"/>'
)
s.append(
    f'<text x="{ml2+pw2-6}" y="{y2(3.0)-7:.1f}" text-anchor="end" font-size="10" fill="{RED}" '
    f'font-family="monospace">contract cap today 3.0x — must come down</text>'
)
for cf, lab in ((0.50, "2.0x"), (0.60, "2.5x")):
    s.append(f'<circle cx="{x2(cf):.1f}" cy="{y2(1/(1-cf)):.1f}" r="4" fill="{TEAL}"/>')
    s.append(
        f'<text x="{x2(cf)+8:.1f}" y="{y2(1/(1-cf))+4:.1f}" font-size="10.5" fill="{TEAL}" '
        f'font-family="monospace" font-weight="600">{lab}</text>'
    )
s.append(
    f'<text x="{ml2+pw2/2}" y="{H2-7}" text-anchor="middle" font-size="10.5" fill="{INK2}">'
    f'Blend collateral factor on the LP reserve</text>'
)
s.append(
    f'<text x="14" y="{mt2+ph2/2}" font-size="10.5" fill="{INK2}" '
    f'transform="rotate(-90 14 {mt2+ph2/2})" text-anchor="middle">max leverage</text>'
)
s.append("</svg>")
out["lev"] = "\n".join(s)

# ─────────────────────────────────────────────────────────────────────────────
# CHART 3 — where $1,000 of user equity ends up at 2.5x.
# ─────────────────────────────────────────────────────────────────────────────
W3, H3 = 760, 168
s = [f'<svg viewBox="0 0 {W3} {H3}" xmlns="http://www.w3.org/2000/svg" role="img">']
s.append('<rect width="100%" height="100%" fill="#fff"/>')
# bw leaves room for the "= $2,500" total label after the bar without clipping the viewBox.
bx, bw = 150, 495
scale = bw / 2500.0
rows = [
    ("You deposit", [("equity $1,000", 1000, TEAL)], 30),
    ("Vault borrows", [("USDC debt $1,500", 1500, BLUE)], 74),
    ("LP exposure", [("equity $1,000", 1000, TEAL), ("debt $1,500", 1500, BLUE)], 118),
]
for label, segs, yy in rows:
    s.append(
        f'<text x="{bx-12}" y="{yy+19}" text-anchor="end" font-size="11.5" fill="{INK}" '
        f'font-weight="600">{label}</text>'
    )
    cx = bx
    for txt, val, col in segs:
        w = val * scale
        s.append(f'<rect x="{cx:.1f}" y="{yy}" width="{w:.1f}" height="28" fill="{col}" rx="2"/>')
        s.append(
            f'<text x="{cx+w/2:.1f}" y="{yy+18.5}" text-anchor="middle" font-size="10.5" '
            f'fill="#fff" font-family="monospace">{txt}</text>'
        )
        cx += w
    if label == "LP exposure":
        s.append(
            f'<text x="{cx+10:.1f}" y="{yy+18.5}" font-size="11.5" fill="{INK}" '
            f'font-weight="700" font-family="monospace">= $2,500</text>'
        )
s.append(
    f'<text x="{bx}" y="{H3-10}" font-size="10" fill="{INK3}">'
    f'2.5x leverage · collateral factor 0.60 · one signed transaction</text>'
)
s.append("</svg>")
out["pos"] = "\n".join(s)

# ─────────────────────────────────────────────────────────────────────────────
# CHART 4 — budget by deliverable, grouped by tranche.
# ─────────────────────────────────────────────────────────────────────────────
W4, H4 = 760, 340
s = [f'<svg viewBox="0 0 {W4} {H4}" xmlns="http://www.w3.org/2000/svg" role="img">']
s.append('<rect width="100%" height="100%" fill="#fff"/>')
items = [
    ("D1", "Fair-LP oracle adapter", 13500, TEAL),
    ("D2", "Fee & accounting module", 9800, TEAL),
    ("D3", "Per-user risk isolation", 16200, TEAL),
    ("D4", "Reference liquidator (OSS)", 12400, BLUE),
    ("D5", "Health keeper & monitoring", 10600, BLUE),
    ("D6", "Footprint & stress testing", 8900, BLUE),
    ("D7", "Security audit + remediation", 18000, AMBER),
    ("D8", "Frontend & Wallets Kit", 9400, AMBER),
    ("D9", "Mainnet launch & docs", 7200, AMBER),
]
lx, bxx = 34, 250
avail = W4 - bxx - 96
mx = max(v for _, _, v, _ in items)
for i, (code, name, val, col) in enumerate(items):
    yy = 26 + i * 33
    s.append(
        f'<text x="{lx}" y="{yy+15}" font-size="10.5" fill="{INK3}" font-family="monospace">{code}</text>'
    )
    s.append(f'<text x="{lx+30}" y="{yy+15}" font-size="11" fill="{INK}">{name}</text>')
    w = val / mx * avail
    s.append(f'<rect x="{bxx}" y="{yy+2}" width="{w:.1f}" height="21" fill="{col}" rx="2"/>')
    s.append(
        f'<text x="{bxx+w+9:.1f}" y="{yy+17}" font-size="10.5" fill="{INK}" '
        f'font-family="monospace">${val:,}</text>'
    )
for lbl, col, yy in (("Tranche 1", TEAL, 26), ("Tranche 2", BLUE, 125), ("Tranche 3", AMBER, 224)):
    s.append(f'<rect x="{lx-14}" y="{yy+2}" width="4" height="87" fill="{col}" rx="2"/>')
s.append(
    f'<text x="{bxx}" y="{H4-9}" font-size="11" fill="{INK}" font-weight="700" '
    f'font-family="monospace">Total requested $106,000</text>'
)
s.append(
    f'<text x="{lx}" y="{H4-9}" font-size="9.5" fill="{INK3}">Backstop capital excluded — treasury funded</text>'
)
s.append("</svg>")
out["budget"] = "\n".join(s)

import json, pathlib

pathlib.Path("charts.json").write_text(json.dumps(out))
print("charts written:", ", ".join(f"{k} ({len(v)}b)" for k, v in out.items()))
