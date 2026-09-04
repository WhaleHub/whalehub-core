# WhaleHub — repo guide for Claude

Yield-optimization protocol on Stellar ("Convex for Stellar"): stake AQUA → mint BLUB → aggregate ICE voting on Aquarius → auto-compound rewards. This repo (`whalehub-core` / `jewel-swap`) holds the CRA dApp (`src/`, deploys to **app.whalehub.io**), the Soroban contracts (`soroban-contracts/`), a static marketing site (`website-redesign/`), and GitBook docs (`docs/`).

## Build & test — staking contract
```
cd soroban-contracts/staking-contract
cargo build --release --target wasm32-unknown-unknown --package whalehub-staking
cargo test --package whalehub-staking          # 11 tests in staking/src/test.rs
stellar contract optimize --wasm target/wasm32-unknown-unknown/release/whalehub_staking.wasm
```

## ⚠️ CRITICAL: the staking contract is AT the 128 KiB WASM size ceiling
- Mainnet `maxContractSizeBytes = 131072`. The contract builds to ~130 KB — **almost no headroom**.
- If `stellar contract upload` fails with `TxFailed(...Success(Hash(0000...)))` (fee-independent), the WASM is **over the size limit**, not a fee problem.
- **To free space:** strip doc comments — `perl -i -pe 's{^(\s*)///(?!/)}{$1//}' staking/src/lib.rs` frees ~28 KB (they're embedded in the `contractspecv0` section). `[profile.release]` is already size-maxed.
- **stellar CLI must be ≥ v27** for Protocol 26 uploads (v23 mis-builds → same `TxFailed(Hash(0))`). v27: use `--inclusion-fee` (not `--fee`), `upload` (not `install`).

## Deploy (staking upgrade) — user signs, never Claude
1. `stellar contract upload --wasm <optimized> --source blub-issuer-v2 --rpc-url https://soroban-rpc.mainnet.stellar.gateway.fm --network-passphrase "Public Global Stellar Network ; September 2015" --inclusion-fee 10000000` → returns the wasm hash.
2. Put that hash in `scripts/multisig_upgrade.py` (`NEW_WASM_HASH`), run it → master signs, co-founder co-signs (2-of-3) at lab.stellar.org, submit.
3. Verify: read the contract instance's executable wasm hash on-chain.

## Key addresses
- Staking contract `CC72BEVVKHQ57PB5FCKAZYRXCSR6DOQSTN46QR7RZMMM64YWNRPDS24S`
- Manager (blub-issuer-v2, single-sig backend) `GDERSSCKJQPPXUQOZIOXGRVAGNLVPVZCJ2MAX7RCMVMWGRPVAEG7XGTK`
- Admin (multisig 2-of-3) `GALE4XON37AQ4KFTJKB3W32BUQGXFE46TQLKUIGBSIHSOEHTDBMKEI3M`
- Pool 0 (BLUB-AQUA, StableSwap, **de-whitelisted → 0% APY**) `CAMXZXXBD7DFBLYLHUW24U4MY37X7SU5XXT5ZVVUBXRXWLAIM7INI7G2`

## Invariants & gotchas
- **Vault solvency:** `vault_withdraw` burns real pool-0 LP; contract's pool-0 LP balance MUST stay ≥ `pool_info[0].total_lp_tokens` or redemptions revert. `withdraw_from_pool` now has a POL-surplus guard enforcing this (deployed 2026-07-04).
- **POL:** `manual_deposit_pol(manager, aqua, blub)` deposits the contract's own tokens (manager single-sig). `sync_pol_position(manager, value)` corrects the `aqua_blub_lp_position` telemetry counter. Off-ratio deposits into pool 0 leak value to arbitrage — deposit near the pool ratio.
- **BLUB is FLOATING**, never "pegged"/"redeemable" in any external/public copy.
- **BLUB issuer `home_domain` MUST stay `whalehub.io`** (set 2026-07-13, tx `d5082fc33b61`). Wallets/explorers verify BLUB via `home_domain` → `https://whalehub.io/.well-known/stellar.toml` (has the BLUB `[[CURRENCIES]]` entry + icon, served text/plain + CORS `*`). **Do NOT set it to lobstr.co or anything else.** ✅ **ROOT CAUSE SOLVED 2026-09-04: it is the LOBSTR wallet app, not a script.** The 09-03 revert tx `0f1f14fd41ee` had TWO ops — `create_account` (funding the mm-bot wallet) **plus a silently appended `set_options home_domain=lobstr.co`**. LOBSTR adds that op to transactions it signs from this account, which is why no cron or backend was ever found. **Never sign transactions from `blub-issuer-v2` in the LOBSTR app** — use the CLI/keystore, Freighter or Stellar Lab; if LOBSTR is unavoidable, re-check `home_domain` on Horizon straight after. (History: 06-11 → app.whalehub.io; 07-11 → lobstr.co; 07-13 → whalehub.io; 09-03 → lobstr.co; 09-04 → whalehub.io, tx `c3f0990f61b4`.) A stale "lobstr.co" in a wallet UI can also be cache lag — confirm via Horizon `home_domain` before re-fixing, and list ALL ops in the offending tx rather than assuming one. toml lives in `website-redesign/.well-known/stellar.toml`; re-point via `stellar tx new set-options --source-account blub-issuer-v2 --home-domain whalehub.io ...`.
- **whalehub.io does NOT deploy from this repo** — it's a separate `whalehub-website` Netlify source. The blog in `website-redesign/blog/` is committed but NOT live.

## Working style (from the user)
- ASK before production changes; trace the whole execution path; query the chain for on-chain data (don't ask the user for numbers). Past failures came from deploying with false confidence.
- Claude prepares/verifies transactions and copies commands to the clipboard; **the user signs and broadcasts** all on-chain transactions.
