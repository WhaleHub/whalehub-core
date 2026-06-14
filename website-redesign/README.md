# WhaleHub — Marketing Landing / Home Page

The redesigned public **home page** for whalehub.io (replaces the old Webflow site).
Built on the WhaleHub design system (deep-navy + teal `#00CC99`, Poppins/Inter), self-contained.

**Entry point:** [`index.html`](./index.html) — this is the home page.

## Run it
```bash
# from this folder
node serve.cjs        # serves on http://127.0.0.1:5500  (recommended)
```
Then open http://127.0.0.1:5500 — everything works, including the live APY fetch.

You can also just open `index.html` directly in a browser (the live-APY fetch falls back to a
static value; fonts/icons load from CDN).

## Structure
- `index.html` — the page (HTML + CSS + JS, single file)
- `styles.css` + `tokens/` — the WhaleHub design-system tokens (colors, type, spacing, effects)
- `assets/` — logos, 3D coins, Whaley banner, flywheel, ocean motifs, social icons, white logo variants
- `apy.json` — the live "Current APY" value (auto-updated, see below)

## Sections
Hero (Enhanced staking & compounding) → trust strip → How it works (flywheel) →
Why not just earn on Aquarius directly? (comparison) → Built natively on Stellar →
BLUB token (AQUA→BLUB connector) → Join the pod (Whaley) → footer.

## Live APY
The hero + comparison "Live APY" show the real number the dApp renders. A scheduled GitHub
Action (`.github/workflows/live-apy.yml`) runs `scripts/fetch-live-apy.cjs` hourly, reads
`app.whalehub.io/stake/aqua`, and commits `apy.json`. The page fetches it (fallback baked in).
