#!/usr/bin/env python3
"""Assemble the SCF proposal HTML (print-targeted) and render it to PDF via Chrome."""
import json, pathlib, subprocess, sys

HERE = pathlib.Path(__file__).parent
C = json.loads((HERE / "charts.json").read_text())

CSS = """
@page { size: A4; margin: 15mm 14mm 13mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body {
  margin:0; font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
  font-size: 9.6pt; line-height: 1.5; color:#12202b; background:#fff;
}
.page { page-break-after: always; }
.page:last-child { page-break-after: auto; }
h1 { font-size: 22pt; line-height:1.1; margin:0 0 6pt; letter-spacing:-.02em; font-weight:700; }
h2 { font-size: 14pt; margin:0 0 5pt; letter-spacing:-.015em; font-weight:700; color:#12202b; }
h3 { font-size: 10.2pt; margin:13pt 0 4pt; font-weight:700; }
p  { margin:0 0 7pt; }
ul { margin:0 0 7pt; padding-left:14pt; }
li { margin-bottom:3pt; }
strong { font-weight:700; }
code { font-family: "SF Mono", Menlo, monospace; font-size:8.6pt; background:#f1f5f8;
       padding:0.5pt 3pt; border-radius:2px; }
.eyebrow { font-family:"SF Mono",Menlo,monospace; font-size:7.6pt; letter-spacing:.14em;
           text-transform:uppercase; color:#0d7a63; margin:0 0 7pt; }
.pagetag { font-family:"SF Mono",Menlo,monospace; font-size:7.4pt; letter-spacing:.13em;
           text-transform:uppercase; color:#8c9aa8; margin:0 0 9pt;
           padding-bottom:5pt; border-bottom:.6pt solid #dfe6ec; }
.dek { color:#5a6b7c; font-size:10.4pt; margin:0 0 11pt; }
.rule { border:0; border-top:.6pt solid #dfe6ec; margin:11pt 0; }
figure { margin:9pt 0 11pt; }
figure svg { width:100%; height:auto; display:block; }
figcaption { font-size:8.4pt; color:#5a6b7c; margin-top:5pt; line-height:1.45; }
figcaption b { color:#12202b; }
/* Keep atomic blocks whole — a table or chart split across a page break
   stranded a single row on its own page. */
table, figure, .note, .cards, .eq, .flow { break-inside: avoid; page-break-inside: avoid; }
h2, h3 { break-after: avoid; page-break-after: avoid; }
table { width:100%; border-collapse:collapse; font-size:8.8pt; margin:0 0 9pt; }
th,td { text-align:left; padding:4.5pt 6pt; border-bottom:.5pt solid #e7edf2; vertical-align:top; }
th { font-family:"SF Mono",Menlo,monospace; font-size:7.4pt; letter-spacing:.08em;
     text-transform:uppercase; color:#5a6b7c; background:#f4f8fa; font-weight:400; }
td.n,th.n { text-align:right; font-family:"SF Mono",Menlo,monospace; font-variant-numeric:tabular-nums; }
td.lab { font-weight:600; }
.pos{color:#0d7a63;} .neg{color:#b23528;} .cau{color:#a8700c;}
tr.hi td { background:#f4f8fa; }
.cards { display:flex; gap:7pt; margin:0 0 10pt; }
.card { flex:1; border:.6pt solid #dfe6ec; border-radius:3px; padding:7pt 8pt; }
.card .cap { font-family:"SF Mono",Menlo,monospace; font-size:7pt; letter-spacing:.09em;
             text-transform:uppercase; color:#8c9aa8; margin:0 0 3pt; }
.card .big { font-family:"SF Mono",Menlo,monospace; font-size:15pt; font-weight:600;
             line-height:1; margin:0; letter-spacing:-.02em; }
.card .sub { font-size:7.8pt; color:#5a6b7c; margin:3pt 0 0; line-height:1.35; }
.note { border-left:2pt solid #dfe6ec; padding:1pt 0 1pt 9pt; margin:0 0 9pt; font-size:9pt; color:#41505f; }
.note.go{border-left-color:#0d7a63;} .note.flag{border-left-color:#a8700c;} .note.stop{border-left-color:#b23528;}
.note b{color:#12202b;}
.eq { font-family:"SF Mono",Menlo,monospace; font-size:8.8pt; background:#f4f8fa;
      border:.6pt solid #dfe6ec; border-radius:3px; padding:7pt 9pt; margin:0 0 9pt; line-height:1.7; }
.eq em{color:#0d7a63;font-style:normal;font-weight:600;}
.flow { display:flex; align-items:stretch; gap:0; margin:9pt 0 4pt; }
.step { flex:1; border:.6pt solid #dfe6ec; border-radius:3px; padding:6pt 5pt; text-align:center;
        margin-right:9pt; position:relative; }
.step:last-child{margin-right:0;}
.step:after { content:"\\203A"; position:absolute; right:-7pt; top:50%; transform:translateY(-50%);
              color:#8c9aa8; font-size:11pt; }
.step:last-child:after{content:"";}
.step.k { border-color:#0d7a63; background:#f2faf7; }
.step .sn { font-family:"SF Mono",Menlo,monospace; font-size:6.8pt; color:#8c9aa8; display:block; }
.step .st { font-size:8.4pt; font-weight:700; display:block; margin-top:1.5pt; }
.step .sv { font-family:"SF Mono",Menlo,monospace; font-size:7.6pt; color:#5a6b7c; display:block; }
.cover-meta { display:flex; gap:7pt; margin:14pt 0 0; }
.cover-meta div { flex:1; border-top:1.4pt solid #12202b; padding-top:5pt; }
.cover-meta .k { font-family:"SF Mono",Menlo,monospace; font-size:7pt; letter-spacing:.1em;
                 text-transform:uppercase; color:#8c9aa8; }
.cover-meta .v { font-size:11pt; font-weight:700; margin-top:2pt; }
.foot { position:running(f); }
.tiny { font-size:7.6pt; color:#8c9aa8; line-height:1.5; }
.tiny b{color:#5a6b7c;font-weight:600;}
.two { display:flex; gap:14pt; }
.two > div { flex:1; }
"""


def page(tag, body):
    return f'<section class="page"><p class="pagetag">{tag}</p>{body}</section>'


# ── cover / page 1 ───────────────────────────────────────────────────────────
p1 = page(
    "Stellar Community Fund · Build · Draft 11 Aug 2026",
    f"""
<p class="eyebrow">WhaleHub</p>
<h1>Leveraged Yield Farming on Blend&nbsp;v2</h1>
<p class="dek">The first leveraged liquidity-provision product on Stellar. A liquidity provider
multiplies an Aquarius LP position 2&ndash;2.5&times; in one signed transaction, using the raw LP
share token as collateral on Blend. <strong>The engine already works on testnet</strong> &mdash; this
proposal funds the hardening, audit and mainnet launch.</p>

<div class="cover-meta">
  <div><p class="k">Requested</p><p class="v">$106,000</p></div>
  <div><p class="k">Category</p><p class="v">Build</p></div>
  <div><p class="k">Tranches</p><p class="v">3 &middot; 9 deliverables</p></div>
  <div><p class="k">Status</p><p class="v">Testnet verified</p></div>
</div>

<hr class="rule">

<h3>What a user does, in one transaction</h3>
<div class="flow">
  <div class="step k"><span class="sn">01</span><span class="st">FlashBorrow</span><span class="sv">2,000 USDC</span></div>
  <div class="step"><span class="sn">02</span><span class="st">Zap &rarr; LP</span><span class="sv">swap half, deposit</span></div>
  <div class="step"><span class="sn">03</span><span class="st">SupplyCollateral</span><span class="sv">LP to Blend</span></div>
  <div class="step"><span class="sn">04</span><span class="st">Borrow</span><span class="sv">2,000 USDC</span></div>
  <div class="step k"><span class="sn">05</span><span class="st">Repay</span><span class="sv">closes flash leg</span></div>
</div>
<p class="tiny">One end-of-stack health check &mdash; the position is never observably unhealthy.
Without the flash loan this is a <code>supply &rarr; borrow &rarr; zap &rarr; supply</code> loop that
leaves the user liquidatable between passes.</p>

<figure>{C['pos']}
<figcaption><b>The position.</b> $1,000 of user equity becomes $2,500 of LP exposure carrying
$1,500 of USDC debt. The user keeps the upside and the risk on the full $2,500; the debt is
serviced from the LP yield.</figcaption></figure>

<div class="note go"><b>Why this is fundable now.</b> All three primitives went live
independently: Blend&nbsp;v2 exposes <code>flash_loan</code>, Aquarius issues transferable LP share
tokens, and Reflector supplies the price feeds the oracle needs. Leveraged LP farming is a mature
category on Ethereum and Solana &mdash; Pendle on Morpho Blue, Curve LP against crvUSD, Kamino on
MarginFi. On Stellar the pieces exist and nobody has connected them.</div>
""",
)

# ── page 2 — the economics ───────────────────────────────────────────────────
p2 = page(
    "Page 2 · The economics",
    f"""
<h2>Leverage multiplies a spread &mdash; in both directions</h2>
<p class="dek">We present this as a spread trade, not as &ldquo;boosted yield&rdquo;. The arithmetic
is simple enough to put in front of a user before they sign.</p>

<div class="eq">net APY on equity  =  (<em>LP APY</em> &times; L)  &minus;  (<em>borrow APR</em> &times; (L &minus; 1))<br>
leverage wins while   <em>borrow APR</em>  &lt;  <em>LP APY</em><br>
net turns negative at <em>borrow APR</em>  &gt;  <em>LP APY</em> &times; L/(L&minus;1)  =  1.67 &times; <em>LP APY</em> at 2.5&times;</div>

<figure>{C['apy']}
<figcaption><b>Solid lines: leveraged at 2.5&times;. Dashed: the same pool unleveraged.</b> Each
circle marks where they cross &mdash; and the crossing always sits exactly at
<em>borrow&nbsp;APR&nbsp;=&nbsp;LP&nbsp;APY</em>, whatever the leverage. Left of that point leverage
adds return; right of it the borrow cost eats more than the extra exposure earns. Below the
zero line the user is paying to farm.</figcaption></figure>

<h3>What that means at the launch parameters</h3>
<table>
  <thead><tr><th>LP APY earned</th><th class="n">Borrow 6%</th><th class="n">Borrow 8%</th><th class="n">Borrow 10%</th><th class="n">Borrow 14%</th></tr></thead>
  <tbody>
    <tr><td class="lab">8%</td><td class="n">11.0%</td><td class="n">8.0%</td><td class="n cau">5.0%</td><td class="n neg">&minus;1.0%</td></tr>
    <tr><td class="lab">12%</td><td class="n">21.0%</td><td class="n">18.0%</td><td class="n">15.0%</td><td class="n cau">9.0%</td></tr>
    <tr class="hi"><td class="lab">15%</td><td class="n pos">28.5%</td><td class="n pos">25.5%</td><td class="n">22.5%</td><td class="n">16.5%</td></tr>
    <tr><td class="lab">20%</td><td class="n pos">41.0%</td><td class="n pos">38.0%</td><td class="n pos">35.0%</td><td class="n">29.0%</td></tr>
  </tbody>
</table>

<div class="note flag"><b>Stated plainly, because reviewers will find it anyway.</b> Blend borrow
rates are utilisation-driven and move without notice. At 2.5&times;, a 14% borrow rate against an 8%
LP yield returns <span class="neg">&minus;1%</span>. The interface therefore shows the live health
factor, the net APY, and the break-even borrow rate for the chosen leverage <em>before</em> the user
signs &mdash; and the risk disclosure requires explicit acknowledgement.</div>

<div class="note"><b>Numbers to confirm before submission.</b> The 20% unleveraged baseline is
carried from our Blend one-pager and is not yet independently verified; the 8% borrow figure should
be read off live Blend mainnet utilisation. Every return figure above depends on those two inputs.</div>
""",
)

# ── page 3 — architecture & risk ─────────────────────────────────────────────
p3 = page(
    "Page 3 · Architecture and risk",
    f"""
<h2>Raw LP as collateral, priced so it cannot be manipulated</h2>

<h3>The architecture, and why it changed</h3>
<p>The vault owns the Blend position and tracks each depositor as <strong>shares</strong> of it, so
interest and liquidation losses socialise pro-rata with no reconciliation and no off-chain
bookkeeping. An earlier design wrapped the Aquarius LP in a 1:1 receipt token and posted the wrapper
as collateral. <strong>After architecture review by Script3 &mdash; the Blend team &mdash; we removed
the wrapper entirely</strong> and now supply raw Aquarius LP directly: a shorter liquidator unwind,
no intermediate accounting, and one less contract in the audit surface.</p>

<h3>Oracle: fair-LP value, not pool spot or TWAP</h3>
<p>Pricing LP collateral is the hard part, and pool TWAP alone is unsafe at low TVL &mdash; long
windows go stale during real moves, short ones invite flash manipulation. We use the fair-value
formula adopted by Alpha Homora, Curve and Chainlink reference oracles:</p>
<div class="eq">LP_price  =  2 &middot; &radic;(<em>K</em> &middot; P_xlm &middot; P_usdc) / <em>L</em>        where <em>K</em> = x &middot; y (pool invariant)</div>
<p>Pool state enters <strong>only</strong> through <code>K</code>; asset prices come from Reflector.
An attacker can move reserves cheaply but cannot inflate <code>K</code> beyond what they actually
deposit, so the collateral price is not flash-manipulable.</p>

<figure>{C['lev']}
<figcaption><b>Why leverage is capped at 2.0&ndash;2.5&times;.</b> Maximum leverage is
1/(1&minus;collateral&nbsp;factor), so the Blend parameter sets the ceiling. LP collateral is a
first-of-kind asset class on Blend, so we proposed a conservative 0.50&ndash;0.60 rather than the
0.7+ typical of spot tokens. <b>The red line is a real finding from preparing this proposal:</b> the
contract's current cap of 3.0&times; sits above the boundary the launch band implies, and is corrected
in Deliverable&nbsp;2.</figcaption></figure>

<h3>Risk posture at launch</h3>
<table>
  <thead><tr><th>Parameter</th><th>Launch value</th><th>Rationale</th></tr></thead>
  <tbody>
    <tr><td class="lab">Collateral factor</td><td class="n">0.50&ndash;0.60</td><td>Conservative for a new collateral class</td></tr>
    <tr><td class="lab">Max leverage</td><td class="n">&le; 2.5&times;</td><td>Set at the implied liquidation boundary</td></tr>
    <tr><td class="lab">Pool TVL cap</td><td class="n">$1M</td><td>Bounds ecosystem exposure while the class is proven</td></tr>
    <tr class="hi"><td class="lab">Backstop</td><td class="n">Treasury</td><td class="pos">Funded by WhaleHub, <b>not requested from SCF</b></td></tr>
    <tr><td class="lab">Liquidation</td><td class="n">OSS + bot</td><td>Open reference liquidator plus a WhaleHub-run bot from day one</td></tr>
  </tbody>
</table>

""",
)

# ── page 4 — traction ────────────────────────────────────────────────────────
p4 = page(
    "Page 4 · Traction",
    """
<h2>The engine is built and verified &mdash; before asking for funding</h2>
<p class="dek">This is not a proposal to start building. The atomic open, the unwind, liquidation
behaviour and the share accounting all work on Stellar testnet today, with transactions on record.</p>

<div class="cards">
  <div class="card"><p class="cap">Testnet lifecycle</p><p class="big pos">Verified</p><p class="sub">Open, unwind, liquidation, accounting</p></div>
  <div class="card"><p class="cap">External review</p><p class="big pos">Script3</p><p class="sub">Blend team reviewed the architecture</p></div>
  <div class="card"><p class="cap">Mainnet product</p><p class="big">Live</p><p class="sub">AQUA staking since Feb 2026</p></div>
</div>

<table>
  <thead><tr><th>Capability</th><th>Evidence on testnet</th></tr></thead>
  <tbody>
    <tr><td class="lab">Atomic leveraged open</td><td>100 LP + 100 borrowed &rarr; 149 LP collateral, 100 debt (1.49&times;)</td></tr>
    <tr><td class="lab">Partial unwind</td><td>repay 50 / withdraw 50 &rarr; 99 LP, ~50 debt; 50 LP returned to user</td></tr>
    <tr><td class="lab">Liquidation</td><td>Oracle price drop &rarr; Blend auction created and filled with correct terms</td></tr>
    <tr><td class="lab">Share accounting</td><td>Share-based CDP verified against the live Blend position; losses socialise pro-rata</td></tr>
    <tr><td class="lab">Upgradeability</td><td>Vault and zapper both upgradeable behind stable addresses</td></tr>
  </tbody>
</table>

<h3>Three architectural failures found and fixed on testnet</h3>
<p>To get there we deployed a complete Blend testnet stack ourselves &mdash; pool, oracle, AMM and a
self-funded backstop &mdash; then hit and fixed three problems that would each have been fatal on
mainnet:</p>
<ul>
  <li><strong>Soroban re-entrancy.</strong> The vault was its own flash-loan receiver, so Blend's
    callback re-entered a contract already on the stack. Fixed by splitting the zap into a separate
    contract.</li>
  <li><strong>Share-model desync under liquidation.</strong> An internal ledger drifted from the real
    Blend position once a liquidation touched it. Fixed by deriving every position from live Blend
    state instead of a stored balance.</li>
  <li><strong>Authorisation gap in the non-flash unwind.</strong> Blend pulls repayment via a
    transfer that needed explicit contract authorisation. Fixed and verified end-to-end.</li>
</ul>
<p class="tiny">Finding these on testnet, against a stack we funded ourselves, is the argument for
funding the remaining work: the expensive discovery has already happened.</p>

<h3>Operating history</h3>
<p>WhaleHub has run a live mainnet product since February 2026 &mdash; AQUA staking with
auto-compounding Aquarius rewards at <code>app.whalehub.io</code> &mdash; alongside a 25-article
public research library. We ship and maintain production Soroban contracts under a multisig-governed
upgrade process.</p>
<div class="note"><b>On the choice of pair.</b> We are deliberately not building this on our own
BLUB&ndash;AQUA pool: it sits outside the Aquarius gauge whitelist and is too shallow to lever
safely. The product targets the largest real Aquarius pairs, starting with XLM/USDC &mdash; which is
also where the ecosystem benefit is, since each leveraged position deposits 2&ndash;2.5&times; the LP
a user could provide alone.</div>
""",
)

# ── page 5 — deliverables & budget ───────────────────────────────────────────
p5 = page(
    "Page 5 · Deliverables and budget",
    f"""
<h2>$106,000 across three tranches</h2>
<p class="dek">Sequenced so the economics and risk core land first, safety infrastructure second,
and audit plus mainnet last. Backstop capital is excluded from the ask.</p>

<figure>{C['budget']}
<figcaption><b>Audit is the largest single line</b> and non-negotiable: this contract composes user
funds with a third-party lending protocol. The reference liquidator (D4) is built as MIT-licensed
ecosystem infrastructure &mdash; any future LP-collateral market on Blend can reuse it.</figcaption></figure>

<table>
  <thead><tr><th>#</th><th>Deliverable</th><th>Completes</th><th class="n">Budget</th></tr></thead>
  <tbody>
    <tr><td class="lab">D1</td><td><b>Fair-LP oracle adapter.</b> Invariant-based Reflector pricing, deviation breakers, feed-outage fallback, flash-manipulation test suite.</td><td class="n">15.09.26</td><td class="n">$13,500</td></tr>
    <tr><td class="lab">D2</td><td><b>Performance-fee and accounting module.</b> Fee on net profit after borrow costs; high-water mark per share. Corrects the 3.0&times; cap to &le;2.5&times;.</td><td class="n">29.09.26</td><td class="n">$9,800</td></tr>
    <tr><td class="lab">D3</td><td><b>Per-user risk isolation.</b> Per-user health and liquidation, so one over-levered depositor cannot impose losses on the rest.</td><td class="n">13.10.26</td><td class="n">$16,200</td></tr>
    <tr><td class="lab">D4</td><td><b>Open-source reference liquidator.</b> MIT-licensed four-step atomic LP unwind, with docs and a testnet dry-run harness.</td><td class="n">27.10.26</td><td class="n">$12,400</td></tr>
    <tr><td class="lab">D5</td><td><b>Health keeper and monitoring.</b> Tiered user alerts, a WhaleHub-run liquidation bot from day one, public risk dashboards.</td><td class="n">10.11.26</td><td class="n">$10,600</td></tr>
    <tr><td class="lab">D6</td><td><b>Footprint validation and stress testing.</b> Liquidation sequence measured against Soroban resource limits; crash, rate-spike and bank-run scenarios.</td><td class="n">24.11.26</td><td class="n">$8,900</td></tr>
    <tr class="hi"><td class="lab">D7</td><td><b>Third-party security audit and remediation.</b> Vault, zapper, oracle and liquidator, by a Soroban-experienced firm. Published report.</td><td class="n">08.12.26</td><td class="n">$18,000</td></tr>
    <tr><td class="lab">D8</td><td><b>Production frontend and Wallets Kit.</b> Live zap quoting, health and break-even shown pre-signature, hardware-wallet support, risk disclosure.</td><td class="n">22.12.26</td><td class="n">$9,400</td></tr>
    <tr><td class="lab">D9</td><td><b>Mainnet launch and documentation.</b> Pool deployment with treasury backstop, staged launch under the $1M cap, public integration guide.</td><td class="n">12.01.27</td><td class="n">$7,200</td></tr>
  </tbody>
</table>

""",
)

# ── page 6 — ecosystem return, team, provenance ──────────────────────────────
p6 = page(
    "Page 6 · Ecosystem return, team and sources",
    """
<h2>What the ecosystem gets, beyond WhaleHub</h2>
<p class="dek">Three of the four outputs below are reusable by teams that are not us. That is
deliberate &mdash; it is the argument for community funding rather than private capital.</p>

<table>
  <thead><tr><th>Output</th><th>Who benefits</th></tr></thead>
  <tbody>
    <tr><td class="lab">A new collateral class on Blend</td><td>LP tokens become productive collateral, with the oracle design and parameter work published for reuse.</td></tr>
    <tr class="hi"><td class="lab">An MIT-licensed reference liquidator</td><td>Any future LP-collateral market on Blend can fork D4 rather than rebuild the four-step unwind.</td></tr>
    <tr><td class="lab">Deeper Aquarius liquidity</td><td>Each leveraged position deposits 2&ndash;2.5&times; the LP a user could supply alone.</td></tr>
    <tr><td class="lab">Documented failure modes</td><td>The re-entrancy, share-desync and authorisation bugs we hit are published so others avoid them.</td></tr>
  </tbody>
</table>

<h3>Team</h3>
<p><b>Viktor Vostrikov &mdash; Founder.</b> Builds and operates WhaleHub: the Soroban staking
contract, the auto-compounding vault system, the backend reward indexer, and the mainnet multisig
upgrade process. Has shipped and maintained production Soroban contracts holding real user funds
since early 2026. Led the Blend v2 integration through testnet, including the self-funded backstop
deployment and the Script3 architecture review.<br>
<b>Contact</b> viktor@whalehub.io</p>

<h3>Sources and assumptions</h3>
<table>
  <thead><tr><th>Input</th><th>Value used</th><th>Source</th></tr></thead>
  <tbody>
    <tr><td class="lab">Collateral factor</td><td class="n">0.50&ndash;0.60</td><td>Proposed to Script3; under discussion</td></tr>
    <tr><td class="lab">Max leverage</td><td class="n">2.5&times;</td><td>Derived: 1/(1&minus;0.60)</td></tr>
    <tr><td class="lab">Contract cap today</td><td class="n">3.0&times;</td><td>Read from the vault source (<code>max_leverage_bps</code>)</td></tr>
    <tr class="hi"><td class="lab">Unleveraged LP APY</td><td class="n cau">20%</td><td class="cau">Carried from our Blend one-pager &mdash; <b>to verify against live Aquarius XLM/USDC</b></td></tr>
    <tr class="hi"><td class="lab">USDC borrow APR</td><td class="n cau">8%</td><td class="cau">Assumption &mdash; <b>to read off live Blend mainnet utilisation</b></td></tr>
    <tr><td class="lab">Testnet position figures</td><td class="n">1.49&times;</td><td>Verified on-chain, Stellar testnet</td></tr>
  </tbody>
</table>

<p class="tiny"><b>Testnet contracts.</b> Vault
<code>CC2JF2VP3LVNHYI7URF3R376FCVFSAI4HNVZ2WPZZHBJDAJSWX2X2PFH</code> &middot; Zapper
<code>CCUDFI62LH2IMHGSRBLLF7SIKRPDQ3LZPA4TYFBFS5ENRYWZOHOKSHT2</code> &middot; working UI at
<code>app.whalehub.io/leverage</code> (testnet-pinned).</p>
<p class="tiny"><b>Not investment advice.</b> All APY figures are arithmetic outputs of the stated
assumptions, not projections or promises of return. Leveraged positions can be liquidated and can
lose more than an unleveraged position. BLUB is a floating asset and is not pegged or redeemable.</p>
""",
)

html = (
    "<!doctype html><html lang='en'><head><meta charset='utf-8'>"
    "<title>WhaleHub — Leveraged Yield Farming on Blend v2 — SCF Proposal</title>"
    f"<style>{CSS}</style></head><body>"
    + p1 + p2 + p3 + p4 + p5 + p6 +
    "</body></html>"
)

src = HERE / "scf-proposal.html"
src.write_text(html)
print(f"html written: {len(html):,} bytes -> {src}")

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
dest = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "scf-proposal.pdf"
r = subprocess.run(
    [CHROME, "--headless", "--disable-gpu", "--no-pdf-header-footer",
     f"--print-to-pdf={dest}", f"file://{src}"],
    capture_output=True, text=True, timeout=180,
)
if dest.exists():
    print(f"PDF written: {dest} ({dest.stat().st_size:,} bytes)")
else:
    print("FAILED", r.stderr[-1500:])
