# SCF Proposal — Leveraged Yield Farming on Blend v2

**Status:** DRAFT for review — not submitted.
**Prepared:** 2026-08-11
**Category:** Build
**Requested:** $108,000 (50 engineering days @ $1,200 + audit + backstop + contingency)
**Applicant:** WhaleHub · Viktor Vostrikov · viktor@whalehub.io
**Structure modelled on:** SCF #44 submission `recuUVlYWqrAk5t9Z` (Etesia, $113.0K, Build).
**Presentation PDF:** [`assets/WhaleHub_SCF_Leveraged_Yield_Farming.pdf`](assets/WhaleHub_SCF_Leveraged_Yield_Farming.pdf)
— 6 pages with charts, for sending to reviewers. This markdown is the long-form source of
record; the PDF is the explainer. Regenerate it with the two scripts in
`assets/generator/` (`mkcharts.py` then `build_pdf.py <dest>`); charts are computed
vector SVG, rendered via headless Chrome `--print-to-pdf`.

> **RATE INPUTS SUPERSEDED 2026-08-12; economics rewritten 2026-08-14.**
> Live data measured (see [Verified rates](#verified-rates-2026-08-12)):
> Aquarius XLM/USDC concentrated yields **10.77%** unboosted (not the 20% assumed), and Blend
> **USDC borrows at 10.79% net** — *above* that yield, so borrowing USDC makes a leveraged
> position lose money. **XLM borrows at 0.10%**, which is the only viable borrow asset, and its
> 133.33% liability factor caps leverage at **1.82×** (not 2.5×). Measured strategy capacity is
> **~$439K of equity**, not the $1M cap proposed to Script3.
> Live model: **app.whalehub.io/leverage-calculator.html** (source `public/leverage-calculator.html`).
> Rewritten "Why Stellar" copy and the full number appendix:
> [`scf-why-stellar-section.md`](scf-why-stellar-section.md). Submission document:
> `WhaleHub_SCF_OpenTrack_v5.docx` (in `~/Downloads`).

---

## Products & Services

WhaleHub is building the first **leveraged liquidity-provision product on Stellar**, built
natively on Blend v2's flash-loan primitive. It lets a liquidity provider multiply an
Aquarius LP position in a single signed transaction, with no manual loop and no interval
during which the position sits unhealthy.

The problem it solves is specific. An LP on Stellar today has exactly one lever: deposit
more capital. On Ethereum and Solana, leveraged LP farming is a mature category — Pendle on
Morpho Blue, Curve LP against crvUSD, Kamino kTokens on MarginFi, Arrakis vaults on Aave
isolated markets. Stellar has both required primitives already live: Blend v2 exposes
`flash_loan`, and Aquarius issues transferable LP share tokens. Nobody has connected them.
That is the gap this project closes.

### What the user does

A user holding Aquarius XLM/USDC LP tokens deposits them into the WhaleHub vault and
chooses a target leverage. One transaction later they hold a position of roughly 1.55–1.82× their
original exposure, with an **XLM** debt against it on a Blend pool. They can unwind at any time,
partially or fully.

### The atomic open

The vault composes one Blend `flash_loan` call whose request stack does the entire job:

```
1. FlashBorrow      XLM from the Blend pool           (callback receives funds)
2. Zap              swap half → pair, deposit → LP    (Aquarius / Soroswap, outside Blend)
3. SupplyCollateral  resulting LP → Blend pool
4. Borrow           XLM against the new collateral
5. Repay            closes the flash leg
   → single end-of-stack health check
```

Without the flash loan this is a `supply → borrow → zap → supply` loop: each pass adds less
leverage, costs more fees, and leaves the user liquidatable between passes. Blend's
`flash_loan` runs the health check exactly once, at the end, so the position is never
observably unhealthy. This is the technical core of the product and it is **already working
on testnet**.

### Architecture — raw LP as collateral

The vault contract owns the Blend position and tracks each user's stake as **shares** of that
position, so interest and liquidation losses socialise pro-rata without any reconciliation
step or off-chain bookkeeping.

An earlier iteration wrapped the Aquarius LP in a 1:1 receipt token and used the wrapper as
collateral. **Following architecture review by Script3 (the Blend team) we removed the
wrapper entirely** and now supply raw Aquarius LP directly. That change shortens the
liquidator unwind to four atomic steps, prices the collateral without intermediate
accounting, and removes one contract from the audit surface. Responding to that review is
why the design is where it is.

### Oracle — manipulation-resistant fair-LP pricing

Pricing LP collateral is the hard part, and pool spot or pool TWAP alone is not safe at low
TVL. We price the LP with the fair-value formula used by Alpha Homora, Curve and Chainlink
reference oracles. For a constant-product pool with reserves `x`, `y` and LP supply `L`:

```
LP_price = 2 · √(K · P_xlm · P_usdc) / L        where K = x · y
```

Pool state enters **only** through the invariant `K`, and `P_xlm` / `P_usdc` come from
Reflector. An attacker can move reserves cheaply but cannot inflate `K` beyond what they
genuinely deposit, so flash manipulation of the collateral price is not available. Reflector
feeds carry deviation circuit breakers, so a stale or dislocated feed halts new borrows
rather than mispricing collateral.

### Risk posture at launch

LP collateral is a first-of-kind asset class on Blend, and the launch parameters reflect
that rather than maximising headline yield:

| Parameter | Launch value | Why |
| --- | --- | --- |
| Collateral factor | 0.50–0.60 | Conservative for a new collateral class; caps leverage at 1.60–1.82× against XLM |
| Max leverage | 92% of the Blend boundary | Boundary is 1/(1 − CF/LF) = 1.60–1.82× borrowing XLM; UI band 1.47–1.67×. Leaves room for a **25–37% XLM rally** before liquidation |
| Pool cap | $450K of equity on the launch pair | The measured capacity of Aquarius XLM/USDC concentrated; rises as pairs are added |
| Backstop | $13,333 (247,464 BLND + 2,667 USDC) | Blend's `BLND⁴ × USDC ≥ 1e25` threshold; **in the ask**. Threshold minimum, not risk-sized — treasury tops up if Script3 requires more |
| Liquidation | Open-source reference liquidator + WhaleHub-operated bot | Guarantees liquidations clear from day one |

### Returns, stated honestly

Leverage multiplies a spread in both directions:

```
net APY on equity = (LP APY × L) − (borrow APR × (L − 1))
```

On live rates that condition selects the borrow asset for us. Against the Aquarius XLM/USDC
concentrated pool's 10.77% unboosted yield, at 1.55× and after the dilution our own deposit causes:
borrowing **XLM at 0.10% nets 14.81%** on equity, an edge of **+4.04pp** over plain LPing;
borrowing **USDC at 10.79% nets 8.93%**, which is **1.84pp worse than not levering at all**.
The break-even borrow rate at 1.55× is **27.02%**, roughly 270× the current XLM cost — the margin
of safety, not the headline, is the argument. Blend borrow rates are utilisation-driven and move
without notice, so the product is presented as a spread trade with live health-factor and net-APY
display, never as "boosted yield". The UI shows the break-even borrow rate for the user's chosen
leverage before they sign.

### Why this belongs on Stellar, and why now

Three things land at once: Blend v2's flash-loan primitive is live on mainnet, Aquarius LP
share tokens are transferable Soroban assets, and Reflector provides the independent price
feeds the oracle needs. The product is only buildable because all three exist.

But the decisive fact is Stellar-specific and priced. On Blend mainnet, **768.59M XLM is supplied
($124.50M) against 1.41M borrowed ($228.7K)** — 0.18% utilisation against a 40% target, so Blend's
reactive interest modifier has decayed to its 0.10× floor and **XLM borrows at 0.10% APY**. USDC is
the mirror image: 75.72% utilisation against an 80% target, modifier at 1.5478×, 11.08% APY.
Borrow demand on Stellar is for dollars, not for XLM, so the chain's most-supplied asset sits idle.
Leveraged LP farming is the natural consumer of exactly that idle asset, and it is cheap here in a
way it is not on Ethereum or Solana. It would take **$49.57M of new borrowing** to lift XLM
utilisation to target; our own full capacity moves the rate from 0.100% to 0.103%.

It also creates durable ecosystem value beyond WhaleHub — a new collateral class on Blend, a
reference implementation other teams can fork for any LP-collateral market, and materially
deeper Aquarius liquidity: at 1.55×, $439K of equity routes **$681K of new liquidity into a $1.26M
pool, +54% depth** on Stellar's flagship concentrated pair; across every gauge-enabled Aquarius pair
the same model supports **$7.50M of equity and $11.63M of LP exposure** against $23.06M deposited
today.

The full model, including the counterweights (XLM-debt-against-XLM-LP correlation, and the fact
that the high-APY pairs are too shallow to lever — AQUA/USDC yields 42.12% on $90K TVL, where
dilution turns the edge −18pp), is published at **app.whalehub.io/leverage-calculator.html**.

---

## Shared Architecture

One principle: **on-chain custody and settlement, with all risk logic enforced on-chain.**
User funds never leave Soroban contracts, and no off-chain component can move capital. The
keeper and liquidation bots only ever *initiate* permissionless transactions that anyone
else could also send — they hold no privileged authority. On-chain guardrails are explicit:
slippage bounds (`min_lp_out`, `min_pair_out`) on every zap, a hard leverage cap enforced at
the contract, oracle deviation circuit breakers, and a pool-level TVL cap. Both contracts
are upgradeable behind a stable address so security fixes ship without migrating user
positions.

---

## Requested Budget

**$108,000** across three tranches and ten deliverables. Engineering is costed bottom-up from a
day-level scope — **50 engineering days at a $1,200 blended day rate = $60,000** — rather than
back-solved from a comparable. The remaining $48,000 is what the product costs beyond developer
time.

| Line | Basis | Budget |
| --- | --- | ---: |
| Engineering | 50 days × $1,200 | $60,000 |
| Third-party security audit | vault, zapper, oracle adapter, liquidator | $25,000 |
| Blend backstop deposit | protocol threshold, sized below | $13,400 |
| Keeper / liquidation-bot hosting | 6 months | $1,200 |
| Contingency | 10% of engineering + audit | $8,400 |
| | **Total** | **$108,000** |

| Tranche | Focus | Deliverables | Days | Budget |
| --- | --- | --- | ---: | ---: |
| 1 — MVP (T0+6w) | Oracle, Blend reserve, vault, multi-pair | D1–D4 | 19 | $22,800 |
| 2 — Testnet (T0+12w) | Liquidation, entry points, user controls | D5–D8 | 18 | $22,800 |
| 3 — Mainnet (T0+20w) | Frontend, analytics, audit, backstop | D9–D10 | 13 | $62,400 |
| | | **Total** | **50** | **$108,000** |

Scope maps to the six requirements: **Req 1** (leveraged yield farming via Blend) is 25 days —
oracle adapter 5, Blend pool / Aquarius-LP reserve 3, leverage vault 5, liquidation path + keeper 5,
frontend + integration 7. **Req 2–6** (multi-pair vaults 6, deposit entry points 5, per-vault
toggles 4, auto-restake toggle 4, analytics & projections 6) are a further 25 days and run in
parallel.

### Backstop deposit — sized from the protocol, not estimated

A Blend pool earns emissions only once its backstop clears the protocol threshold. Blend v2
enforces this in `is_pool_above_threshold` on the *underlying* of the pool's backstop shares:

```
bal_blnd⁴ × bal_usdc  ≥  1e25        (whole units; 1e25 = 100k⁵)
```

Backstop shares are Comet **BLND:USDC 80/20** LP tokens, so the underlying is pinned at 4 parts
BLND to 1 part USDC *by value*, and the threshold collapses to a single point:

| | Amount | USD |
| --- | ---: | ---: |
| BLND | 247,464 | $10,666 |
| USDC | 2,667 | $2,667 |
| | **Total** | **$13,333** |

at BLND $0.043103 (CoinGecko `blend`, 2026-08-14). Budgeted at **$13,400**. Cost scales as
`P_blnd^0.8`, so BLND at 3× raises it to ~$32,100 and at 5× to ~$48,300.

⚠️ **This is the threshold minimum, not a risk-sized backstop.** $13.3K of first-loss capital
against ~$1.1M of leveraged exposure is thin; adequate backstop sizing is a parameter under
discussion with Script3, and the treasury tops it up if they ask for more.
---

## Traction Evidence

**The core engine is already built and verified end-to-end on testnet — before asking for
funding.** This is not a proposal to start building; it is a proposal to harden, audit and
ship a working system.

Verified on Stellar testnet, with transactions on record:

| Capability | Evidence |
| --- | --- |
| Atomic leveraged open | 100 LP + 100 borrowed → 149 LP collateral, 100 debt (1.49×) |
| Partial unwind | repay 50 / withdraw 50 → 99 LP, ~50 debt; 50 LP returned to user |
| Liquidation | Oracle price drop → Blend auction created and filled with correct terms |
| Share accounting | Share-based CDP; interest and losses socialise pro-rata, verified against live Blend position |
| Upgradeability | Vault and zapper both upgradeable; addresses stable |

Testnet contracts:
- Vault `CC2JF2VP3LVNHYI7URF3R376FCVFSAI4HNVZ2WPZZHBJDAJSWX2X2PFH`
- Zapper `CCUDFI62LH2IMHGSRBLLF7SIKRPDQ3LZPA4TYFBFS5ENRYWZOHOKSHT2`
- Working UI: `app.whalehub.io/leverage` (testnet-pinned)

To reach that point we deployed a complete Blend testnet stack ourselves — pool, oracle,
AMM, and a self-funded backstop — then found and fixed three architectural problems that
would each have been fatal on mainnet: Soroban re-entrancy when the vault was its own
flash-loan receiver (fixed by splitting out a separate zapper contract), share-model desync
under liquidation (fixed by deriving positions from the live Blend state rather than an
internal ledger), and an authorisation gap in the non-flash unwind path.

**External review:** the architecture has been reviewed by Script3, the Blend team. Their
feedback on liquidator unwind, oracle robustness and LP-collateral precedent led directly to
removing the wrapper layer. Parameter selection — collateral factor, TVL caps, liquidation
incentives, backstop sizing — is under active discussion with them.

**Operating history:** WhaleHub has run a live mainnet product since February 2026 —
AQUA staking with auto-compounding Aquarius rewards, at `app.whalehub.io`, with an active
staking base and a 25-article public research library at `whalehub.io/blog`. We ship and
maintain production Soroban contracts, including a multisig-governed upgrade process.

We are deliberately **not** building this on our own BLUB–AQUA pair. That pool is currently
outside the Aquarius gauge whitelist and too shallow to lever safely. The product targets
the largest real Aquarius pairs, starting with XLM/USDC — where the liquidity and the
ecosystem benefit actually are.

---

## Tranche 1 — MVP · T0 + 6 weeks · 19 days · $22,800

### D1 — Fair-LP oracle adapter · 5 days · $6,000
Invariant-based Reflector pricing (`LP_price = 2·√(K · P_a · P_b) / L`), deviation circuit
breakers, feed-outage fallback, flash-manipulation test suite. No dependence on pool spot or TWAP.
**Success:** adapter live on testnet; the suite proves the price cannot be moved by an AMM spot trade.

### D2 — Blend pool and Aquarius-LP collateral reserve · 3 days · $3,600
Pool deployed with the Aquarius LP share token as a collateral reserve and **XLM** as the borrowable
reserve, at the collateral and liability factors agreed with Script3.
**Success:** reserve active on testnet, LP token accepted as collateral and priced by D1.

### D3 — Leverage vault contract · 5 days · $6,000
Vault ownership of the Blend position; per-user share accounting and per-user health derived from
live Blend state; performance fee on net profit **after** borrow costs with a high-water mark; and
correction of the contract's `max_leverage_bps` from 3.0× to the **1.82×** liquidation boundary.
**Success:** one depositor liquidated with no loss imposed on another; cap enforced on-chain; fee
accrues only above the high-water mark.

### D4 — Multi-pair vault contracts · 6 days · $7,200
Five new auto-compounding vaults on the highest-volume Stellar pairs, deployed on extended existing
vault contracts, with automated harvest and compounding wired per pair.
**Success:** all five live on testnet, one full harvest-compound cycle recorded per vault.

---

## Tranche 2 — Testnet · T0 + 12 weeks · 18 days · $22,800

### D5 — Liquidation path, reference liquidator and keeper · 5 days · $6,000 (+$1,200 hosting)
MIT-licensed four-step atomic unwind with docs and a testnet dry-run harness; tiered user health
alerts; a WhaleHub-operated liquidation bot; a public risk dashboard; and Soroban footprint
validation of the full liquidation sequence against resource limits — a liquidation that exceeds the
footprint ceiling is an un-liquidatable position. The keeper holds no privileged permissions.
**Success:** public repo; a third party can run the harness and fill a test auction; the bot fills a
testnet liquidation unattended; footprint documented within limits.

### D6 — Stablecoin and XLM deposit entry points · 5 days · $6,000
Direct XLM, USDC and EURC deposits with routing into the optimal strategy.
**Success:** end-to-end testnet flow from an EURC deposit to an active routed position.

### D7 — Per-vault on/off toggles · 4 days · $4,800
Contract-level and interface controls so users pick their own risk mix across the vault set rather
than the protocol deciding for them.
**Success:** toggles verified per vault on testnet; deposits route only to enabled vaults.

### D8 — Auto-restake toggle · 4 days · $4,800
User-selectable routing of AQUA rewards — compounded into BLUB stake, or sent to the wallet.
**Success:** both paths verified on testnet across a full reward cycle.

---

## Tranche 3 — Mainnet · T0 + 20 weeks · 13 days · $62,400

### D9 — Leverage frontend and integration · 7 days · $8,400
Live reserve-based zap quoting (replacing the placeholder slippage haircut), health factor, net APY
and break-even borrow rate shown before signature with explicit risk acknowledgement, position
management and unwind flows, and Stellar Wallets Kit for Freighter, LOBSTR, xBull and hardware.
**Success:** recorded end-to-end flows against mainnet contracts; first real leveraged position on-chain.

### D10 — Analytics, yield projections and documentation · 6 days · $7,200
Live contract-state queries showing expected APR, rewards split and historical pool performance
before a user commits, plus the public integration guide: architecture, oracle design, risk
parameters, liquidation mechanics, and how to build LP-collateral markets on Blend.
**Success:** projections live against mainnet state; guide published.

### Third-party security audit and remediation · $25,000
Full external audit of the vault, zapper, oracle adapter and liquidator by a firm with Soroban
experience, then remediation and a published report. Scope centres on the flash-loan request stack,
oracle manipulation, share-accounting invariants under liquidation, and authorisation boundaries.
Non-negotiable before mainnet: this contract composes user funds with a third-party lending
protocol. If the SCF Audit Bank covers this scope we draw on it instead and release this line back.

### Blend backstop deposit · $13,400
As sized above. Deposited at mainnet pool deployment; the pool cannot earn emissions without it.

### Contingency · $8,400
Ten percent of engineering and audit.

## Team

**Viktor Vostrikov — Founder.** Builds and operates WhaleHub: the Soroban staking contract,
the auto-compounding vault system, the backend reward indexer, and the mainnet deployment
and multisig upgrade process. Has shipped and maintained production Soroban contracts
holding real user funds since early 2026, including multi-signature governance for contract
upgrades. Led the Blend v2 integration through testnet, including the self-funded backstop
deployment and the Script3 architecture review.

> **TODO before submission:** SCF weights team depth heavily, and the comparison submission
> listed five named contributors with prior credentials. Add any additional engineers,
> advisors or auditors — and if the project is genuinely solo, state explicitly which
> deliverables will be contracted out (the audit at minimum) and name the intended firms.
> Reviewers respond better to an honest solo-plus-contractors plan than to a thin team page.

---

## Verified rates (2026-08-12)

Measured from `amm-api.aqua.network/pools/`, the Aquarius UI, and the Blend pool UI.

### Aquarius — gauge-enabled pools

| Pair | Type | TVL | Vol 24h | Total APY | Fee | Rewards | Boosted |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| XLM/USDC | concentrated | $1.26M | $618K | **10.77%** | 6.23% | 4.54% | 17.49% |
| XLM/yXLM | concentrated | $388K | $5K | 5.68% | 0.05% | 5.63% | 14.12% |
| PYUSD/USDC | concentrated | $286K | $56 | 11.00% | 0.01% | 10.99% | — |
| XLM/AQUA | concentrated | $219K | $19K | 24.71% | 6.28% | 18.43% | 52.36% |
| USDC/sUSD | concentrated | $198K | $3K | 28.18% | 0.64% | 27.53% | 69.48% |
| AQUA/USDC | concentrated | $90K | $11K | 42.12% | 7.67% | 34.45% | 93.80% |
| XLM/USDC | volatile | $3.20M | $162K | 0.94% | 0.94% | — | 1.06% |
| XLM/SolvBTC | volatile | $6.59M | $81K | 0.96% | 0.96% | — | 2.15% |
| xSolvBTC/SolvBTC | stable | $10.73M | $24K | 4.43% | 4.43% | — | 11.01% |

### Blend — borrow side (pool market size $189.96M)

| Asset | Borrow APY | Emissions | Net cost | Liability factor | Max leverage @ CF 0.60 | Available |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| **XLM** | 0.10% | — | **0.10%** | 133.33% | 1.82× | ~$86.9M |
| USDC | 11.08% | 0.29% | 10.79% | 105.26% | 2.33× | $9.18M |
| EURC | 8.35% | 5.70% | 2.65% | 105.26% | 2.33× | $450K |

### Three consequences

1. **Borrow XLM, not USDC.** USDC at 10.79% net exceeds the 10.77% unboosted LP yield, so
   leverage subtracts return. XLM at 0.10% is effectively free. Caveats: XLM's liability factor
   caps leverage at 1.82× (vs 2.33× for USDC); the 0.10% reflects near-zero utilisation and will
   rise as borrowing scales; and borrowing XLM against an XLM-containing LP partly hedges XLM
   but means an XLM rally grows the debt as the pool rebalances out of XLM.
2. **Capacity is ~$439K of equity, not $1M.** The target pool holds only $1.26M. At 1.55×,
   $439K of equity adds $681K of exposure — a 54% TVL increase that dilutes fixed emissions and
   fees until the strategy no longer beats plain LPing. The $1M cap proposed to Script3 is larger
   than the pool can absorb; revise it down or spread across pairs.
3. **The high-APY pools are too small.** AQUA/USDC yields 42.12% but holds $90K, so capacity is
   ~$32K. Yield and depth are inversely related across the whole set.

## Open items before submission

Items in this draft that are **carried from the Blend one-pager or otherwise unverified** —
resolve each before submitting:

1. ~~20% unleveraged LP APY baseline.~~ **DONE 2026-08-12; copy rewritten 2026-08-14** — actual
   10.77% unboosted / 17.49% boosted on XLM/USDC concentrated. The 38% headline is not achievable
   at these rates; realistic is 14.81% net at 1.55× borrowing XLM, against 10.77% for plain LPing.
2. ~~8% USDC borrow APR.~~ **DONE 2026-08-12; copy rewritten 2026-08-14** — USDC 10.79% net
   (unusable), XLM 0.10%. Prose in this file and in `WhaleHub_SCF_OpenTrack_v5.docx` now uses XLM as
   the borrow asset. **The presentation PDF has NOT been regenerated** — pages 2 and 4 still carry
   the 20%/8%/2.5× figures. Regenerate with `assets/generator/` before sending it to reviewers.
3. ~~Backstop cost.~~ **DONE 2026-08-14** — threshold read from Blend v2
   `is_pool_above_threshold`: `bal_blnd⁴ × bal_usdc ≥ 1e25` on the underlying of the pool's
   backstop shares. Backstop shares are Comet BLND:USDC 80/20 LP, pinning the underlying at 4:1 by
   value, so the threshold resolves to **247,464 BLND + 2,667 USDC = $13,333** at BLND $0.043103
   (CoinGecko `blend`). Budgeted $13,400; cost scales as `P_blnd^0.8`. The earlier ~167,800 BLND +
   ~12,600 USDC indication sits on the same threshold curve but at a ratio the Comet pool cannot
   produce. **Still open:** whether the threshold minimum is an adequate *risk-sized* backstop —
   $13.3K of first-loss capital against ~$1.1M of exposure is thin. Confirm sizing with Script3.
4. ~~Target pair TVL.~~ **DONE 2026-08-12** — XLM/USDC concentrated holds $1.26M, which does
   **not** support a $1M equity cap. Measured capacity ~$439K. Renegotiate the cap with Script3.
5. **Last-resort liquidator cap.** The Script3 letter commits WhaleHub treasury to absorbing
   positions no profit-motivated buyer takes. Negotiate an explicit ceiling — uncapped, this
   is open-ended balance-sheet risk against modest revenue.
6. **Team section.** See TODO above.
7. ~~Budget rates.~~ **DONE 2026-08-14** — rebuilt bottom-up from a day-level scope: 50
   engineering days at a $1,200 blended day rate ($60,000), plus audit $25,000, backstop $13,400,
   keeper hosting $1,200 and 10% contingency $8,400 = **$108,000**. **Still open:** the $1,200 day
   rate and the $25,000 audit figure are estimates, not signed quotes — get at least one audit
   quote from a Soroban-experienced firm before submitting.
8. **Milestone dates** assume a start immediately post-award; shift if the SCF round timing
   differs.
9. **D3 vault pair list.** The Open Track docx lists AQUA/sUSD and sUSD/USDC among the five new
   vaults; neither appears in the gauge set measured on 12 Aug 2026 (closest are USDC/sUSD at $198K
   and sUSD/EURC at $73K). Confirm the exact pairs before submitting — left unchanged in the docx.
10. **Leverage cap in the contract.** `max_leverage_bps` is 3.0× on the testnet vault; the copy now
    promises ≤1.82×. The contract change is D2, so the promise is forward-looking and correct, but
    do not demo the testnet UI at >1.82× while the application is under review.

## Deliberately excluded

- **BLUB–AQUA as the venue.** Outside the Aquarius gauge whitelist (zero emissions) and too
  shallow to lever. Mentioning it would invite scrutiny that does not help the application.
- ~~Backstop capital in the ask.~~ **REVERSED 2026-08-14** — the backstop is now *in* the ask at
  $13,400. At that size the "we fund our own capital position" argument is worth little, and being
  able to show the exact protocol threshold and its derivation is worth more. Any top-up above the
  threshold minimum remains treasury-funded.
- **Yield claims as projections.** All APY figures are arithmetic outputs of stated
  assumptions. BLUB is a floating asset and must never be described as pegged or redeemable.
