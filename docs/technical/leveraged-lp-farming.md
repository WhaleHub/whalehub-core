# Leveraged LP Farming (Blend) — Design

**Status:** In development (testnet). Mainnet deferred — Blend mainnet pool creation requires a backstop deposit.
**Date:** 2026-06-27

## Goal

Let a user multiply ("leverage") an Aquarius LP yield-farming position by using the LP
share token as collateral on a [Blend](https://docs.blend.capital) lending pool,
borrowing a stable/blue-chip asset against it, and recycling the borrowed asset back
into more LP — all atomically via a **Blend V2 flash loan**.

Target product (v1): **LP collateral → borrow XLM/USDC → zap into more LP**.

```
        ┌────────────── one signed transaction ──────────────┐
        │                                                     │
  user collateral ──► flash-borrow XLM/USDC ──► zap to LP ──► supply LP as
        │                  (Blend)              (AMM)         collateral (Blend)
        │                                                     │
        └────────► resulting position: N× LP, debt = borrowed XLM/USDC ◄──┘
```

## Why flash loans

Without flash loans you'd loop `supply → borrow → zap → supply` many times, each pass
adding less leverage, costing more gas, and exposing the user to liquidation *between*
passes. Blend V2 exposes `flash_loan`, letting us reach the target leverage in one tx
with no intermediate unhealthy state — the health check runs once, at the end.

## Blend V2 interface (verified against blend-contracts-v2 `main`)

```rust
// pool/src/contract.rs
fn flash_loan(e: Env, from: Address, flash_loan: FlashLoan, requests: Vec<Request>) -> Positions;
fn submit(e: Env, from: Address, spender: Address, to: Address, requests: Vec<Request>) -> Positions;

// pool/src/pool/actions.rs
struct FlashLoan { contract: Address, asset: Address, amount: i128 }
struct Request   { request_type: u32, address: Address, amount: i128 }

enum RequestType {          // u32 discriminants
    Supply = 0, Withdraw = 1,
    SupplyCollateral = 2, WithdrawCollateral = 3,
    Borrow = 4, Repay = 5,
    FillUserLiquidationAuction = 6, FillBadDebtAuction = 7,
    FillInterestAuction = 8, DeleteLiquidationAuction = 9,
}
```

### `flash_loan` execution order (from `pool/src/pool/submit.rs`)

1. Pool **adds the borrowed amount as a liability** to `from` (it is a real borrow).
2. Pool `transfer`s `flash_loan.amount` of `flash_loan.asset` to `flash_loan.contract`.
3. Pool calls the receiver: `FlashLoanClient::exec_op(&from, &asset, &amount, &0)`.
4. Pool processes `requests` for `from` using **transfer_from / allowance**
   (`handle_transfer_with_allowance`).
5. Pool runs the **health-factor check once** — must end solvent.

The key consequence of step 4: the post-loan `SupplyCollateral` pulls tokens via
`transfer_from`, i.e. it needs an **allowance** to the pool. This drives the ownership
model below.

## Ownership model: vault-owns-position

The leverage vault contract is **both** the flash-loan receiver **and** the Blend
position owner (`from` = vault). This:

- Avoids the per-user allowance/auth dance (vault authorizes its own token transfers
  via `e.authorize_as_current_contract(...)`).
- Matches the team's existing pattern (the staking contract holds LP and tracks per-user
  shares — see `soroban-contracts/staking-contract`).

Trade-off: one Blend position address ⇒ the vault is a **CDP manager** that tracks each
user's collateral and debt internally and enforces per-user health. v1 starts with a
conservative single global health check and a per-user share ledger; richer per-user
liquidation is a follow-up.

### `exec_op` (the zap), running as the vault during the flash loan

Inputs: borrowed `asset` (XLM or USDC) sitting in the vault, `amount`.

```
exec_op(from, asset, amount, _fee):
  require caller == blend_pool                 # only the pool may invoke
  half = amount / 2
  swap half of `asset` -> AMM other-side token (e.g. AQUA)   # AMM.swap
  add_liquidity([asset_remainder, other_token]) -> lp_minted  # AMM.deposit
  approve(blend_pool, lp_token, lp_minted)     # so step 4 SupplyCollateral can pull it
  # control returns to pool; requests = [SupplyCollateral(lp_token, lp_minted)]
```

### `open_position` (vault entrypoint)

```
open_position(user, collateral_lp_amount, leverage_bps):
  user.require_auth()
  pull `collateral_lp_amount` LP from user into vault
  borrow_amount = price/ratio math from leverage_bps and collateral value
  authorize_as_current_contract([ pool token transfers + lp approve ])
  pool.flash_loan(
     from = vault,
     FlashLoan { contract: vault, asset: borrow_asset, amount: borrow_amount },
     requests = [ SupplyCollateral(lp_token, expected_lp_from_zap + initial),
                  SupplyCollateral(lp_token, initial_collateral) ]
  )
  record user share of vault collateral & debt
```

### `close_position` (unwind)

Reverse: flash-borrow to repay debt, `WithdrawCollateral` LP, `withdraw` LP → assets,
`swap` back to the borrowed asset, `Repay`, return remaining LP/assets to user.

## AMM abstraction (testnet caveat)

Aquarius LP pools and their share tokens exist on **mainnet only**. On testnet we must
target a testnet AMM to mint the LP collateral. The vault therefore talks to the AMM
through a small isolated client trait so the concrete AMM is swappable:

```rust
// reused/verified from staking contract (pool-level Aquarius interface):
fn deposit(env, user, desired_amounts: Vec<u128>, min_shares: u128) -> (Vec<u128>, u128);  // ✅ verified
fn withdraw(env, user, share_amount: u128, min_amounts: Vec<u128>) -> Vec<u128>;            // ✅ verified
fn get_reserves(env) -> Vec<u128>;                                                          // ✅ verified
fn swap(env, user, in_idx: u32, out_idx: u32, in_amount: u128, out_min: u128) -> u128;      // ⚠️ TO VERIFY against the chosen testnet pool
```

**Open item:** pick the testnet AMM — deploy an Aquarius-style pool on testnet, or use a
Soroswap testnet pair. Decision pins the `swap` signature and the LP share-token address.

## Deploy plan (testnet)

1. Choose/deploy testnet AMM pair (LP share token = collateral asset). *(open item)*
2. Deploy a Blend pool via [`blend-utils`](https://github.com/blend-capital/blend-utils)
   `deploy-pool` on testnet.
3. `queue_set_reserve` + activate:
   - LP share token: non-zero `c_factor` (collateral), `l_factor` 0 or low (not borrowed).
   - XLM and/or USDC: borrowable reserve (`l_factor` set, `c_factor` optional).
   - Note Blend's 7-day reserve activation delay — on testnet we control timing.
4. Deploy the leverage-vault contract; configure pool id, LP token, borrow asset, AMM.
5. Frontend + read service for pool/positions/health.

## Risk / health

- Liquidation: if LP value falls vs debt, Blend liquidates collateral. UI must surface a
  live health factor and a max-safe leverage.
- AMM slippage on the zap swap — enforce `out_min` / `min_shares`.
- Borrow-rate spikes — leveraged debt accrues interest; net APY can go negative.

## Contracts / SDK

- Build the vault against `blend-contract-sdk` (`pool::Client`) for typed `flash_loan`
  calls, or hand-roll the client (mirrors the existing `aquarius_pool` `#[contractclient]`
  pattern in `staking/src/lib.rs`).
- soroban-sdk pinned at workspace 21.7.0 (match existing crate).
