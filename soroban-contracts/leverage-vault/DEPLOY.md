# Leverage Vault — Testnet Deploy Runbook

Deploys the leveraged-LP-farming stack on **Stellar testnet** (Blend mainnet pool
creation needs a backstop deposit, hence testnet first). See
`../../docs/technical/leveraged-lp-farming.md` for the design.

## Prerequisites

- `stellar` CLI, `cargo` + `wasm32-unknown-unknown` target.
- A funded testnet identity (e.g. `stellar keys generate leverage-test --network testnet`
  then friendbot-fund it).
- Network flags used throughout:
  `--rpc-url https://soroban-testnet.stellar.org --network-passphrase "Test SDF Network ; September 2015"`

## 0. OPEN ITEM — choose the testnet AMM

Aquarius LP pools + share tokens are **mainnet-only**. On testnet you must point the
vault at a testnet AMM that mints an LP share token to use as collateral. Options:

- Deploy an Aquarius-style pool on testnet (keeps the `deposit/swap/withdraw` interface
  the vault already targets — **verify the pool-level `swap(user,in_idx,out_idx,in_amount,out_min)`
  signature** against the build you deploy), or
- Use a Soroswap testnet pair (different interface — the `AmmPoolTrait` client in
  `src/lib.rs` would need its `deposit/swap` signatures adjusted to match).

Record: `AMM_POOL`, `LP_TOKEN` (share token), `BORROW_ASSET` (XLM/USDC SAC),
`PAIR_TOKEN` (other side, e.g. AQUA), and the token indices `BORROW_IDX`/`PAIR_IDX`.

## 1. Deploy the Blend pool (blend-utils)

```sh
git clone https://github.com/blend-capital/blend-utils && cd blend-utils
npm install
# configure testnet env + run the pool deploy script
node ./scripts/deploy-pool.js testnet
```

Then queue + activate reserves (testnet lets you skip/shorten the 7-day delay you
control as pool admin):

- `LP_TOKEN`  → reserve with non-zero **c_factor** (collateral), l_factor 0/low.
- `BORROW_ASSET` (XLM/USDC) → borrowable reserve (l_factor set).
- Set a (mock) oracle price for `LP_TOKEN` and `BORROW_ASSET` so health checks resolve.

Record `BLEND_POOL`.

## 2. Build + deploy the leverage vault

```sh
cd soroban-contracts/leverage-vault
cargo build --release --target wasm32-unknown-unknown --package whalehub-leverage-vault
stellar contract optimize \
  --wasm target/wasm32-unknown-unknown/release/whalehub_leverage_vault.wasm
VAULT=$(stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/whalehub_leverage_vault.optimized.wasm \
  --source leverage-test --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015")
echo "VAULT=$VAULT"
```

## 3. Initialize

```sh
stellar contract invoke --id $VAULT --source leverage-test \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" -- \
  initialize \
  --admin <ADMIN_G...> \
  --blend_pool $BLEND_POOL \
  --amm_pool $AMM_POOL \
  --lp_token $LP_TOKEN \
  --borrow_asset $BORROW_ASSET \
  --pair_token $PAIR_TOKEN \
  --borrow_idx <0|1> \
  --pair_idx <0|1> \
  --max_leverage_bps 30000
```

## 4. Smoke test the flash-loan leverage

1. Acquire some `LP_TOKEN` on testnet (deposit into `AMM_POOL`).
2. `open_position(user, collateral_lp_amount, borrow_amount, min_lp_out, min_pair_out)`
   — `min_lp_out` / `min_pair_out` come from simulating the zap against current reserves.
3. `get_position(user)` and `get_blend_positions()` to confirm collateral + debt.
4. `repay_and_withdraw(user, repay_amount, withdraw_lp_amount, 0)` to unwind.

## 5. Wire the frontend

Set in `.env` (testnet):

```
REACT_APP_LEVERAGE_VAULT_CONTRACT_ID=<VAULT>
REACT_APP_BLEND_POOL_ID=<BLEND_POOL>
REACT_APP_LEVERAGE_AMM_POOL_ID=<AMM_POOL>
REACT_APP_LEVERAGE_LP_TOKEN=<LP_TOKEN>
REACT_APP_LEVERAGE_BORROW_ASSET=<BORROW_ASSET>
REACT_APP_LEVERAGE_PAIR_TOKEN=<PAIR_TOKEN>
```

## Follow-ups (not in v1)

- Flash-loan-based self-liquidating `close_position` (v1 unwind requires the user to
  supply repay funds via `repay_and_withdraw`).
- Per-user health isolation / liquidation accounting inside the vault (v1 shares one
  Blend position; Blend enforces aggregate health).
- Keeper to monitor health factor and auto-deleverage.
