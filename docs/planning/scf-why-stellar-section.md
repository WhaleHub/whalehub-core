# SCF Open Track — "Why Stellar" section, rewritten against live rates

**Source of numbers:** `app.whalehub.io/leverage-calculator.html` (live calculator; identical data to
`public/leverage-calculator.html`). Aquarius pool data from `amm-api.aqua.network/pools/`, Blend
borrow side reconstructed from pool `CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD`
via `get_reserve`. Rates as of 12 Aug 2026. Prices: XLM $0.161989.

**Replaces** the "Why Stellar" paragraph in `WhaleHub_SCF_OpenTrack_Filled.docx`.

---

## Why Stellar

Every primitive this product needs already exists on Stellar, and one of them is priced in a way it
is priced nowhere else. Blend v2 exposes `flash_loan`, so the leveraged open is a single atomic call
with one health check at the end of the stack. Aquarius issues transferable SEP-41 LP share tokens,
so an LP position is an asset a lending pool can actually hold. Reflector supplies the SEP-40 feeds
the invariant-based collateral oracle reads. Soroswap handles the swap leg of the liquidator unwind.
Stellar Wallets Kit covers wallet connection including hardware. Nothing in this proposal waits on a
protocol change or a primitive that does not yet exist.

The decisive number is the cost of borrowing, and on Stellar it is structural rather than incidental.
On Blend mainnet today, 768.59M XLM is supplied — $124.50M — against 1.41M XLM borrowed, $228.7K.
That is **0.18% utilisation against a 40% target**, so Blend's reactive interest modifier has decayed
to its 0.10x floor and **XLM borrows at 0.10% APY**. USDC is the exact mirror: 75.72% utilisation
against an 80% target, modifier ratcheted up to 1.55x, 11.08% APY or **10.79% net** of emissions.
Borrow demand on Stellar is for dollars, not for XLM, so the chain's most-supplied asset sits almost
entirely idle. Leveraged LP farming is the natural consumer of precisely that idle asset, and it is
cheap here in a way it is not on Ethereum or Solana.

That inverts the borrow leg, and the arithmetic is unambiguous. Borrowing USDC at 10.79% against an
Aquarius XLM/USDC concentrated yield of 10.77% *subtracts* return: at 1.55x, $100K of equity nets
**8.93%**, which is 1.84 points worse than simply providing liquidity. Borrowing XLM at 0.10% nets
**14.81% against 10.77%** for plain LPing — an edge of **+4.04 points**, and that is *after*
accounting for the dilution our own deposit causes in the pool. The break-even borrow rate at that
leverage is **27.02%**, roughly 270x the current cost. The margin of safety is the argument here,
not the headline yield.

The leverage cap comes down with it. XLM carries a 133.33% liability factor on Blend, so at the 0.60
collateral factor we proposed to Script3 the liquidation boundary is **1.82x**, and the safe band we
will enforce is **1.67x** (92% of the boundary). That is lower than the 2.33x a USDC borrow would
permit, and we take the lower number deliberately: a near-free borrow asset is worth more to the user
than an extra turn of leverage on an expensive one.

Capacity is bounded by the Aquarius pool, not by Blend. XLM/USDC concentrated holds $1.26M; at 1.55x
the strategy absorbs **$439K of equity** before self-dilution erases the edge, which routes **$681K
of new liquidity into that pool — a 54% increase in depth** on the pair. Applying the same model to
every gauge-enabled Aquarius pair gives **$7.50M of equity and $11.63M of new LP exposure**, against
$23.06M currently deposited across those pools. The debt funding that comes from Blend's idle XLM,
which needs **$49.57M of new borrowing before utilisation even reaches target** — capital already
sitting on Stellar, presently earning the ecosystem nothing.

We are stating the counterweights in the same breath. Borrowing XLM against an XLM-containing LP
partly hedges XLM exposure, but an XLM rally grows the debt while the pool rebalances out of XLM.
The high-APY pairs are unusable at any real size: AQUA/USDC yields 42.12% but holds $90K, so at 1.55x
dilution turns the edge **negative by 18 points**. And the 0.10% XLM rate reflects near-zero
utilisation and will rise as borrowing scales — our own full capacity moves it from 0.100% to 0.103%,
but a larger market would move it further. All of this is exposed in the public model we built for
this application rather than reduced to a single headline figure:
**app.whalehub.io/leverage-calculator.html**.

---

## Supporting figures (for the Sources and assumptions section)

| Input | Value | Source |
| --- | --- | --- |
| Aquarius XLM/USDC concentrated, TVL | $1,256,444 | `amm-api.aqua.network/pools/`, 12 Aug 2026 |
| — 24h volume | $617,774 | same |
| — total APY unboosted (6.23% fees + 4.54% rewards) | 10.77% | same |
| — total APY boosted (ICE) | 17.49% | Aquarius UI |
| Blend XLM supplied / borrowed | 768,590,530.73 / 1,411,861.10 XLM | pool `CAJJZS…BXBD`, `get_reserve` |
| Blend XLM utilisation / target | 0.18% / 40% | derived |
| Blend XLM borrow APY (ir_mod at 0.10x floor) | 0.10% | reconstructed, matches Blend UI |
| Blend XLM liability factor | 133.33% | Blend pool |
| Blend XLM available to borrow | $86.92M | Blend pool |
| Blend USDC utilisation / target, ir_mod | 75.72% / 80%, 1.5478x | pool `CAJJZS…BXBD` |
| Blend USDC borrow APY / net of emissions | 11.08% / 10.79% | Blend pool |
| Blend USDC liability factor | 105.26% | Blend pool |
| XLM price | $0.161989 | CoinGecko, 12 Aug 2026 |

### Outputs of the model (net APY = diluted LP APY x L − net borrow APR x (L−1))

XLM/USDC concentrated, $100K equity, unboosted, self-dilution included:

| Leverage | Borrow XLM | Borrow USDC | Break-even borrow |
| ---: | ---: | ---: | ---: |
| 1.25x | 12.22% (+1.45pp) | 9.55% (−1.22pp) | 48.98% |
| 1.40x | 13.53% (+2.76pp) | 9.25% (−1.52pp) | 33.92% |
| **1.55x** | **14.81% (+4.04pp)** | 8.93% (−1.84pp) | 27.02% |
| 1.67x (cap) | 15.83% (+5.06pp) | 8.64% (−2.13pp) | 23.63% |

Boosted (requires ICE committed to the gauge): 24.08% net at 1.55x, +6.59pp edge.

Liquidation boundary = 1/(1 − CF/LF):

| Collateral factor | Boundary, XLM borrow | Safe band (92%) | Boundary, USDC borrow |
| ---: | ---: | ---: | ---: |
| 0.50 | 1.60x | 1.47x | 1.90x |
| 0.55 | 1.70x | 1.57x | 2.09x |
| **0.60** | **1.82x** | **1.67x** | 2.33x |

Capacity — largest equity at which the edge over plain LPing is still positive, at 1.55x borrowing XLM:

| Pair | Type | TVL | LP APY | Net @1.55x | Edge | Capacity |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| xSolvBTC/SolvBTC | stable | $10.73M | 4.43% | 6.71% | +2.28pp | $3.68M |
| XLM/SolvBTC | volatile | $6.59M | 0.96% | 1.40% | +0.44pp | $1.98M |
| XLM/USDC | volatile | $3.20M | 0.94% | 1.33% | +0.39pp | $959K |
| **XLM/USDC** | **concentrated** | **$1.26M** | **10.77%** | **14.81%** | **+4.04pp** | **$439K** |
| XLM/yXLM | concentrated | $388K | 5.68% | 6.24% | +0.56pp | $134K |
| PYUSD/USDC | concentrated | $286K | 11.00% | 11.01% | +0.01pp | $100K |
| XLM/AQUA | concentrated | $219K | 24.71% | 22.36% | −2.35pp | $77K |
| USDC/sUSD | concentrated | $198K | 28.18% | 24.44% | −3.74pp | $70K |
| AQUA/USDC | concentrated | $90K | 42.12% | 24.00% | −18.12pp | $32K |
| **Total** | | **$23.06M** | | | | **$7.50M → $11.63M exposure** |

Projected XLM borrow rate as our own debt is added (Blend three-slope reactive model at the current
0.10x modifier):

| Our debt | XLM utilisation | Projected rate |
| ---: | ---: | ---: |
| $55K (at $100K equity, 1.55x) | 0.23% | 0.102% |
| $242K (at full $439K capacity) | 0.38% | 0.103% |
| $1M | 0.99% | 0.107% |
| $5M | 4.20% | 0.132% |

### Liquidation — what actually triggers it

The debt is XLM; the collateral is an XLM/USDC LP that is half USDC. Fair LP value scales as
√P_xlm while XLM debt scales as P_xlm, so **an XLM rally is what liquidates, not a crash.**
Blend liquidates when `collateral_usd × CF < debt_usd × LF`, i.e. at an XLM price multiple of
`r = (L·CF / ((L−1)·LF))²`.

XLM rally required to liquidate, borrowing XLM (LF 133.33%):

| Leverage | CF 0.50 | CF 0.55 | CF 0.60 |
| ---: | ---: | ---: | ---: |
| 1.25x | +251.6% | +325.4% | +406.3% |
| 1.40x | +72.3% | +108.5% | +148.1% |
| 1.55x | +11.7% | +35.1% | +60.8% |
| 1.67x | *above boundary* | +5.7% | +25.8% |

**The 92%-of-boundary cap normalises this** — a lower collateral factor forces lower leverage, so
the buffer is roughly constant whatever Blend sets:

| CF | Boundary | UI cap (92%) | Liquidates at |
| ---: | ---: | ---: | ---: |
| 0.50 | 1.60x | 1.47x | XLM +36.8% |
| 0.55 | 1.70x | 1.57x | XLM +30.3% |
| 0.60 | 1.82x | 1.67x | XLM +25.2% |

⚠️ **Do not quote a fixed 1.55x without naming the collateral factor.** At CF 0.50 the boundary is
1.60x, so a 1.55x position sits at 97% of it and liquidates on an **11.7%** XLM move. Leverage must
be expressed relative to the boundary, never as an absolute number.

Equity outcome at 1.55x / CF 0.60, price-only, ignoring yield — the position is **partly short XLM**:

| XLM move | Levered equity | Plain LP |
| ---: | ---: | ---: |
| −50% | −17.9% | −29.3% |
| −30% | −8.8% | −16.3% |
| 0% | 0.0% | 0.0% |
| +30% | +5.2% | +14.0% |
| +50% | +7.3% | +22.5% |
| +61% | **liquidated** | +26.8% |

Accrued interest is immaterial to this: XLM debt at 0.10% APR moves the liquidation threshold by
~0.2 percentage points of XLM move per year.

---

## ⚠️ Consequential edits the rest of the docx now needs

The live rates contradict several statements currently in `WhaleHub_SCF_OpenTrack_Filled.docx`:

1. **"flash-borrows 2,000 USDC … borrows 2,000 USDC"** (What we are building, A) — the worked
   example must borrow **XLM**, not USDC. USDC at 10.79% net is above the 10.77% LP yield, so the
   flagship example as written loses money.
2. **"$1,000 of equity becomes $2,500 of LP exposure … at 2.5x"** — 2.5x is not reachable borrowing
   XLM. At CF 0.60 the boundary is 1.82x and the enforced band is 1.67x. Restate as
   *$1,000 equity → $1,550 exposure with $550 of XLM debt at 1.55x.*
3. **"a 14% borrow rate against an 8% LP yield returns minus 1%"** — replace with the measured
   inversion, which is stronger because it is real: *borrowing USDC at 10.79% against a 10.77% LP
   yield returns 8.93% at 1.55x, worse than not levering at all — which is why the product borrows XLM.*
4. **"Maximum leverage 2.5x, which is 1 over (1 minus collateral factor)"** (Oracle and risk) — the
   formula omits the liability factor. It is 1/(1 − CF/LF) = **1.82x** for XLM at CF 0.60.
5. **"correction of the 3.0x leverage cap to 2.5x"** (D2) — the corrected cap is **1.82x**, with the
   UI band at 1.67x.
6. **"Pool TVL cap of $1M at launch"** — the target pool cannot absorb it. Measured capacity is
   **$439K of equity** on XLM/USDC concentrated. Either revise the cap to ~$450K on the launch pair,
   or state it as a $1M cap spread across multiple pairs (the full gauge set supports $7.50M).
7. **"Unleveraged LP APY: read live on submission day"** / **"USDC borrow APR: read live on
   submission day"** (Sources and assumptions) — these are now measured; replace with the figures in
   the table above and cite the calculator URL.
8. **Deliverable D3 vault list** includes AQUA/sUSD and sUSD/USDC, which do not appear in the
   Aquarius gauge set we measured (the closest are USDC/sUSD at $198K and sUSD/EURC at $73K).
   Confirm the exact pairs before submitting.
