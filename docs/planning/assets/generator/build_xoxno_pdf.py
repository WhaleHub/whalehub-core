#!/usr/bin/env python3
"""
Assemble the XOXNO wrapper assessment (print-targeted) and render it to PDF.

Usage:  python3 build_xoxno_pdf.py [dest.pdf]

Reuses the SCF proposal's print stylesheet (_shared_css.txt, extracted from
build_blend_pdf.py) so all three documents read as one house.

Facts read from mainnet and github.com/XOXNO/rs-lending-xlm on 1-2 Sep 2026.
"""
import pathlib, subprocess, sys

HERE = pathlib.Path(__file__).parent
DEST = pathlib.Path(sys.argv[1]).expanduser() if len(sys.argv) > 1 else (
    pathlib.Path.home() / "Downloads" / "WhaleHub_XOXNO_Wrapper_Assessment.pdf"
)

CSS = (HERE / "_shared_css.txt").read_text() + """
.q { margin:0 0 7pt; }
.q .qn { font-family:"SF Mono",Menlo,monospace; font-size:7.6pt; color:#0d7a63; letter-spacing:.08em; }
.q .qt { font-weight:700; }
.verdict { border:.9pt solid #0d7a63; background:#f2faf7; border-radius:3px;
           padding:8pt 10pt; margin:0 0 10pt; }
.verdict .vh { font-family:"SF Mono",Menlo,monospace; font-size:7.4pt; letter-spacing:.1em;
               text-transform:uppercase; color:#0d7a63; margin:0 0 3pt; }
.verdict p { margin:0; font-size:9.6pt; }
svg.fig { width:100%; height:auto; display:block; }
"""


def page(tag, body):
    return f'<section class="page"><p class="pagetag">{tag}</p>{body}</section>'


TAG = "WhaleHub &middot; XOXNO wrapper assessment &middot; 2 Sep 2026"

# ── page 1 — the proposal and the precedent ──────────────────────────────────
p1 = page(
    TAG,
    """
<p class="eyebrow">WhaleHub</p>
<h1>Should the leverage product become a wrapper on XOXNO?</h1>
<p class="dek">XOXNO's co-founder has proposed that WhaleHub stop building the leverage primitive and
instead run a fee-charging vault on top of their live Stellar lending protocol. The model is well
precedented on other chains. One detail of how it was framed is wrong, and correcting it materially
improves the deal.</p>

<div class="cover-meta">
  <div><p class="k">Verdict</p><p class="v">Viable</p></div>
  <div><p class="k">But not as</p><p class="v">A pooled DAO</p></div>
  <div><p class="k">Removes</p><p class="v">Oracle, pool, backstop</p></div>
  <div><p class="k">Unresolved</p><p class="v">Licence &middot; audit</p></div>
</div>

<hr class="rule">

<h2>What was proposed</h2>
<p>A WhaleHub contract holds <strong>a single position NFT carrying the entire collateral and debt
of every user arriving through us</strong>. Users pool funds into it DAO-style; because our contract
controls the inputs and outputs, we can charge whatever we like and derive fees from performance.
We would also route the leverage swaps through their aggregator and take a referral fee. Their
argument: months of complex work replaced by a wrapper on a soon-to-be-audited flow that already
includes swaps, strategies and LP pricing.</p>

<h2>The model is well precedented</h2>
<p>&ldquo;Charge a fee as a vault on top of someone else&rsquo;s lending primitive&rdquo; is an
established, large business on other chains.</p>

<table>
<tr><th>Protocol</th><th>Structure</th><th>Fee</th></tr>
<tr><td class="lab">Index Coop &mdash; ETH2x, icETH</td><td>One pooled leveraged CDP on Aave; holders own fungible ERC-20 shares</td><td>1.95&ndash;3.65% streaming + 0.10% mint/redeem</td></tr>
<tr class="hi"><td class="lab">MetaMorpho / Morpho Vaults</td><td>Curator vault over Morpho Blue markets; curator allocates but cannot withdraw user funds</td><td>Up to <b>50% of generated interest</b></td></tr>
<tr><td class="lab">Arrakis &middot; Gamma</td><td>One shared Uniswap v3 position, fungible shares, manager rebalances</td><td>Manager sets any share of LP fees</td></tr>
<tr><td class="lab">Kamino Multiply (Solana)</td><td>Leveraged looping via flash loans &mdash; but V2 moved <em>toward</em> isolated per-user mode</td><td>Minimal protocol fee</td></tr>
</table>

<p><strong>MetaMorpho is the business case</strong> &mdash; it shows a curator wrapper over someone
else&rsquo;s lending primitive is a real, large revenue line. <strong>Index Coop is the structural
match</strong> &mdash; it is precisely the pooled-position, fungible-share, sponsor-takes-a-fee shape
being proposed.</p>

<div class="note flag"><b>What Index Coop also shows.</b> A pooled leveraged product is not merely a
wrapper. FLI needed an automated rebalancing engine to hold target leverage, mint and redeem priced
off NAV so exits cannot harm the depositors who stay, and it still suffers volatility decay &mdash;
ETH2x-FLI was eventually superseded. That engine is hidden scope in the proposal as framed.</div>
""",
)

# ── page 2 — the flaw, with the scheme ───────────────────────────────────────
p2 = page(
    TAG,
    """
<h2>The flaw in the framing</h2>
<p>The proposal says we need one position NFT holding everything <em>so that</em> our contract
controls the flow and can charge fees. <strong>Those are two separable things, and their own
contract proves it.</strong> The mainnet controller exposes:</p>

<div class="eq">add_delegate(caller: Address, <em>delegate</em>: Address, account_id: u64)</div>

<p>A user can delegate <em>their own</em> account to our contract. So WhaleHub can give every user
their own position NFT, manage all of them through one router, and still control every deposit,
withdrawal and unwind &mdash; which is all that fee capture requires.</p>

<figure>
<svg class="fig" viewBox="0 0 640 146" xmlns="http://www.w3.org/2000/svg" role="img"
     aria-label="Two models compared. Pooled: three users deposit into one WhaleHub contract that holds a single position NFT, so one liquidation is shared by all three. Delegated: three users each hold their own position NFT and delegate control to a WhaleHub router, which still takes fees, and a liquidation touches only the user it belongs to.">
  <defs>
    <marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="#5a6b7c"/>
    </marker>
    <marker id="arg" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="#0d7a63"/>
    </marker>
  </defs>
  <text x="4" y="10" font-family="SF Mono,Menlo,monospace" font-size="7.4" fill="#8c9aa8" letter-spacing="1">POOLED &mdash; AS PROPOSED</text>
  <line x1="4" y1="15" x2="300" y2="15" stroke="#dfe6ec" stroke-width=".6"/>
  <g font-family="Helvetica,Arial" font-size="8" fill="#12202b">
    <rect x="4" y="28" width="52" height="20" rx="2" fill="#fff" stroke="#12202b" stroke-width=".7"/><text x="30" y="41" text-anchor="middle">User A</text>
    <rect x="4" y="56" width="52" height="20" rx="2" fill="#fff" stroke="#12202b" stroke-width=".7"/><text x="30" y="69" text-anchor="middle">User B</text>
    <rect x="4" y="84" width="52" height="20" rx="2" fill="#fff" stroke="#12202b" stroke-width=".7"/><text x="30" y="97" text-anchor="middle">User C</text>
    <rect x="104" y="46" width="88" height="40" rx="2" fill="#f2faf7" stroke="#0d7a63" stroke-width="1"/>
    <text x="148" y="62" text-anchor="middle" font-weight="700">WhaleHub SC</text>
    <text x="148" y="76" text-anchor="middle" font-size="7" fill="#5a6b7c">shares · fees</text>
    <rect x="220" y="46" width="80" height="40" rx="2" fill="#fdf5f4" stroke="#b23528" stroke-width="1"/>
    <text x="260" y="62" text-anchor="middle" font-weight="700">ONE NFT</text>
    <text x="260" y="76" text-anchor="middle" font-size="7" fill="#5a6b7c">all collateral</text>
  </g>
  <line x1="56" y1="38" x2="100" y2="56" stroke="#5a6b7c" stroke-width=".8" marker-end="url(#ar)"/>
  <line x1="56" y1="66" x2="100" y2="66" stroke="#5a6b7c" stroke-width=".8" marker-end="url(#ar)"/>
  <line x1="56" y1="94" x2="100" y2="78" stroke="#5a6b7c" stroke-width=".8" marker-end="url(#ar)"/>
  <line x1="192" y1="66" x2="216" y2="66" stroke="#5a6b7c" stroke-width=".8" marker-end="url(#ar)"/>
  <text x="4" y="126" font-family="SF Mono,Menlo,monospace" font-size="7.4" fill="#b23528" font-weight="700">One liquidation &rarr; A, B and C all lose</text>
  <text x="4" y="138" font-family="Helvetica,Arial" font-size="7.4" fill="#5a6b7c">and the liability sits in OUR contract, not theirs</text>

  <line x1="320" y1="4" x2="320" y2="150" stroke="#dfe6ec" stroke-width=".6"/>

  <text x="336" y="10" font-family="SF Mono,Menlo,monospace" font-size="7.4" fill="#8c9aa8" letter-spacing="1">DELEGATED &mdash; RECOMMENDED</text>
  <line x1="336" y1="15" x2="636" y2="15" stroke="#dfe6ec" stroke-width=".6"/>
  <g font-family="Helvetica,Arial" font-size="8" fill="#12202b">
    <rect x="336" y="28" width="46" height="20" rx="2" fill="#fff" stroke="#12202b" stroke-width=".7"/><text x="359" y="41" text-anchor="middle">User A</text>
    <rect x="336" y="56" width="46" height="20" rx="2" fill="#fff" stroke="#12202b" stroke-width=".7"/><text x="359" y="69" text-anchor="middle">User B</text>
    <rect x="336" y="84" width="46" height="20" rx="2" fill="#fff" stroke="#12202b" stroke-width=".7"/><text x="359" y="97" text-anchor="middle">User C</text>
    <rect x="428" y="46" width="86" height="40" rx="2" fill="#f2faf7" stroke="#0d7a63" stroke-width="1"/>
    <text x="471" y="62" text-anchor="middle" font-weight="700">WhaleHub router</text>
    <text x="471" y="76" text-anchor="middle" font-size="7" fill="#5a6b7c">delegate · fees</text>
    <rect x="556" y="24" width="80" height="18" rx="2" fill="#fff" stroke="#0d7a63" stroke-width=".8"/><text x="596" y="36" text-anchor="middle" font-size="7.4">NFT · A</text>
    <rect x="556" y="52" width="80" height="18" rx="2" fill="#fff" stroke="#0d7a63" stroke-width=".8"/><text x="596" y="64" text-anchor="middle" font-size="7.4">NFT · B</text>
    <rect x="556" y="80" width="80" height="18" rx="2" fill="#fdf5f4" stroke="#b23528" stroke-width=".8"/><text x="596" y="92" text-anchor="middle" font-size="7.4">NFT · C</text>
  </g>
  <line x1="382" y1="38" x2="424" y2="56" stroke="#5a6b7c" stroke-width=".8" marker-end="url(#ar)"/>
  <line x1="382" y1="66" x2="424" y2="66" stroke="#5a6b7c" stroke-width=".8" marker-end="url(#ar)"/>
  <line x1="382" y1="94" x2="424" y2="78" stroke="#5a6b7c" stroke-width=".8" marker-end="url(#ar)"/>
  <line x1="514" y1="56" x2="552" y2="34" stroke="#0d7a63" stroke-width=".9" marker-end="url(#arg)"/>
  <line x1="514" y1="66" x2="552" y2="62" stroke="#0d7a63" stroke-width=".9" marker-end="url(#arg)"/>
  <line x1="514" y1="76" x2="552" y2="88" stroke="#0d7a63" stroke-width=".9" marker-end="url(#arg)"/>
  <text x="336" y="126" font-family="SF Mono,Menlo,monospace" font-size="7.4" fill="#0d7a63" font-weight="700">C is liquidated &rarr; only C loses. Fees unchanged.</text>
  <text x="336" y="138" font-family="Helvetica,Arial" font-size="7.4" fill="#5a6b7c">isolation comes free from their architecture</text>
</svg>
<figcaption><b>Fee capture needs control of the flow, not custody of the risk.</b> Both models let
our contract price every entry and exit. Only the left one makes one user&rsquo;s liquidation
everyone&rsquo;s loss.</figcaption>
</figure>

<div class="note stop"><b>Why this matters more than it looks.</b> Pooling re-creates precisely the
socialised-liquidation problem a reviewer just required us to correct in the SCF proposal &mdash;
and it does so <b>by choice</b>, when XOXNO grants per-user isolation for free. We would be moving a
liability their architecture already solved into our own contract, and owning it.</div>

<p>Pooling is genuinely required only if the product is a <strong>fungible leveraged index
token</strong> &mdash; the Index Coop shape, with the rebalancing engine that implies. If the product
is &ldquo;managed leveraged positions, with a fee&rdquo;, delegation is strictly better.</p>
""",
)

# ── page 3 — the deal, the risks, the recommendation ─────────────────────────
p3 = page(
    TAG,
    """
<h2>What the offer is actually worth</h2>
<p>Some of it is worth more than it was pitched as.</p>

<table>
<tr><th>What we drop</th><th>Was going to cost</th><th>Why it matters</th></tr>
<tr class="hi"><td class="lab">Fair-LP oracle (constant-product <b>and</b> stableswap)</td><td>5 days &middot; $6,000</td><td>Our highest-risk contract, and the one most likely to lose money if wrong. They already run both curve types.</td></tr>
<tr><td class="lab">Own pool + LP collateral reserve</td><td>3 days &middot; $3,600</td><td>Plus a 7-day reserve timelock on every parameter change</td></tr>
<tr><td class="lab">Backstop deposit</td><td><b>$13,400</b></td><td>Into the Comet BLND:USDC pool &mdash; the one exploited for ~$717K in August</td></tr>
<tr><td class="lab">Liquidation path + keeper</td><td>5 days &middot; $6,000 + hosting</td><td>And an open-ended last-resort liquidator commitment</td></tr>
<tr><td class="lab">Supplying the borrowable side</td><td>Own capital</td><td><b>Underpitched.</b> On Blend we would have had to bring USDC liquidity ourselves. Their pools are not isolated, so we do not.</td></tr>
</table>

<p>Two capabilities are also <em>new</em>, not just cheaper: borrowing <strong>AQUA against LP to buy
more AQUA</strong> &mdash; a strategy Blend could not offer at all &mdash; and a referral fee on
leverage swaps routed through their aggregator, a second revenue line on flow we handle anyway.</p>

<h2>What is still unresolved</h2>
<ul>
<li><strong>Licence.</strong> The repository is PolyForm Noncommercial 1.0.0. A commercial
fee-charging wrapper is squarely commercial use. This needs a written agreement before any
engineering, not after.</li>
<li><strong>&ldquo;Soon to be audited&rdquo; is not audited.</strong> We would be making an unaudited
protocol a hard dependency of user funds.</li>
<li><strong>Counterparty risk.</strong> Their oracle, their risk parameters, their governance, their
upgrade keys. A c_factor change on their side liquidates our users.</li>
<li><strong>BLUB is not listed.</strong> AQUA is, and the Aquarius LPs are, but anything touching our
own token depends on their governance saying yes.</li>
<li><strong>The moat changes.</strong> As a wrapper the defensibility is UX, distribution and
auto-compounding &mdash; not protocol engineering. That is a real business (MetaMorpho curators earn
well on exactly that), but the SCF pitch must be rewritten around it, because
&ldquo;we build the leverage primitive&rdquo; would no longer be true.</li>
</ul>

<h2>Recommendation</h2>
<div class="verdict">
  <p class="vh">Take the deal &mdash; in the delegated shape</p>
  <p>Build a <b>delegated per-user manager</b>, not a pooled DAO. We keep the fees, the users keep
  isolation, and the D3 problem disappears instead of being re-created one layer up. Reserve the
  pooled fungible-share product for later, if there is demand for a leveraged index token &mdash; and
  price the rebalancing engine honestly when we do.</p>
</div>

<h3>Order of operations</h3>
<ul>
<li><b>Before any code:</b> get the licence position in writing, and ask what listing BLUB and the
BLUB-AQUA LP would take.</li>
<li><b>Then a one-day spike:</b> drive <code>multiply</code> on their <em>testnet</em> controller
against <code>XLMUSDC_LP</code>, with a second account delegated to a throwaway contract, and confirm
both the leveraged open and the delegation path end to end.</li>
<li><b>Keep the Blend work alive</b> until the licence is settled. The testnet stack is verified and
the Script3 conversation is open; the strategy layer already sits behind an interface, so two venues
is a real option rather than a rewrite.</li>
</ul>

<p class="tiny">Sources: mainnet reads of the XOXNO controller
<span class="mono">CAUCMIN5KSXEVZ7NMXR3LZATGD5EFIEUI5XWTFLYRO2R5OTXI22WE5JX</span> and
<span class="mono">github.com/XOXNO/rs-lending-xlm</span>, 1&ndash;2 Sep 2026. Comparables from Index
Coop, Morpho, Arrakis and Kamino public documentation. Fee figures are those protocols&rsquo; own
published numbers and were not independently verified on-chain.</p>
""",
)

html = (
    "<!doctype html><meta charset='utf-8'>"
    "<title>WhaleHub - XOXNO wrapper assessment</title>"
    f"<style>{CSS}</style>{p1}{p2}{p3}"
)

src = HERE / "_xoxno_brief.html"
src.write_text(html)

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
DEST.parent.mkdir(parents=True, exist_ok=True)
subprocess.run(
    [CHROME, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
     f"--print-to-pdf={DEST}", src.as_uri()],
    check=True, capture_output=True, timeout=180,
)
print(f"wrote {DEST}  ({DEST.stat().st_size:,} bytes)")
