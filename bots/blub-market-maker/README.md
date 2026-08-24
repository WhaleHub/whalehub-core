# BLUB/AQUA SDEX Market-Making Bot (v1)

A standalone Node.js + TypeScript bot that posts tight two-sided **BLUB/AQUA** limit
offers on the classic Stellar DEX (SDEX). Its job is to make the *displayed* BLUB price
coherent (today the book is a canyon — best bid ~0.51 / best ask ~0.92 AQUA) and to earn
the spread, quoting around a robust fair mid with the **1.00 peg as a hard ceiling**.

> ⚠️ This is a **review/handoff** build. It ships with `DRY_RUN=true` — it computes and
> logs the offers it *would* place but submits nothing. Victor: review, then flip to live.
> It does **not** touch the WhaleHub protocol/frontend and shares no code with it.

## What it does (and doesn't)

- **Does:** read the Aquarius StableSwap pool reserves (reference price), read the SDEX
  order book, compute a fair sub-peg mid, build a ladder of bids/asks with inventory skew,
  and reconcile that against our live offers (create/update/cancel with churn suppression).
- **Doesn't (v1):** trade against the Aquarius Soroban pool, do cross-venue arbitrage, or
  restore the peg. A bot stabilizes the *shown* price and captures spread; it cannot
  manufacture a peg (that needs real AQUA backing / less BLUB supply). The strategy layer
  is behind a `Strategy` interface so an arbitrage module can be added later.

## Quick start (dry-run — safe, no keys, no orders)

```bash
cd bots/blub-market-maker
npm install
cp .env.example .env      # defaults are fine; DRY_RUN=true, no BOT_SECRET needed
npm run dev               # watch the structured logs
```

Each cycle logs the reference sources + freshness, the chosen **sub-peg** mid, the computed
bid/ask ladder (asks capped at 1.00), and the intended CREATE/UPDATE/CANCEL actions — with
**nothing submitted**.

## Tests

```bash
npm test                    # unit tests (no network)
npm run typecheck           # tsc --noEmit
RUN_INTEGRATION=1 npm run test:integration   # read-only live-endpoint smoke test
```

## Going live (Victor)

1. **Provision a dedicated bot wallet** (a fresh keypair — NOT the multisig). Fund it with:
   - trustlines to **AQUA** (`GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA`)
     and **BLUB** (`GDERSSCKJQPPXUQOZIOXGRVAGNLVPVZCJ2MAX7RCMVMWGRPVAEG7XGTK`),
   - inventory of both assets,
   - enough **XLM** for base reserve (0.5 XLM per open offer) + fees + `MIN_RESERVE_BUFFER_XLM`.
   The bot refuses to run live if the trustlines are missing.
2. Set `BOT_SECRET` (env or secret manager — never commit it).
3. Start conservative: `LADDER_LEVELS=1`, a wide `HALF_SPREAD_BPS`, small `ORDER_SIZE_BLUB`.
4. Flip `DRY_RUN=false` and restart. Watch the logs and metrics for a few cycles.
5. Tighten spread / add levels gradually.

Run it as a **long-running process** (systemd / PM2 / Docker / a DO app) — it needs to quote
continuously; it is *not* a cron job.

## Controls & safety

- **Kill switch:** create the file named by `KILL_SWITCH_FILE` (default `./STOP`) → the bot
  cancels all offers and idles until you remove it.
- **Graceful shutdown:** `SIGINT`/`SIGTERM` cancels all open offers, then exits.
- **Soft disable:** set `DRY_RUN=true` and restart.
- **Circuit breaker:** if the reference price is stale/unavailable or out of a sane band, the
  bot cancels all offers and quotes nothing until a fresh in-band reference returns
  (re-arms after `BREAKER_REARM_CYCLES` healthy cycles).
- **Peg ceiling:** asks are hard-capped at `PEG_CEILING` (1.00) — the bot never sells BLUB
  above peg on our own book. The bid floats down with the market (floored at `PRICE_FLOOR`).
- **Exposure caps & balance-aware sizing:** ladder sizes are bounded by `MAX_EXPOSURE_*` and,
  in live mode, by actual balances.

## Configuration

Everything is in `.env` (see `.env.example` for the full annotated list). Key knobs:
`HALF_SPREAD_BPS`, `ORDER_SIZE_BLUB`, `LADDER_LEVELS`, `LEVEL_STEP_BPS`, `TARGET_BLUB_FRACTION`,
`SKEW_FACTOR`, `MAX_SKEW_BPS`, `MIN_REPRICE_BPS`, `MAX_EXPOSURE_BLUB/AQUA`, `PRICE_FLOOR`,
`PEG_CEILING`, `REF_QUOTE_SIZE_BLUB`, `MAX_REFERENCE_AGE_MS`, `LOOP_INTERVAL_MS`.

## Architecture

```
config/     env + JSON config (zod-validated)
pricing/    stableSwap math · amm-api quote · referenceEngine (fair mid + peg ceiling + breaker)
strategy/   marketMaker (ladder) · inventorySkew · Strategy interface (arb plugs in here later)
execution/  reconciler (diff live→desired, churn suppression) · offerOps · executor (dry-run/live)
stellar/    horizonClient (SDEX + submit) · sorobanClient (read-only pool reserves) · assets
risk/       riskManager (breaker + validation) · killSwitch
core/       loop (Engine) · state (offer-id cache + breaker state)
obs/        logger (pino) · metrics
```

## Notes / open items flagged for review

- **StableSwap math** uses the Curve convention `Ann = A·n`. The reference engine cross-checks
  it against the Aquarius `amm-api` `find-path` quote; if a `get_amount_out`-style on-chain read
  exists on the pool, prefer it. The price *at balance* is 1.0 regardless of convention (tested).
- **amm-api** (`find-path`) is treated as an optional cross-check with a short timeout — a schema
  change can't break quoting.
- Reference/patterns were adapted from the app's `src/services/soroban-vault.service.ts` and
  `soroban.service.ts` (RPC retry/fallback, reserve reads, server-side signing).
