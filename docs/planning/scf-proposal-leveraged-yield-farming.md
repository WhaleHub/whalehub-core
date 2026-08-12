# SCF Proposal — Leveraged Yield Farming on Blend v2

**Status:** DRAFT for review — not submitted.
**Prepared:** 2026-08-11
**Category:** Build
**Requested:** $106,000
**Applicant:** WhaleHub · Viktor Vostrikov · viktor@whalehub.io
**Structure modelled on:** SCF #44 submission `recuUVlYWqrAk5t9Z` (Etesia, $113.0K, Build).
**Presentation PDF:** [`assets/WhaleHub_SCF_Leveraged_Yield_Farming.pdf`](assets/WhaleHub_SCF_Leveraged_Yield_Farming.pdf)
— 6 pages with charts, for sending to reviewers. This markdown is the long-form source of
record; the PDF is the explainer. Regenerate it with the two scripts in
`assets/generator/` (`mkcharts.py` then `build_pdf.py <dest>`); charts are computed
vector SVG, rendered via headless Chrome `--print-to-pdf`.

> **⚠️ RATE INPUTS SUPERSEDED 2026-08-12 — the economics in this draft are stale.**
> Live data now measured (see [Verified rates](#verified-rates-2026-08-12)):
> Aquarius XLM/USDC concentrated yields **10.77%** unboosted (not the 20% assumed), and Blend
> **USDC borrows at 10.79% net** — *above* that yield, so borrowing USDC makes a leveraged
> position lose money. **XLM borrows at 0.10%**, which is the only viable borrow asset.
> Measured strategy capacity is **~$439K of equity**, not the $1M cap proposed to Script3.
> Interactive model: `assets/leverage-calculator.html`.
> Sections below still carry the old 20%/8% figures — rewrite before submitting.

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
chooses a target leverage. One transaction later they hold a position of roughly 2–2.5× their
original exposure, with a USDC debt against it on a Blend pool. They can unwind at any time,
partially or fully.

### The atomic open

The vault composes one Blend `flash_loan` call whose request stack does the entire job:

```
1. FlashBorrow      USDC from the Blend pool          (callback receives funds)
2. Zap              swap half → pair, deposit → LP    (Aquarius / Soroswap, outside Blend)
3. SupplyCollateral  resulting LP → Blend pool
4. Borrow           USDC against the new collateral
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
| Collateral factor | 0.50–0.60 | Conservative for a new collateral class; caps leverage at 2.0–2.5× |
| Max leverage | ≤ 2.5× | Set at the liquidation boundary implied by the collateral factor |
| Pool TVL cap | $1M at launch | Bounds ecosystem exposure while the class is proven |
| Backstop | Funded by WhaleHub treasury | **Not requested from SCF** — our capital at risk, not the community's |
| Liquidation | Open-source reference liquidator + WhaleHub-operated bot | Guarantees liquidations clear from day one |

### Returns, stated honestly

Leverage multiplies a spread in both directions:

```
net APY on equity = (LP APY × L) − (borrow APR × (L − 1))
```

At 2.5× against a 20% unleveraged LP yield and an 8% USDC borrow rate, that is **38% before
fees**. But at a 14% borrow rate against an 8% LP yield it is **−1%** — the user pays to
farm. Blend borrow rates are utilisation-driven and move without notice, so the product is
presented as a spread trade with live health-factor and net-APY display, never as
"boosted yield". The UI shows the break-even borrow rate for the user's chosen leverage
before they sign.

### Why this belongs on Stellar, and why now

Three things land at once: Blend v2's flash-loan primitive is live on mainnet, Aquarius LP
share tokens are transferable Soroban assets, and Reflector provides the independent price
feeds the oracle needs. The product is only buildable because all three exist. It also
creates durable ecosystem value beyond WhaleHub — a new collateral class on Blend, a
reference implementation other teams can fork for any LP-collateral market, and materially
deeper Aquarius liquidity, since each leveraged position deposits 2–2.5× the LP a user could
provide alone.

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

**$106,000** across three tranches and nine deliverables.

Explicitly **not** included: the Blend backstop deposit required to activate the mainnet
pool. That is funded from WhaleHub treasury. We are asking the community to fund
engineering, audit and safety infrastructure — not our capital position.

| Tranche | Focus | Deliverables | Budget |
| --- | --- | --- | ---: |
| 1 | Economics & risk core | D1–D3 | $39,500 |
| 2 | Safety & liquidation | D4–D6 | $31,900 |
| 3 | Audit & mainnet | D7–D9 | $34,600 |
| | | **Total** | **$106,000** |

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

## Tranche 1 — Economics & risk core

### Deliverable 1 — Fair-LP oracle adapter with Reflector
**Completion:** 15.09.2026 · **Budget:** $13,500

Soroban oracle adapter implementing `LP_price = 2·√(K · P_a · P_b) / L` against Reflector
feeds for the underlying assets. Reads the Aquarius pool invariant and LP total supply
on-chain; no dependence on pool spot or pool TWAP. Includes deviation circuit breakers that
halt new borrows on stale or dislocated feeds, a fallback path when a Reflector feed is
unavailable, and a manipulation test suite that attempts flash-loan price attacks against the
adapter and asserts they fail. This is the component Blend's review flagged as most critical,
and it is designed but not yet built.

### Deliverable 2 — Performance-fee and accounting module
**Completion:** 29.09.2026 · **Budget:** $9,800

Fee mechanism in the vault: a performance fee assessed on net profit **after** borrow costs,
so nothing is charged when the spread inverts. Includes high-water-mark accounting per user
share, treasury routing, an admin-settable rate with a hard ceiling, and events for
off-chain accounting. Also corrects the current `max_leverage_bps` cap of 3.0×, which sits
above the liquidation boundary implied by a 0.5–0.6 collateral factor, to an enforced ≤2.5×.
Shipped before mainnet by design: retro-fitting fees onto live user positions is both harder
and unfair to early depositors.

### Deliverable 3 — Per-user risk isolation
**Completion:** 13.10.2026 · **Budget:** $16,200

The current vault holds one aggregate Blend position, so a liquidation socialises across all
depositors, Aave-style. This deliverable adds per-user health tracking and per-user
liquidation so one over-levered user cannot impose losses on conservative ones: per-user
health factor derived from live Blend state, isolated liquidation that touches only the
offending user's share, and per-user leverage limits. This is the largest engineering item
and the one that makes the product safe for depositors who are not monitoring hourly.

---

## Tranche 2 — Safety & liquidation

### Deliverable 4 — Open-source reference liquidator
**Completion:** 27.10.2026 · **Budget:** $12,400

A public, MIT-licensed liquidator contract executing the four-step LP unwind atomically:
acquire debt asset → repay → withdraw LP collateral → redeem LP through Aquarius. Any
third-party bot can fork it or compose with it. Published with documentation and a testnet
harness so liquidators can dry-run before committing capital. **This is deliberately built as
ecosystem infrastructure, not WhaleHub-private:** any future LP-collateral market on Blend
can reuse it, which is the single most reusable artefact in this proposal.

### Deliverable 5 — Health keeper and monitoring
**Completion:** 10.11.2026 · **Budget:** $10,600

Off-chain keeper that watches every position's health factor and acts before liquidation:
tiered user alerts as health degrades, a WhaleHub-operated liquidation bot so liquidations
clear from launch day, and public dashboards for pool utilisation, aggregate leverage and
collateral composition. The keeper holds no privileged permissions — it sends only
transactions any participant could send.

### Deliverable 6 — Soroban footprint validation and stress testing
**Completion:** 24.11.2026 · **Budget:** $8,900

Measure the full liquidation sequence, including oracle reads, against Soroban resource
limits at edge-case position sizes — a commitment already made to Script3, because a
liquidation that exceeds the footprint ceiling is an un-liquidatable position. Plus scenario
testing: correlated price crashes, borrow-rate spikes that invert the spread, Aquarius
depth collapse, oracle outage, and a bank-run unwind where many users exit at once.
Deliverable is a published report with any resulting design changes.

---

## Tranche 3 — Audit & mainnet

### Deliverable 7 — Third-party security audit and remediation
**Completion:** 08.12.2026 · **Budget:** $18,000

Full external audit of the vault, zapper, oracle adapter and liquidator by a firm with
Soroban experience, followed by remediation and a published report. Scope centres on the
flash-loan request stack, oracle manipulation, share-accounting invariants under
liquidation, and authorisation boundaries. Largest single line item, and non-negotiable
before mainnet: this contract composes user funds with a third-party lending protocol.

### Deliverable 8 — Production frontend and Stellar Wallets Kit
**Completion:** 22.12.2026 · **Budget:** $9,400

Productionise the `/leverage` interface for mainnet: live reserve-based zap quoting
(replacing the current placeholder slippage haircut), health-factor and net-APY display with
the break-even borrow rate shown before signing, position management and unwind flows, and
Stellar Wallets Kit integration for Freighter, LOBSTR, xBull and hardware wallets. Includes
a risk-disclosure flow that requires explicit acknowledgement of liquidation risk.

### Deliverable 9 — Mainnet launch, composability and documentation
**Completion:** 12.01.2027 · **Budget:** $7,200

Mainnet Blend pool deployment with the agreed parameters and treasury-funded backstop,
staged launch under the $1M TVL cap, and a composability interface so wallets and
aggregators can route into the strategy. Complete public documentation: architecture,
oracle design, risk parameters, liquidation mechanics, and an integration guide for teams
building LP-collateral markets on Blend.

---

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

1. ~~20% unleveraged LP APY baseline.~~ **DONE 2026-08-12** — actual 10.77% unboosted /
   17.49% boosted on XLM/USDC concentrated. The 38% headline is not achievable at these rates;
   realistic is ~14.8% net at 1.55× borrowing XLM, against 10.77% for plain LPing.
2. ~~8% USDC borrow APR.~~ **DONE 2026-08-12** — USDC 10.79% net (unusable), XLM 0.10%.
   Rewrite pages 2 and 4 of the PDF around XLM as the borrow asset.
3. **Backstop cost.** The mainnet threshold and BLND price were not obtainable — the Blend
   API did not respond and BLND was not on the CoinGecko ID tried. Testnet-derived
   indication is ~167,800 BLND + ~12,600 USDC. Confirm with Script3 and size the treasury
   commitment before promising it in writing.
4. ~~Target pair TVL.~~ **DONE 2026-08-12** — XLM/USDC concentrated holds $1.26M, which does
   **not** support a $1M equity cap. Measured capacity ~$439K. Renegotiate the cap with Script3.
5. **Last-resort liquidator cap.** The Script3 letter commits WhaleHub treasury to absorbing
   positions no profit-motivated buyer takes. Negotiate an explicit ceiling — uncapped, this
   is open-ended balance-sheet risk against modest revenue.
6. **Team section.** See TODO above.
7. **Budget rates.** Deliverable costs are scoped by effort against a $113K comparable, not
   built from actual contractor quotes. Sanity-check against real rates.
8. **Milestone dates** assume a start immediately post-award; shift if the SCF round timing
   differs.

## Deliberately excluded

- **BLUB–AQUA as the venue.** Outside the Aquarius gauge whitelist (zero emissions) and too
  shallow to lever. Mentioning it would invite scrutiny that does not help the application.
- **Backstop capital in the ask.** Funding our own capital position from a community grant
  weakens the proposal; treasury-funded is a strength.
- **Yield claims as projections.** All APY figures are arithmetic outputs of stated
  assumptions. BLUB is a floating asset and must never be described as pegged or redeemable.
