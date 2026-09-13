# v3 Reward Engine — Deployment Runbook

**Version A.** Stakers are paid in **AQUA** instead of BLUB. Revenue splits
**50 stakers / 30 vault LPs / 10 POL / 10 treasury**. Protocol BLUB buying is removed.

| | |
|---|---|
| WASM hash | `77b6b533a7436ee6ff8d15e7a5160d67739ae062b572b2bdb7b6891f992e0a8a` |
| Size | 110,709 B (20,363 under the 131,072 ceiling) |
| Tests | 25 passing |
| Contract | `CC72BEVVKHQ57PB5FCKAZYRXCSR6DOQSTN46QR7RZMMM64YWNRPDS24S` |
| Currently live | `8f821edf…` |
| Manager (single-sig) | `GDERSSCKJQPPXUQOZIOXGRVAGNLVPVZCJ2MAX7RCMVMWGRPVAEG7XGTK` |
| Admin (2-of-3) | `GALE4XON37AQ4KFTJKB3W32BUQGXFE46TQLKUIGBSIHSOEHTDBMKEI3M` |

---

## ⚠️ Read this before anything else

**The upgrade itself changes NO behaviour.** The reward policy defaults to v2
(pay BLUB, v2 split), so steps 1–2 are safe to run at any time with the crons
running. `add_rewards`, `manual_deposit_pol` and `admin_compound_deposit` all
keep the signatures the current backend already uses. **No cron pause needed.**

**The one hard ordering rule:** the backend MUST be deployed (step 4) *before*
the policy flip (step 6). `add_rewards` pulls whatever token the policy names.
If the policy says AQUA while the old backend is still running, it will swap
AQUA→BLUB and then call `add_rewards` with a BLUB-sized number — causing the
contract to pull that many **AQUA**. Wrong asset, wrong amount.

**Step 6 is the only irreversible-feeling step, and it is reversible** — re-run
step 6 with `PAYOUT_TOKEN = "Blub"` after its own settlement sweep.

---

## Step 0 — Top up the manager wallet

The upload needs **144.67 XLM** (143.67 resource + 1.0 inclusion). The manager
has ~105 XLM available (304 balance minus 199 locked as reserve by 392 sponsored
claimable balances).

> **Send ≥ 50 XLM to** `GDERSSCKJQPPXUQOZIOXGRVAGNLVPVZCJ2MAX7RCMVMWGRPVAEG7XGTK`

Verify:

```bash
curl -s "https://horizon.stellar.org/accounts/GDERSSCKJQPPXUQOZIOXGRVAGNLVPVZCJ2MAX7RCMVMWGRPVAEG7XGTK" | python3 -c "
import sys,json; d=json.load(sys.stdin)
n=float([b for b in d['balances'] if b['asset_type']=='native'][0]['balance'])
avail=n-(2+d['subentry_count']+d.get('num_sponsoring',0))*0.5
print(f'available {avail:,.2f} XLM ->', 'OK' if avail>=150 else 'STILL SHORT')"
```

If this ever fails with `TxInsufficientBalance`, that is **funding, not the
128 KiB size limit** — check *available*, not total.

---

## Step 1 — Build and upload the WASM  *(manager, single-sig)*

```bash
cd /Users/viktorvostrikov/Desktop/whalehub/jewel-swap/soroban-contracts/staking-contract && \
cargo build --release --target wasm32-unknown-unknown --package whalehub-staking && \
cargo test --package whalehub-staking && \
stellar contract optimize --wasm target/wasm32-unknown-unknown/release/whalehub_staking.wasm && \
shasum -a 256 target/wasm32-unknown-unknown/release/whalehub_staking.optimized.wasm
```

Confirm the hash is `77b6b533a7436ee6ff8d15e7a5160d67739ae062b572b2bdb7b6891f992e0a8a`, then:

```bash
stellar contract upload \
  --wasm /Users/viktorvostrikov/Desktop/whalehub/jewel-swap/soroban-contracts/staking-contract/target/wasm32-unknown-unknown/release/whalehub_staking.optimized.wasm \
  --source blub-issuer-v2 \
  --rpc-url https://soroban-rpc.mainnet.stellar.gateway.fm \
  --network-passphrase "Public Global Stellar Network ; September 2015" \
  --inclusion-fee 10000000
```

It prints the hash on success. Verify it is on-chain:

```bash
python3 -c "
from stellar_sdk import SorobanServer, xdr as x
s=SorobanServer('https://soroban-rpc.mainnet.stellar.gateway.fm')
h=bytes.fromhex('77b6b533a7436ee6ff8d15e7a5160d67739ae062b572b2bdb7b6891f992e0a8a')
k=x.LedgerKey(x.LedgerEntryType.CONTRACT_CODE, contract_code=x.LedgerKeyContractCode(hash=x.Hash(h)))
print('code entries on-chain:', len(s.get_ledger_entries([k]).entries or []), '(1 = uploaded)')"
```

---

## Step 2 — Upgrade the contract  *(MULTISIG — co-founder signature needed)*

`scripts/multisig_upgrade.py` already carries the v3 hash.

```bash
cd /Users/viktorvostrikov/Desktop/whalehub/jewel-swap && python3 scripts/multisig_upgrade.py
```

XDR lands on the clipboard, 1-hour signing window. Co-founder signs at
lab.stellar.org and submits. Verify:

```bash
cd /tmp && rm -f live.wasm && stellar contract fetch \
  --id CC72BEVVKHQ57PB5FCKAZYRXCSR6DOQSTN46QR7RZMMM64YWNRPDS24S \
  --rpc-url https://soroban-rpc.mainnet.stellar.gateway.fm \
  --network-passphrase "Public Global Stellar Network ; September 2015" \
  --out-file live.wasm && shasum -a 256 live.wasm
```

Behaviour is still v2 at this point. Confirm the policy defaulted correctly:

```bash
stellar contract invoke --id CC72BEVVKHQ57PB5FCKAZYRXCSR6DOQSTN46QR7RZMMM64YWNRPDS24S \
  --source blub-issuer-v2 --rpc-url https://soroban-rpc.mainnet.stellar.gateway.fm \
  --network-passphrase "Public Global Stellar Network ; September 2015" \
  --send=no -- get_reward_policy
```

Expect `payout_token: Blub`, `allow_user_choice: false`.

---

## Step 3 — Refresh the staker list  *(read-only)*

A staker missing from this file is a staker whose balance never gets cleared,
which blocks step 6.

```bash
cd /Users/viktorvostrikov/Desktop/whalehub/jewel-swap && python3 scripts/list_all_stakers.py
```

---

## Step 4 — Deploy the backend  *(must precede step 6)*

```bash
cd /Users/viktorvostrikov/Desktop/whalehub/whalehub-server && git push origin main
```

Auto-deploys on Digital Ocean. Set these env vars **before** step 6:

| Var | Value | Why |
|---|---|---|
| `BRIBE_TREASURY_ADDRESS` | *(treasury account)* | Without it the 10% treasury share silently folds into POL |
| `BRIBE_POL_BPS` | `1000` | Defaults are already 50/30/10/10; set explicitly if overridden |
| `BRIBE_TREASURY_BPS` | `1000` | |
| `POL_AQUA_ONLY_BLUB_BPS` | `5500` | Version A: AQUA-only above 55% BLUB (pool is ~98.7% BLUB today) |

Health check:

```bash
curl -s https://whalehub-server-28ipy.ondigitalocean.app/test/health
```

---

## Step 5 — Settle every BLUB balance  *(manager, single-sig — no multisig)*

Dry run first. This reports each staker's accrued BLUB and the total:

```bash
cd /Users/viktorvostrikov/Desktop/whalehub/jewel-swap && python3 scripts/v3_settle_blub_rewards.py
```

Check the contract holds at least that much BLUB, then execute:

```bash
cd /Users/viktorvostrikov/Desktop/whalehub/jewel-swap && python3 scripts/v3_settle_blub_rewards.py --execute
```

Re-run the dry form afterwards; every balance must read zero. The script is
idempotent and bypasses the 7-day claim cooldown, which is the whole reason it
exists — stakers cannot be made to claim on demand.

---

## Step 6 — Flip the policy to AQUA  *(MULTISIG — this is the switch)*

```bash
cd /Users/viktorvostrikov/Desktop/whalehub/jewel-swap && python3 scripts/multisig_set_reward_policy.py
```

Sets `payout_token = Aqua`, `allow_user_choice = true`, split 5000/3000/1000/1000,
swap slippage cap 100 bps.

If it fails simulation with **error 33 (`RewardsUnsettled`)**, step 5 did not
finish — some staker still holds an accrued balance. The contract refuses the
token change rather than paying people an asset they did not earn.

Verify:

```bash
stellar contract invoke --id CC72BEVVKHQ57PB5FCKAZYRXCSR6DOQSTN46QR7RZMMM64YWNRPDS24S \
  --source blub-issuer-v2 --rpc-url https://soroban-rpc.mainnet.stellar.gateway.fm \
  --network-passphrase "Public Global Stellar Network ; September 2015" \
  --send=no -- get_reward_policy
```

---

## Step 7 — Confirm end to end

```bash
# Manager AQUA should be ~0 between runs; a lingering balance means a
# distribution claimed but failed to deposit.
curl -s "https://horizon.stellar.org/accounts/GDERSSCKJQPPXUQOZIOXGRVAGNLVPVZCJ2MAX7RCMVMWGRPVAEG7XGTK" | python3 -c "
import sys,json; d=json.load(sys.stdin)
for b in d['balances']:
    if b.get('asset_code','XLM') in ('AQUA','XLM'): print(f\"{b.get('asset_code','XLM'):5} {float(b['balance']):>16,.4f}\")"
```

The next `bribe-reward-distribution` run is the real test — it runs
`0 */6 * * *` (00:00, 06:00, 12:00, 18:00 UTC). Watch for
`Stream A done: … AQUA to stakers` with **no swap line** before it.

The frontend follows the contract automatically: it reads `get_reward_policy`
and relabels pending rewards from BLUB to AQUA with no redeploy.

---

## Rollback

**Policy only** (no upgrade needed) — the expected path:

1. Run step 5 again. It settles in whatever token is current, so this clears AQUA balances.
2. Edit `PAYOUT_TOKEN = "Blub"` in `scripts/multisig_set_reward_policy.py`, re-run step 6.

The backend follows automatically — it reads the policy each run and resumes
swapping when it sees `Blub`. No redeploy.

**Full contract rollback:** put `0551954a…`'s predecessor hash into
`multisig_upgrade.py` and re-run step 2. Only needed for a contract-level bug,
not for reverting the reward token.

---

## Known gaps

- **The claim-time swap path has no unit test.** `liquidity_contract` is a bare
  address in the test harness, so anything reaching the pool collapses into an
  error indistinguishable from a guard rejection. Same for the `RewardsUnsettled`
  guard. Validate on testnet against a real Aquarius pool before step 6 if you
  want that covered.
- **No forked-state test.** The v3 document's ship order calls for one; it has
  not been run.
- **No frontend control for `set_reward_preference`.** The read path exists and
  labels follow the policy, but stakers cannot elect BLUB from the app yet. Inert
  until `allow_user_choice` is on, which step 6 enables — so the contract will
  accept elections that the UI cannot yet make.
- **Balanced POL adds are not implemented.** Version A specifies balanced adds
  below 55% BLUB. The pool is ~98.7% BLUB, so the branch never fires; it logs a
  warning if it ever would.
