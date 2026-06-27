#![no_std]
//! WhaleHub Leveraged LP Farming Vault.
//!
//! Multiplies an Aquarius-style LP yield-farming position by using the LP share
//! token as collateral on a Blend V2 lending pool and recycling a flash-borrowed
//! asset (XLM/USDC) back into more LP — atomically, in one transaction.
//!
//! Design: the vault is BOTH the Blend position owner (`from`) AND the flash-loan
//! receiver (`exec_op`). This avoids per-user Soroban allowance/auth gymnastics and
//! matches the team's existing "contract holds LP, tracks per-user shares" pattern.
//! See docs/technical/leveraged-lp-farming.md for the full design.

use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, token, vec, Address, Env,
    Map, Vec,
};

// ============================================================================
// Blend V2 pool interface (verified against blend-contracts-v2 `main`)
// ============================================================================

/// A request a user makes against the Blend pool. Mirrors `pool::actions::Request`.
#[contracttype]
#[derive(Clone)]
pub struct Request {
    pub request_type: u32,
    pub address: Address,
    pub amount: i128,
}

/// Flash loan arguments. Mirrors `pool::actions::FlashLoan`.
#[contracttype]
#[derive(Clone)]
pub struct FlashLoan {
    pub contract: Address,
    pub asset: Address,
    pub amount: i128,
}

/// A user's Blend position. Mirrors `pool::user::Positions`.
#[contracttype]
#[derive(Clone)]
pub struct Positions {
    pub liabilities: Map<u32, i128>,
    pub collateral: Map<u32, i128>,
    pub supply: Map<u32, i128>,
}

/// Blend `RequestType` discriminants (u32) used in `Request.request_type`.
const RT_SUPPLY_COLLATERAL: u32 = 2;
const RT_WITHDRAW_COLLATERAL: u32 = 3;
const RT_REPAY: u32 = 5;

#[contractclient(name = "BlendPoolClient")]
pub trait BlendPoolTrait {
    /// Flash-borrow `flash_loan.amount` of `flash_loan.asset`, invoke the receiver's
    /// `exec_op`, then process `requests` for `from` (via transfer_from/allowance).
    fn flash_loan(
        env: Env,
        from: Address,
        flash_loan: FlashLoan,
        requests: Vec<Request>,
    ) -> Positions;

    /// Process `requests` for `from`; `spender` sends tokens, `to` receives them.
    fn submit(
        env: Env,
        from: Address,
        spender: Address,
        to: Address,
        requests: Vec<Request>,
    ) -> Positions;

    /// Read `from`'s current positions.
    fn get_positions(env: Env, from: Address) -> Positions;
}

// ============================================================================
// AMM (Aquarius-style pool) interface
// ============================================================================
//
// `deposit`, `withdraw`, `get_reserves`, `get_total_shares` are verified against the
// pool-level interface already used by the staking contract. `swap` is the pool-level
// signature and MUST be re-verified against the concrete testnet AMM chosen at deploy
// time (Aquarius LP pools are mainnet-only). See the design doc's "AMM caveat".

#[contractclient(name = "AmmPoolClient")]
pub trait AmmPoolTrait {
    /// desired_amounts ordered by the pool's token index. Returns (amounts_used, shares).
    fn deposit(
        env: Env,
        user: Address,
        desired_amounts: Vec<u128>,
        min_shares: u128,
    ) -> (Vec<u128>, u128);

    /// Burn `share_amount` LP, receive underlying. Returns amounts withdrawn.
    fn withdraw(
        env: Env,
        user: Address,
        share_amount: u128,
        min_amounts: Vec<u128>,
    ) -> Vec<u128>;

    /// Swap `in_amount` of token at `in_idx` for token at `out_idx`. Returns out amount.
    fn swap(
        env: Env,
        user: Address,
        in_idx: u32,
        out_idx: u32,
        in_amount: u128,
        out_min: u128,
    ) -> u128;

    fn get_reserves(env: Env) -> Vec<u128>;
}

// ============================================================================
// Storage & types
// ============================================================================

#[contracttype]
#[derive(Clone)]
pub struct Config {
    /// Admin (config/upgrades, dust sweep).
    pub admin: Address,
    /// Blend V2 pool that holds the leveraged position.
    pub blend_pool: Address,
    /// Aquarius-style AMM pool that mints the LP collateral.
    pub amm_pool: Address,
    /// LP share token (collateral asset, == amm_pool's share token).
    pub lp_token: Address,
    /// Asset borrowed against the LP (XLM or USDC SAC).
    pub borrow_asset: Address,
    /// The other side of the LP pair, that we swap half the borrow into (e.g. AQUA).
    pub pair_token: Address,
    /// Index of `borrow_asset` within the AMM pool's token list (0 or 1).
    pub borrow_idx: u32,
    /// Index of `pair_token` within the AMM pool's token list (0 or 1).
    pub pair_idx: u32,
    /// Max leverage allowed, in basis points (e.g. 30000 = 3.0x). Advisory cap.
    pub max_leverage_bps: u32,
}

/// Per-user leveraged position accounting (vault-internal CDP shares).
#[contracttype]
#[derive(Clone)]
pub struct UserPosition {
    /// LP share tokens supplied as collateral on behalf of this user.
    pub collateral_lp: i128,
    /// borrow_asset debt principal attributed to this user.
    pub debt: i128,
}

/// Transient state passed from `open_position` into the `exec_op` callback.
#[contracttype]
#[derive(Clone)]
pub struct FlashState {
    pub borrow_asset: Address,
    pub borrow_amount: i128,
    /// Minimum LP the zap must mint (== the SupplyCollateral leveraged amount claimed).
    pub claim_lp: i128,
    /// Total LP the pool will pull (initial user collateral + claim_lp). Approve target.
    pub total_supply_lp: i128,
    /// Slippage floor for the half-swap into pair_token.
    pub min_pair_out: i128,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Config,
    Position(Address),
    Flash,
    TotalCollateralLp,
    TotalDebt,
}

#[contracterror]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidAmount = 3,
    LeverageTooHigh = 4,
    NoActiveFlashLoan = 5,
    FlashAssetMismatch = 6,
    NoPosition = 7,
    InsufficientCollateral = 8,
    InsufficientDebt = 9,
}

const APPROVE_TTL_LEDGERS: u32 = 120; // ~10 min of ledgers; covers the single tx + buffer

// ============================================================================
// Contract
// ============================================================================

#[contract]
pub struct LeverageVault;

#[contractimpl]
impl LeverageVault {
    /// One-time initialization.
    pub fn initialize(
        env: Env,
        admin: Address,
        blend_pool: Address,
        amm_pool: Address,
        lp_token: Address,
        borrow_asset: Address,
        pair_token: Address,
        borrow_idx: u32,
        pair_idx: u32,
        max_leverage_bps: u32,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Config) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        let config = Config {
            admin,
            blend_pool,
            amm_pool,
            lp_token,
            borrow_asset,
            pair_token,
            borrow_idx,
            pair_idx,
            max_leverage_bps,
        };
        env.storage().instance().set(&DataKey::Config, &config);
        env.storage()
            .instance()
            .set(&DataKey::TotalCollateralLp, &0i128);
        env.storage().instance().set(&DataKey::TotalDebt, &0i128);
        Ok(())
    }

    /// Open (or add to) a leveraged LP position for `user`.
    ///
    /// * `collateral_lp_amount` — LP share tokens the user supplies up front (pulled from
    ///   the user's wallet). May be 0 if the user only wants to lever new borrow.
    /// * `borrow_amount` — amount of `borrow_asset` to flash-borrow and recycle into LP.
    /// * `min_lp_out` — minimum LP the zap must mint from `borrow_amount` (frontend
    ///   simulates this; it is the leveraged collateral claimed against the borrow).
    /// * `min_pair_out` — slippage floor for swapping half the borrow into `pair_token`.
    ///
    /// The resulting Blend position must end healthy or the whole tx reverts.
    pub fn open_position(
        env: Env,
        user: Address,
        collateral_lp_amount: i128,
        borrow_amount: i128,
        min_lp_out: i128,
        min_pair_out: i128,
    ) -> Result<(), Error> {
        user.require_auth();
        let config = Self::load_config(&env)?;

        if borrow_amount <= 0 || collateral_lp_amount < 0 || min_lp_out <= 0 {
            return Err(Error::InvalidAmount);
        }

        // Advisory leverage cap: leveraged LP vs user-supplied LP.
        // (Pure value-based health is enforced by Blend; this is a coarse UX guard.)
        if collateral_lp_amount > 0 {
            let leverage_bps = (collateral_lp_amount + min_lp_out)
                .saturating_mul(10_000)
                / collateral_lp_amount;
            if leverage_bps > config.max_leverage_bps as i128 {
                return Err(Error::LeverageTooHigh);
            }
        }

        let lp = token::TokenClient::new(&env, &config.lp_token);

        // 1. Pull the user's up-front LP collateral into the vault.
        if collateral_lp_amount > 0 {
            lp.transfer(&user, &env.current_contract_address(), &collateral_lp_amount);
        }

        let total_supply_lp = collateral_lp_amount + min_lp_out;

        // 2. Stash transient state for the exec_op callback.
        let flash_state = FlashState {
            borrow_asset: config.borrow_asset.clone(),
            borrow_amount,
            claim_lp: min_lp_out,
            total_supply_lp,
            min_pair_out,
        };
        env.storage()
            .temporary()
            .set(&DataKey::Flash, &flash_state);

        // 3. Flash-borrow, zap (in exec_op), then supply the full LP as collateral.
        let requests = vec![
            &env,
            Request {
                request_type: RT_SUPPLY_COLLATERAL,
                address: config.lp_token.clone(),
                amount: total_supply_lp,
            },
        ];
        let pool = BlendPoolClient::new(&env, &config.blend_pool);
        pool.flash_loan(
            &env.current_contract_address(),
            &FlashLoan {
                contract: env.current_contract_address(),
                asset: config.borrow_asset.clone(),
                amount: borrow_amount,
            },
            &requests,
        );

        // 4. Update per-user + global accounting.
        let mut pos = Self::load_position(&env, &user);
        pos.collateral_lp = pos.collateral_lp.saturating_add(total_supply_lp);
        pos.debt = pos.debt.saturating_add(borrow_amount);
        Self::save_position(&env, &user, &pos);
        Self::add_total_collateral(&env, total_supply_lp);
        Self::add_total_debt(&env, borrow_amount);

        env.storage().temporary().remove(&DataKey::Flash);
        Ok(())
    }

    /// Blend flash-loan callback. Invoked by the Blend pool after it transfers the
    /// borrowed asset to this contract. Zaps the borrow into LP and approves the pool
    /// to pull the resulting collateral.
    ///
    /// `caller` is the position owner (this vault). Guarded by the transient flash state
    /// so it cannot be invoked outside an active `open_position`.
    pub fn exec_op(
        env: Env,
        _caller: Address,
        token_addr: Address,
        amount: i128,
        _fee: i128,
    ) -> Result<(), Error> {
        let fs: FlashState = env
            .storage()
            .temporary()
            .get(&DataKey::Flash)
            .ok_or(Error::NoActiveFlashLoan)?;
        // Consume immediately: defends against re-entrant / external calls.
        env.storage().temporary().remove(&DataKey::Flash);

        if token_addr != fs.borrow_asset || amount != fs.borrow_amount {
            return Err(Error::FlashAssetMismatch);
        }

        let config = Self::load_config(&env)?;
        let vault = env.current_contract_address();

        // 1. Swap half the borrowed asset into the LP pair token.
        let half = amount / 2;
        let amm = AmmPoolClient::new(&env, &config.amm_pool);
        amm.swap(
            &vault,
            &config.borrow_idx,
            &config.pair_idx,
            &(half as u128),
            &(fs.min_pair_out as u128),
        );

        // 2. Deposit both sides (whatever the vault now holds) into the AMM for LP.
        let borrow_tok = token::TokenClient::new(&env, &config.borrow_asset);
        let pair_tok = token::TokenClient::new(&env, &config.pair_token);
        let bal_borrow = borrow_tok.balance(&vault).max(0) as u128;
        let bal_pair = pair_tok.balance(&vault).max(0) as u128;

        let mut desired: Vec<u128> = vec![&env, 0u128, 0u128];
        desired.set(config.borrow_idx, bal_borrow);
        desired.set(config.pair_idx, bal_pair);
        amm.deposit(&vault, &desired, &(fs.claim_lp as u128));

        // 3. Approve the Blend pool to pull the full LP collateral (transfer_from).
        let lp = token::TokenClient::new(&env, &config.lp_token);
        let expiration = env.ledger().sequence() + APPROVE_TTL_LEDGERS;
        lp.approve(
            &vault,
            &config.blend_pool,
            &fs.total_supply_lp,
            &expiration,
        );
        Ok(())
    }

    /// Deleverage / close: repay `repay_amount` of debt (pulled from `user`) and withdraw
    /// `withdraw_lp_amount` of LP collateral back to `user`.
    ///
    /// v1 unwind: the user supplies the repay funds (no flash loan). Flash-loan-based
    /// self-liquidating close is a documented follow-up (see design doc).
    pub fn repay_and_withdraw(
        env: Env,
        user: Address,
        repay_amount: i128,
        withdraw_lp_amount: i128,
        min_lp_out_to_user: i128,
    ) -> Result<(), Error> {
        user.require_auth();
        let config = Self::load_config(&env)?;
        if repay_amount < 0 || withdraw_lp_amount < 0 {
            return Err(Error::InvalidAmount);
        }
        if repay_amount == 0 && withdraw_lp_amount == 0 {
            return Err(Error::InvalidAmount);
        }

        let mut pos = Self::load_position(&env, &user);
        if pos.collateral_lp == 0 && pos.debt == 0 {
            return Err(Error::NoPosition);
        }
        if repay_amount > pos.debt {
            return Err(Error::InsufficientDebt);
        }
        if withdraw_lp_amount > pos.collateral_lp {
            return Err(Error::InsufficientCollateral);
        }
        let _ = min_lp_out_to_user; // reserved for a future zap-out variant

        let vault = env.current_contract_address();
        let mut requests: Vec<Request> = vec![&env];

        // 1. Pull repay funds from the user and queue the Repay.
        if repay_amount > 0 {
            let borrow_tok = token::TokenClient::new(&env, &config.borrow_asset);
            borrow_tok.transfer(&user, &vault, &repay_amount);
            // Allow the pool to pull the repayment from the vault.
            let expiration = env.ledger().sequence() + APPROVE_TTL_LEDGERS;
            borrow_tok.approve(&vault, &config.blend_pool, &repay_amount, &expiration);
            requests.push_back(Request {
                request_type: RT_REPAY,
                address: config.borrow_asset.clone(),
                amount: repay_amount,
            });
        }

        // 2. Queue the collateral withdrawal (pool sends LP to `to`).
        if withdraw_lp_amount > 0 {
            requests.push_back(Request {
                request_type: RT_WITHDRAW_COLLATERAL,
                address: config.lp_token.clone(),
                amount: withdraw_lp_amount,
            });
        }

        // 3. Submit: vault is `from` (position owner) & spender; `user` receives the LP.
        let pool = BlendPoolClient::new(&env, &config.blend_pool);
        pool.submit(&vault, &vault, &user, &requests);

        // 4. Update accounting.
        pos.debt = pos.debt.saturating_sub(repay_amount);
        pos.collateral_lp = pos.collateral_lp.saturating_sub(withdraw_lp_amount);
        Self::save_position(&env, &user, &pos);
        Self::add_total_debt(&env, -repay_amount);
        Self::add_total_collateral(&env, -withdraw_lp_amount);
        Ok(())
    }

    // -------------------------------------------------------------------- views

    pub fn get_config(env: Env) -> Result<Config, Error> {
        Self::load_config(&env)
    }

    pub fn get_position(env: Env, user: Address) -> UserPosition {
        Self::load_position(&env, &user)
    }

    pub fn get_blend_positions(env: Env) -> Result<Positions, Error> {
        let config = Self::load_config(&env)?;
        let pool = BlendPoolClient::new(&env, &config.blend_pool);
        Ok(pool.get_positions(&env.current_contract_address()))
    }

    pub fn get_totals(env: Env) -> (i128, i128) {
        (
            Self::read_i128(&env, &DataKey::TotalCollateralLp),
            Self::read_i128(&env, &DataKey::TotalDebt),
        )
    }

    // -------------------------------------------------------------------- admin

    /// Sweep dust LP / leftover tokens left in the vault by zap rounding.
    pub fn sweep(env: Env, token_addr: Address, to: Address, amount: i128) -> Result<(), Error> {
        let config = Self::load_config(&env)?;
        config.admin.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        token::TokenClient::new(&env, &token_addr).transfer(
            &env.current_contract_address(),
            &to,
            &amount,
        );
        Ok(())
    }

    pub fn set_admin(env: Env, new_admin: Address) -> Result<(), Error> {
        let mut config = Self::load_config(&env)?;
        config.admin.require_auth();
        config.admin = new_admin;
        env.storage().instance().set(&DataKey::Config, &config);
        Ok(())
    }

    // ----------------------------------------------------------------- internal

    fn load_config(env: &Env) -> Result<Config, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(Error::NotInitialized)
    }

    fn load_position(env: &Env, user: &Address) -> UserPosition {
        env.storage()
            .persistent()
            .get(&DataKey::Position(user.clone()))
            .unwrap_or(UserPosition {
                collateral_lp: 0,
                debt: 0,
            })
    }

    fn save_position(env: &Env, user: &Address, pos: &UserPosition) {
        env.storage()
            .persistent()
            .set(&DataKey::Position(user.clone()), pos);
    }

    fn read_i128(env: &Env, key: &DataKey) -> i128 {
        env.storage().instance().get(key).unwrap_or(0)
    }

    fn add_total_collateral(env: &Env, delta: i128) {
        let v = Self::read_i128(env, &DataKey::TotalCollateralLp).saturating_add(delta);
        env.storage().instance().set(&DataKey::TotalCollateralLp, &v);
    }

    fn add_total_debt(env: &Env, delta: i128) {
        let v = Self::read_i128(env, &DataKey::TotalDebt).saturating_add(delta);
        env.storage().instance().set(&DataKey::TotalDebt, &v);
    }
}

#[cfg(test)]
mod test;
