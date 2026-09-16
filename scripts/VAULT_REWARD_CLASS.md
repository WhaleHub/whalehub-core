# Vault Reward Classes — status, outage post-mortem, open decisions

**As of 16 September 2026.** Written from the contract and live chain, not the docs.

Two separate things are tangled together here and it is worth keeping them apart:

1. **A six-day outage** in which no vault depositor earned anything. Diagnosed and
   fixed — see §2.
2. **The AQUA-only reward class does not exist on-chain**, while the live app copy
   implies it does. Not yet fixed; needs two decisions first — see §4 and §5.

---

## 1. Current on-chain state

Contract `CC72BEVVKHQ57PB5FCKAZYRXCSR6DOQSTN46QR7RZMMM64YWNRPDS24S`.

| | |
|---|---|
| `pool_count` | 3 |
| Pool 0 | BLUB-AQUA, **active**, 2,259,600.80 LP, share `CDMRHKJC…` |
| Pool 1 | XLM-USDC, inactive, 5.46 LP |
| Pool 2 | XLM-AQUA, inactive, 33.08 LP |
| `get_reward_policy` | payout **AQUA**, 50/30/10/10, `allow_user_choice: true` |

**There is no second BLUB-AQUA bucket.** All three pools have distinct share
tokens. Every vault depositor — AQUA-only or pair — sits in pool 0 and earns
identically. `lp_bps = 3000` exists in the policy, but the contract has no notion
of an "AQUA-only class"; it only knows `pool_id`s.

### What the contract already supports

- Two `PoolInfo` buckets may point at the same Aquarius pool and share token.
  `vault_lp_credit()` sums `total_lp_tokens` across every bucket sharing a
  `share_token`, so the POL-surplus guard stays solvent with a second bucket.
  That is the entire design for separating classes: **two buckets, one physical
  LP balance.**
- `add_pool(manager, pool_address, token_a, token_b, share_token)` is
  **manager-auth, not multisig**. Returns the new `pool_id`.
- `admin_compound_deposit` **refuses a bucket where `VaultTotalShares == 0`**
  (guard added 11 Sep). A fresh bucket must therefore be seeded with a real
  `vault_deposit_single` before any Stream B lands, or the compound reverts.

---

## 2. The outage — no vault rewards for six days

**Pool 0 last compounded 2026-09-10 18:01 UTC.** `get_pool_compound_stats(0)`
shows `compound_count` stuck at 1972.

> Note: `total_lp_tokens` *did* grow over the same period (22.48T → 22.60T
> stroops). That was **user deposits**, not compounding. `compound_count` is the
> reliable signal; total LP is not.

### Evidence

- `total_rewards_added` rose 5,205,188 → 5,391,227 over two days — Stream A
  (stakers) healthy throughout.
- Manager AQUA balance **0.0000** — nothing stranded mid-flight.
- Horizon operation history: `add_rewards` fired at 18:00 on both 09-14 and
  09-15, with **no `admin_compound_deposit` and no `manual_deposit_pol`**
  anywhere.

So the cron was running the whole time. It was pouring everything down one pipe.

### Cause 1 — the upgrade window (11 → 14 Sep)

Contract `8f821edf` added `min_lp_out` to `admin_compound_deposit` and
`manual_deposit_pol` on 11 Sep. The backend carrying the matching arity did not
deploy until 14 Sep. In between, both calls failed on signature mismatch while
`add_rewards` — unchanged — kept working.

This gap was known and accepted at the time. Its cost is now measurable: three
days of no vault compounding.

### Cause 2 — the split validator (14 Sep onward)

Introduced by the v3 backend commit. A v2-era deployment sets
`BRIBE_STAKER/VAULT/POL_BPS` to 50/30/20 and knows nothing about a treasury
share. The new treasury default of 1000 pushed the total to **11000**, the
validator rejected the config, and the fallback routed **100% to stakers**.

The fallback was commented "safe and reversible". It was neither. Three of four
streams went dead, and nothing alerted, because a run that sends everything to
Stream A looks like a successful run.

### Fix — `5705090`, deployed 16 Sep 07:07 UTC

- The legacy three-way config is now recognised explicitly: if
  `staker + vault + pol` already totals 10000 and a treasury default was added on
  top, run with `treasury = 0` and warn. **This restores Stream B on the next
  cron run with no env change required.**
- A genuinely unusable split now falls back to the v3 defaults
  (5000/3000/1000/1000), never to 100% stakers. An unroutable config should
  degrade to the intended split, not to one that quietly starves three streams.

**Verify after the next 6-hourly run (00/06/12/18 UTC):**

```bash
stellar contract invoke --id CC72BEVVKHQ57PB5FCKAZYRXCSR6DOQSTN46QR7RZMMM64YWNRPDS24S \
  --source blub-issuer-v2 --rpc-url https://soroban-rpc.mainnet.stellar.gateway.fm \
  --network-passphrase "Public Global Stellar Network ; September 2015" \
  --send=no -- get_pool_compound_stats --pool_id 0
```

`compound_count` must exceed 1972. If it has not moved, the cron is not reaching
Stream B and the DO logs are the next place to look.

---

## 3. The live copy currently overstates the distinction

The served bundle (build `d128b3a`) tells users that pair deposits earn **fees
only**, and that AQUA-only deposits earn the Aquarius reward share.

On-chain, both sit in pool 0 and earn the same. So the app is describing a
distinction that does not exist, in the direction that **understates what pair
depositors actually receive**.

This is live now, not after the buckets ship. Either the copy softens until pool
3 exists, or the buckets land first.

---

## 4. Gaps to close, in order

| # | Step | Who can do it |
|---|---|---|
| 1 | `add_pool` a second BLUB-AQUA bucket — same pool address `CAMXZXXB…`, same `token_a`/`token_b`, same share token `CDMRHKJC…`. Will return `pool_id` 3. | Manager-auth, **no multisig** |
| 2 | Seed it: one `vault_deposit_single` of AQUA into pool 3 from a protocol account, so `total_shares > 0`. Without this, step 3 reverts on the zero-share guard. | Needs a **funded protocol account** |
| 3 | Backend: route Stream B by `pool_id`. Today all of it goes to pool 0. | Code change + deploy |
| 4 | Netlify (`moonlit-douhua-d2c137`): set `REACT_APP_SINGLE_AQUA_POOL_ID=3` and rebuild. Frontend already routes single-asset deposits there and pair deposits to pool 0. | **Netlify access** |

Steps 1 and 3 are mine to run. Steps 2 and 4 are not.

---

## 5. Open decisions — needed before announcing

### 5.1 Stream B split — DECIDED: 100/0

**Confirmed 16 Sep: Stream B goes entirely to the AQUA-only bucket. Pair
depositors earn swap fees only.** Backend default `BRIBE_VAULT_SINGLE_AQUA_BPS`
is now 10000; docs and app copy match.

This is only safe to switch on because `migrate_vault_position` exists (§5.2).
Without it, every existing AQUA-only depositor in pool 0 would have dropped to
zero Stream B the moment pool 3 was seeded, through no action of their own.

**Interlock:** while `VAULT_POOL_SINGLE_AQUA_ID` is unset there is no second
bucket, so the entire tranche still goes to pool 0 regardless of the ratio.
Nothing changes for anyone until that bucket exists and is seeded — which means
the 100/0 default can ship ahead of the bucket without effect.

### 5.2 Existing AQUA-only depositors — RESOLVED by contract

`migrate_vault_position(manager, user, from_pool, to_pool)` was added on 16 Sep
(wasm `56d08842`, **not yet uploaded**). It re-credits a position between two
buckets sharing a `share_token`. No tokens move; the contract's LP balance is
untouched and only the credit is rewritten. Shares mint at the destination's
share price, so nobody already in it is diluted, and an empty destination mints
1:1 — meaning the first migration also seeds the bucket.

So neither bad option is needed: no forced redeposit, no permanent two-cohort
grandfathering.

**Required order.** Migrate first, verify, then flip routing. Seeding pool 3 and
enabling 100/0 before migrating would leave existing AQUA-only depositors earning
nothing in the gap.

**Caveat:** the happy path is not unit tested — creating a position needs
`vault_deposit_single`, which reaches the Aquarius pool, and the test harness
uses a bare address. Guards are covered. Run it on testnet against a real pool
before touching mainnet positions, because this rewrites live depositor state.

## 6. Also open, from the v3 deployment

| Item | Effect |
|---|---|
| `BRIBE_TREASURY_ADDRESS` unset on DO | Treasury 10% folds into POL; live routing is 50/30/20 |
| Treasury `GBYQWGLZ…` has no BLUB trustline | 949.63 BLUB from the settlement sweep remains unpaid |
| `BRIBE_POL_BPS` still 2000 on DO (inferred) | Triggers the legacy path in §2; Stream D stays off until it is 1000 |

Setting `BRIBE_POL_BPS=1000`, `BRIBE_TREASURY_BPS=1000` and
`BRIBE_TREASURY_ADDRESS` together switches routing to the documented
50/30/10/10. Until then the backend runs v2 routing deliberately, which is
correct behaviour rather than a silent failure.

---

## 7. What is verified vs assumed

**Verified against chain today:** pool count and per-pool state, distinct share
tokens, reward policy, compound stats and last compound time, reward-state
deltas, manager AQUA balance, and the Horizon operation history showing which
contract functions ran.

**Inferred, not confirmed:** that DO carries `BRIBE_POL_BPS=2000`. I cannot read
DO environment variables. The fix in §2 makes the outage recover either way, but
the inference is worth confirming in the console — and if `BRIBE_POL_BPS` is
something else entirely, the §2 diagnosis needs revisiting.
