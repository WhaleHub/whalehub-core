# Message to the Blend team (Script3)

**Status:** ready to send · drafted 2026-08-27 · every figure below re-read from chain the same day.
Paste as-is (Discord/email). Trim the appendix if it's going into a chat window.

---

## Leveraged LP farming on Blend v2 — testnet complete, questions on the mainnet path

Hi — following up on the earlier architecture review. Short version: the integration is **working
end-to-end on testnet**, including liquidation, and we'd like your guidance on the mainnet path
before we commit to parameters.

WhaleHub is a yield optimiser on Stellar (live on mainnet since Feb 2026). What we've built on Blend
lets a liquidity provider multiply an Aquarius LP position in **one signed transaction**, using the
raw LP share token as collateral: flash-borrow → zap into more LP → supply as collateral → borrow to
repay the flash leg, with a single health check at the end of the request stack.

### What's verified on testnet

We deployed the whole environment ourselves — Blend pool, oracle, an Aquarius-interface AMM, and a
self-funded backstop — rather than asking you for anything. Transactions are on record:

| What | Result | Transaction |
| --- | --- | --- |
| **Atomic leveraged open** | 100 LP equity + 100 borrowed → 149 LP collateral / 100 debt (**1.495×**) | `5e7a0e2424e91829757bbef55c9841c3ebd18a6ad29dc24b7ae26580ecb2a48d` (2026-08-15) |
| **Partial unwind** | repay 100, withdraw 149.5 LP; shares burned pro-rata, other depositors untouched | `a36dc9a14f650fde241e7684846983830e3181da553f69c9b11d106483f16afb` (2026-08-15) |
| **Third-party wallet, through the UI** | 10 LP + 10 borrowed → +149.25 LP collateral / +99.99 debt | `f98b24b92aacbde1da862a9fb22ee7108282ff2c7f59768a5856b73b6ad94f59` (2026-08-25) |
| **Liquidation drill** | oracle price $2.00 → $0.30; 50% auction correctly refused (`#1214 InvalidLiqTooSmall`), 100% accepted; fill emitted correct terms and reverted `#1205 InvalidHf` at block 0 — Dutch-auction protection behaving exactly as designed | 2026-06-28 |
| **Re-parameterised to a production-like c_factor** | LP reserve c_factor 0.90 → **0.60** | `ef53d290b9278e92600c87b06d15b038dd7bd8c80068b7adda1d0346b4d0cc0f` (2026-08-27) |
| **Open at 1.99× under that c_factor** | 100 LP equity + 200 borrowed → +198.5 LP collateral / +200 debt; pool position now 312.4 LP against 260.0 debt | `216594579bea470e128f58dbe24e46c80a4c01005881b27b8c58ff57196c7fc4` (2026-08-27) |

### The parameter test, and one finding worth your attention

With c_factor 0.60 on the LP and l_factor 0.95 on the borrowable, the liquidation boundary is
`1/(1 − 0.60 × 0.95)` = **2.33×**. We ran both sides of it:

- **1.99× — accepted**, the transaction above. Position is healthy with room to spare.
- **2.49× — refused by Blend with `#1205 InvalidHf`**, correctly, at the end-of-stack health check.

The finding is on our side and we're flagging it rather than hiding it: our vault still carries
`max_leverage_bps = 30000` (3.0×) from early testing, which is **above** the Blend boundary. So at
2.49× the vault happily built the request stack and **Blend was the only thing that stopped it**.
Your health check behaved exactly as it should — but a vault whose own cap sits above the boundary
is a vault that wastes user gas discovering the limit. We're lowering ours to 92% of the boundary
before mainnet, so Blend's check is the backstop rather than the primary control.

Same arithmetic with mainnet's XLM l_factor of 0.75 gives a **1.82×** boundary, and a ~1.67×
interface cap.

The vault's live position on our testnet pool right now: **collateral 3,124,260,055 (reserve 0),
liabilities 2,599,810,972 (reserve 1)** — effective collateral ~$375 against ~$274 of effective
debt at the new c_factor.

### How it's wired

- The **vault** is the Blend `from` and owns a single position; a **separate zapper contract** is the
  flash-loan receiver. That split is not cosmetic — with the vault as its own `exec_op` receiver,
  Soroban rejects the callback (`Error(Context, InvalidAction)`, "Contract re-entry is not allowed")
  because the vault is still on the stack inside `open_position`. Worth flagging for anyone else
  composing `flash_loan`; we're publishing it.
- Depositors hold **shares of the vault's Blend position**, derived on read from
  `pool.get_positions(vault)` (bToken/dToken) rather than an internal ledger. Interest and
  liquidation socialise pro-rata with nothing to reconcile — an earlier internal-ledger design
  desynced the moment a liquidation touched the position.
- `SupplyCollateral` pulls the LP by `transfer_from`, so the vault pre-approves the pool before the
  loan; the non-flash unwind needs `authorize_as_current_contract` on the `Repay` transfer, since an
  allowance doesn't cover the pool spending as `spender`.

### Current testnet parameters

| Reserve | c_factor | l_factor | max_util |
| --- | ---: | ---: | ---: |
| LP share token (index 0) | **0.60** (was 0.90) | 0.90 | 0.95 |
| TUSDC borrowable (index 1) | 0.95 | 0.95 | 0.95 |

We started at 0.90 to exercise the mechanism, then lowered the LP c_factor to 0.60 — our mainnet
intent — and re-ran the flow against it, which is where the numbers above come from.

Note for anyone reading this later: the 7-day timelock on `set_reserve` applies to a pool that has
left Setup, so the c_factor change had to be queued a week ahead (`#1203 InitNotUnlocked` until it
elapsed). That's the basis for question 4 below.

---

## Questions

**1. Mainnet pool activation — the main one.** We plan to deploy our own pool via PoolFactoryV2 with
two reserves (Aquarius LP as collateral, XLM borrowable) and fund the backstop ourselves. We read the
threshold as `bal_blnd⁴ × bal_usdc ≥ 1e25` on the underlying of the pool's backstop shares; since
backstop shares are Comet BLND:USDC 80/20, that resolves to a single point — **247,464 BLND + 2,667
USDC ≈ $13.3K** at BLND $0.043. Two things we'd like confirmed:

- Is clearing the threshold the whole story, or is there a reward-zone / whitelist step that also
  needs your side?
- $13.3K of first-loss capital against a market that could hold ~$450K of equity looks thin to us.
  **What backstop size would you actually want to see** before this is a market you're comfortable
  existing? We'd rather size it to your answer than to the minimum.

**2. LP share token as a collateral class.** As far as we know this would be the first AMM LP token
used as Blend collateral. We've now run the flow at **c_factor 0.60** end-to-end (above), and 0.50
is equally workable — it just lowers the boundary. Does 0.50–0.60 look right to you for a
first-of-kind LP collateral, and is there anything else in the reserve config (max_util, supply cap,
the IR curve) that should differ from a plain asset? We'll take your number over ours.

**3. Oracle.** We intend to point the pool at our own adapter implementing the Blend oracle
interface, pricing the LP from the pool invariant plus Reflector feeds
(`LP = 2·√(K·P_a·P_b)/L`) rather than pool spot or TWAP, with a deviation breaker that halts new
borrowing on a stale or dislocated feed. Questions:

- Is a custom oracle contract per pool something you're comfortable with, and are there requirements
  we should meet (decimals, base asset, staleness semantics, `prices` vs `lastprice`)?
- Would you want that adapter in scope for the audit before you'd consider the pool legitimate?

One testnet finding worth passing on: when our oracle's price entries expired under Soroban state
TTL, **every** entrypoint reverted with an untyped host trap
(`VM call trapped: UnreachableCodeReached`) rather than `PoolError::InvalidPrice (#1210)`, and
nothing in the trace named the oracle. A missing price and a bad price surface very differently; if
`#1210` could cover the missing case it would save integrators a lot of time.

**4. Reserve timelock.** Adding a reserve to a pool that has left Setup costs a week
(`#1203 InitNotUnlocked` until it elapses) — we hit this adding a second market and waited it out.
For mainnet, is the intended pattern to configure every reserve during Setup before activation? Is
there any supported path to add one later without the wait, or is a fresh pool the answer?

**5. Liquidation and bad debt.** Our drill suggests liquidation works correctly against the vault at
the Blend level, and we're publishing an MIT-licensed reference liquidator that unwinds atomically
(win auction → withdraw LP through Aquarius → swap one leg → repay), plus running our own bot so
auctions clear from day one. Given the collateral is an LP token rather than a listed asset:

- Do you expect meaningful third-party liquidator interest, or should we assume we're the liquidator
  of last resort? (We're willing, but we'd want an explicit ceiling rather than open-ended exposure.)
- Any concern about concentration — early on, one vault position is effectively the whole market.

**6. Interface stability.** Are `flash_loan` and the `exec_op(caller, token, amount, fee)` receiver
signature stable for the foreseeable future? We'd rather know now than discover it at upgrade time.

---

## What we're not asking you to solve

Flagging these so it's clear what's on our side of the line, all scheduled before mainnet:

- **Per-user isolation.** v1 socialises liquidation losses across vault depositors (the Aave model).
  Fine at launch size under an equity cap, not fine at scale.
- **Leverage cap.** `max_leverage_bps = 30000` (3.0×), above the boundary — the gap demonstrated
  above. Comes down to 92% of the boundary before launch.
- **Self-closing unwind.** v1 requires the user to bring the repay asset; a flash-loan close is a
  follow-up.
- **Third-party security audit** of vault, zapper, oracle adapter and liquidator.

Happy to walk through any of it live, and to share the repo — the contracts, the testnet runbook and
the failure modes above are all going out publicly regardless, so other teams don't repeat them.

Thanks,
Viktor — WhaleHub

---

## Appendix — testnet addresses

| Component | Address |
| --- | --- |
| Leverage vault | `CC2JF2VP3LVNHYI7URF3R376FCVFSAI4HNVZ2WPZZHBJDAJSWX2X2PFH` |
| Zapper (flash-loan receiver) | `CCUDFI62LH2IMHGSRBLLF7SIKRPDQ3LZPA4TYFBFS5ENRYWZOHOKSHT2` |
| Blend v2 pool (ours) | `CDSFGJOQ5RHIPK5522VVCNYNOQH4ECGRTPWZK6QBQV4XXA4IAE5BVTW4` |
| Oracle (mock, stands in for the adapter) | `CCBQAAFHTGG6EUPB4SXBJNHAYVVEB746E4RNPOG55MV77NNYLJZRMIUK` |
| AMM / LP share token | `CDOTVNSYEFF6TWAFSMO3AVSHYEMTMAWTR2E7GXUOOLOCSEC6UV6KJWGC` |
| TUSDC (borrowable) | `CA2AYW5YFEI36LY5L7NTDN666KMR7SBCY4MLY6FA6UMAYBF3ZS7PR7WH` |
| TAQUA (pair leg) | `CAMP6O2ZGMY65DDCJKC7RGZVSOWTFHQDHG6MHD2BRZXBUQBIYNQJMCUJ` |

Live interface (testnet-pinned): `app.whalehub.io/leverage`

---

### Internal notes — not part of the message

- **Backstop story to tell if asked how we funded testnet:** faucet-farmed ~34 throwaway accounts
  into ~180k BLND + ~27k USDC, joined Comet, deposited the LP, `set_status(0)`. Shows we exhausted
  self-service before asking.
- **Deliberately omitted:** the ICE position size (860M, stays internal), SCF budget figures, and
  our own bug history beyond the re-entrancy finding (which is useful to them).
- **Mainnet-parameter test: DONE 2026-08-27.** c_factor lowered to 0.60 (`ef53d290…`), 1.99× open
  accepted (`21659457…`), 2.49× refused by Blend with `#1205`. The message now carries measured
  results rather than intent.
- **Exact mainnet parity is not reachable on this pool.** The 1.82× figure assumes the borrowable's
  l_factor is 0.75 (XLM on mainnet); our TUSDC reserve is at 0.95, giving a 2.33× boundary. Lowering
  it means queueing another `set_reserve` and waiting another 7 days. Not worth blocking the message
  — the arithmetic is identical, only the input differs — but don't claim we tested at 1.82×.
- **Our own bug found while testing, NOT in the message:** the vault's leverage guard is wrapped in
  `if collateral_lp_amount > 0`, so an open with **zero** up-front collateral skips the cap check
  entirely and only Blend's health check applies. Harmless today (Blend catches it) but it should be
  fixed alongside lowering `max_leverage_bps`.
