# v3 Reward Engine — Deployment Record

**Deployed 14 September 2026.** Stakers are paid in **AQUA** instead of BLUB.

This is the as-built record. The step-by-step procedure lives in
[`DEPLOY_V3.md`](DEPLOY_V3.md); this file records what actually happened,
including the things that went wrong.

---

## 1. What shipped

Version A of the 12 Sep 2026 v3 document.

| | v2 | v3 |
|---|---|---|
| Staker payout | BLUB, bought on the open market | **AQUA**, passed straight through |
| Stakers | 50% | 50% |
| Vault LPs | 30% | 30% |
| POL | 20% | 10% |
| Treasury | — | 10% |
| Protocol BLUB buys | funded from revenue | **removed** |

**Why the payout token changed.** v2 took the AQUA that pooled ICE voting had
just earned, bought BLUB with it, and handed that BLUB to stakers. Every reward
was therefore a buy order into a thin pool, and most recipients sold it straight
back for the AQUA they wanted in the first place. The protocol was spending
revenue to move its own market and paying the round trip on both legs. v3 hands
over the AQUA directly.

**Why it is a parameter, not a constant.** `RewardPolicy` is stored under its own
`DataKey`, so the payout token can be changed by the multisig without an upgrade.
Three consequences followed deliberately:

- the policy **defaults to v2 behaviour**, so the upgrade changed nothing on its
  own and the switch was a separate, signed act;
- the backend reads `get_reward_policy` each run, so an on-chain revert reverts
  the distributor with no redeploy;
- the frontend reads it too and falls back to BLUB, so a pre-v3 contract is never
  mislabelled.

---

## 2. On-chain result

| | |
|---|---|
| Contract | `CC72BEVVKHQ57PB5FCKAZYRXCSR6DOQSTN46QR7RZMMM64YWNRPDS24S` |
| WASM | `77b6b533a7436ee6ff8d15e7a5160d67739ae062b572b2bdb7b6891f992e0a8a` |
| Size | 110,709 B (20,363 under the 131,072 ceiling) |
| Upload tx | `fadc7da48b8407127f8abef498a5bbc263911e38a9877a9e8232bcdb3ad8a2d3` |
| Upload cost | 124.93 XLM (143.67 simulated resource fee) |
| Previous WASM | `8f821edf…` (deployed 11 Sep) |
| Backend | `6758828` |
| Frontend/docs | `19f2679` |

Live policy, read back after the flip:

```json
{
  "payout_token": "Aqua",
  "allow_user_choice": true,
  "staker_bps": 5000, "lp_bps": 3000, "pol_bps": 1000, "treasury_bps": 1000,
  "max_swap_slippage_bps": 100
}
```

### Verification performed

- **Interface diff, live vs new:** 93 → 98 functions, **zero removed or changed**.
  Purely additive (`get_reward_policy`, `get_reward_preference`,
  `set_reward_policy`, `set_reward_preference`, `settle_user_rewards`). This is
  what made it safe to upgrade without pausing the crons.
- **Executable hash** fetched from chain and compared byte-for-byte.
- **State survived:** `total_staked` 57.32M → 57.63M and
  `reward_per_token_stored` 17,509 → 17,567 across the upgrade — both moved up,
  consistent with normal accrual continuing, not with corruption.
- **Pool buckets unchanged:** pool 0 active; pools 1 and 2 still deactivated.
- Every multisig XDR was decoded and checked (contract, function, arguments,
  signature count, expiry) before being sent for co-signing.

---

## 3. Migration sequence as executed

1. **Top up** — manager funded (+150 XLM).
2. **Upload** — `77b6b533`, verified present on-chain as a contract-code entry.
3. **Upgrade** — multisig, 2-of-3. Behaviour unchanged: policy defaulted to `Blub`.
4. **Staker list** — refreshed to **31** addresses (the stale CSV had 22).
5. **Backend deploy** — `ac5a495..6758828`, behaviour-preserving under a `Blub` policy.
6. **Settlement sweep** — manager single-sig.
7. **Policy flip** — multisig. This was the live change.

Steps 1–5 were individually safe and reversible. Only step 7 changed behaviour.

### Why settlement had to happen first

Reward units carry no record of which asset funded them. Flipping the
denomination with balances outstanding would pay stakers an asset they never
earned. `set_reward_policy` refuses a token change unless the outstanding ledger
is zero (error 33, `RewardsUnsettled`), and `settle_user_rewards` — manager-auth,
cooldown-bypassing, idempotent — is what drives it there. The 7-day claim
cooldown means stakers cannot simply be asked to claim.

### Settlement outcome

**29 of 31 stakers settled, ~227,000 BLUB paid out.**

Two could not be settled, both for the same reason — **no BLUB trustline**, so
the SAC transfer cannot land:

| Account | Amount | Note |
|---|---|---|
| `GBYQWGLZ…` (treasury) | 949.6312638 BLUB | Protocol's own account; key not held locally |
| `GC4NVO32…` | 0.0009283 BLUB | A user's account — only they can add the trustline, so this is permanently unsettleable |

`GAYLXOVH…` reports **−1,791,521,649 BLUB** pending. That is the historical
i64::MAX exploit account, where `total_claimed` exceeds accrual. Negative, so
nothing is owed; correctly excluded from the sweep, and its watermark re-synced.

Both outstanding balances will be paid in **AQUA** when those accounts claim.
The treasury one is the protocol paying itself; the other is dust.

---

## 4. Things that went wrong

### The settle script reported success for transactions that never applied

The first run printed "Settled 22" when **10** had actually applied.

`send_transaction` returning a hash means **queued**, not applied. The loop slept
2 seconds between transactions — shorter than Stellar's ~5s ledger close — so
`load_account` kept handing back a stale sequence number, and the duplicates
failed as `tx_bad_seq`. Silently, because nothing checked.

Fixed by polling `get_transaction` until the ledger closes and counting only
`SUCCESS`. The corrected re-run reported 12 settled / 2 failed, which matched
on-chain state exactly.

**Lesson:** never treat a submission hash as confirmation.

### Identity loading assumed one storage format

`multisig-admin.toml` holds a raw `secret_key`; `blub-issuer-v2.toml` holds a
`seed_phrase`. The loader only handled the first and refused to start. Now
handles both, and the derived public key is checked against the expected manager
address before anything is signed.

### The ledger guard did not cover the first switch

`outstanding` only counts from the v3 upgrade forward, so it read zero and the
policy flip passed **with those two pre-v3 balances still open**. The guard
protects *future* switches, not the one that introduced it. Worth knowing before
relying on it for a revert.

### Earlier in the same work: a dead function, nearly shipped

`withdraw_pol_one_coin` (shipped in `8f821edf`) decoded Aquarius
`withdraw_one_coin` as a scalar `u128`. The pool returns `Vec<u128>`. Every call
would have failed on conversion — a permanently dead admin function burned into a
contract near the size ceiling. Caught by reading the pool's on-chain interface
rather than trusting the signature in our own code.

### Earlier: an ownerless-LP hazard, already live

`admin_compound_deposit` raises `total_lp_tokens` without minting shares, while
`vault_withdraw` pays `user_shares × total_lp_tokens / total_shares`. Pools 1 and
2 held LP against **zero shares** — the first depositor into either would have
taken the entire accumulated balance for a dust deposit. Closed by deactivating
both pools (deposits gate on `active`; withdrawals do not, so no funds were
trapped) and by adding a contract guard rejecting compounds into a zero-share
bucket.

---

## 5. Still open

| Item | Impact |
|---|---|
| `BRIBE_TREASURY_ADDRESS` unset on DO | Stream D folds into POL → **live routing is 50/30/20**, not 50/30/10/10. Docs say so explicitly. |
| Treasury has no BLUB trustline | 949.63 BLUB unsettled; needs a trustline added from that account |
| No frontend control for `set_reward_preference` | The policy accepts elections the app cannot yet make; a staker wanting BLUB must call the contract directly |
| Claim-time swap path untested | Needs a live AMM — the test harness uses a bare address, so any call reaching the pool is indistinguishable from a guard rejection |
| `RewardsUnsettled` guard untested | Same reason |
| No forked-state test | The v3 document's ship order calls for one |
| Balanced POL adds unimplemented | Version A specifies them below 55% BLUB; the pool is ~98.7% BLUB so the branch cannot fire, and logs loudly if it ever would |

---

## 6. Rollback

**Policy only — no upgrade needed, and the expected path:**

1. Run `scripts/v3_settle_blub_rewards.py --execute`. It settles in whatever
   token is current, so this clears AQUA balances.
2. Set `PAYOUT_TOKEN = "Blub"` in `scripts/multisig_set_reward_policy.py` and
   re-run it.

The backend follows automatically — it reads the policy each run and resumes
swapping when it sees `Blub`. No redeploy. The frontend does the same.

**Full contract rollback** is only for a contract-level bug, not for reverting
the reward token: put the previous hash into `multisig_upgrade.py` and re-run it.

---

## 7. Key addresses

| Role | Address |
|---|---|
| Staking contract | `CC72BEVVKHQ57PB5FCKAZYRXCSR6DOQSTN46QR7RZMMM64YWNRPDS24S` |
| Manager (single-sig) | `GDERSSCKJQPPXUQOZIOXGRVAGNLVPVZCJ2MAX7RCMVMWGRPVAEG7XGTK` |
| Admin (2-of-3 multisig) | `GALE4XON37AQ4KFTJKB3W32BUQGXFE46TQLKUIGBSIHSOEHTDBMKEI3M` |
| Treasury | `GBYQWGLZ4X5ZRS7VXVSKSDM72MQ4KFF4EW3PFH6UPUP5INGHMJS7C2R3` |
| Pool 0 (BLUB-AQUA) | `CAMXZXXBD7DFBLYLHUW24U4MY37X7SU5XXT5ZVVUBXRXWLAIM7INI7G2` |

Pool 0 token order from `get_tokens()` is **[AQUA, BLUB]** — sorted by contract
address, *not* `PoolInfo`'s `(token_a, token_b)`, which is (BLUB, AQUA). Reading
it the wrong way round inverts swap direction and the POL threshold branch.

---

## 8. Scripts

| Script | Auth | Purpose |
|---|---|---|
| `multisig_upgrade.py` | 2-of-3 | Upgrade the contract to a given WASM hash |
| `v3_settle_blub_rewards.py` | manager | Clear accrued balances; dry run by default, `--execute` to send |
| `multisig_set_reward_policy.py` | 2-of-3 | Set payout token and split; also the revert path |
| `list_all_stakers.py` | none | Enumerate stakers → `all_stakers.csv` |
| `multisig_deactivate_pools.py` | 2-of-3 | `update_pool_status(pool_id, false)` |

Two conventions these encode, both learned the hard way:

- **One Soroban host-function op per transaction.** Deactivating two pools is two
  transactions with consecutive sequence numbers, submitted in order.
- **`set_timeout(3600)`, not 300.** A five-minute window expires before a
  co-founder can realistically countersign. `multisig_update_vault_fee.py` still
  has the old 300 — do not copy it as a template.
