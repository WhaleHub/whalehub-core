#![no_std]
//! WhaleHub Leveraged LP Farming Vault.
//!
//! Multiplies an Aquarius-style LP yield-farming position by using the LP share token as
//! collateral on a Blend V2 lending pool and recycling a flash-borrowed asset (XLM/USDC)
//! back into more LP — atomically, in one transaction, via a separate `zapper` receiver
//! contract (the vault is on the stack during flash_loan, so the receiver must differ).
//!
//! ## Liquidation-aware share accounting
//! The vault owns ONE aggregate Blend position. Rather than store absolute per-user
//! collateral/debt (which would desync the moment Blend liquidates the position), each user
//! holds **collateral shares** and **debt shares**. A user's actual position is always
//! derived from `shares × the live Blend position` (the bToken/dToken balances Blend tracks
//! for this vault). So liquidations — and interest — socialize pro-rata across share holders
//! automatically, with no per-event hook and no desync. See docs/technical/leveraged-lp-farming.md.

use soroban_sdk::{
    auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation},
    contract, contractclient, contracterror, contractimpl, contracttype, token, vec, Address,
    BytesN, Env, IntoVal, Map, Symbol, Vec,
};

// ============================================================================
// Blend V2 pool interface (verified against blend-contracts-v2 `main`)
// ============================================================================

#[contracttype]
#[derive(Clone)]
pub struct Request {
    pub request_type: u32,
    pub address: Address,
    pub amount: i128,
}

#[contracttype]
#[derive(Clone)]
pub struct FlashLoan {
    pub contract: Address,
    pub asset: Address,
    pub amount: i128,
}

#[contracttype]
#[derive(Clone)]
pub struct Positions {
    pub liabilities: Map<u32, i128>,
    pub collateral: Map<u32, i128>,
    pub supply: Map<u32, i128>,
}

const RT_SUPPLY_COLLATERAL: u32 = 2;
const RT_WITHDRAW_COLLATERAL: u32 = 3;
const RT_REPAY: u32 = 5;
const RT_DELETE_LIQ_AUCTION: u32 = 9;

#[contractclient(name = "BlendPoolClient")]
pub trait BlendPoolTrait {
    fn flash_loan(
        env: Env,
        from: Address,
        flash_loan: FlashLoan,
        requests: Vec<Request>,
    ) -> Positions;

    fn submit(
        env: Env,
        from: Address,
        spender: Address,
        to: Address,
        requests: Vec<Request>,
    ) -> Positions;

    fn get_positions(env: Env, from: Address) -> Positions;
}

// ============================================================================
// Zapper (separate flash-loan receiver) interface
// ============================================================================

#[contractclient(name = "ZapperClient")]
pub trait ZapperTrait {
    fn prepare(env: Env, borrow_amount: i128, claim_lp: i128, min_pair_out: i128);
}

// ============================================================================
// Storage & types
// ============================================================================

#[contracttype]
#[derive(Clone)]
pub struct Config {
    /// Admin (config/upgrades, dust sweep).
    pub admin: Address,
    /// Separate flash-loan receiver/zapper contract.
    pub zapper: Address,
    /// Blend V2 pool that holds the leveraged position.
    pub blend_pool: Address,
    /// LP share token (collateral asset). The AMM/pair config lives on the zapper.
    pub lp_token: Address,
    /// Asset borrowed against the LP (XLM or USDC SAC).
    pub borrow_asset: Address,
    /// Reserve index of the LP collateral within the Blend pool (from get_reserve_list).
    pub lp_reserve_index: u32,
    /// Reserve index of the borrow asset within the Blend pool.
    pub borrow_reserve_index: u32,
    /// Max leverage allowed, in basis points (e.g. 30000 = 3.0x). Advisory cap.
    pub max_leverage_bps: u32,
}

/// Per-user accounting, stored as SHARES of the vault's aggregate Blend position.
#[contracttype]
#[derive(Clone)]
pub struct UserShares {
    pub collateral_shares: i128,
    pub debt_shares: i128,
}

/// A user's derived position (live), returned by `get_position`. Units are the vault's
/// Blend bToken/dToken balances attributable to the user (≈ underlying LP / borrow asset
/// while pool rates are near 1).
#[contracttype]
#[derive(Clone)]
pub struct UserPosition {
    pub collateral_lp: i128,
    pub debt: i128,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Config,
    Shares(Address),
    TotalCollateralShares,
    TotalDebtShares,
}

#[contracterror]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidAmount = 3,
    LeverageTooHigh = 4,
    NoPosition = 7,
    InsufficientCollateral = 8,
    InsufficientDebt = 9,
    NothingMinted = 10,
}

const APPROVE_TTL_LEDGERS: u32 = 120;

// ============================================================================
// Contract
// ============================================================================

#[contract]
pub struct LeverageVault;

#[contractimpl]
impl LeverageVault {
    pub fn initialize(
        env: Env,
        admin: Address,
        zapper: Address,
        blend_pool: Address,
        lp_token: Address,
        borrow_asset: Address,
        lp_reserve_index: u32,
        borrow_reserve_index: u32,
        max_leverage_bps: u32,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Config) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        let config = Config {
            admin,
            zapper,
            blend_pool,
            lp_token,
            borrow_asset,
            lp_reserve_index,
            borrow_reserve_index,
            max_leverage_bps,
        };
        env.storage().instance().set(&DataKey::Config, &config);
        env.storage()
            .instance()
            .set(&DataKey::TotalCollateralShares, &0i128);
        env.storage()
            .instance()
            .set(&DataKey::TotalDebtShares, &0i128);
        Ok(())
    }

    /// Open (or add to) a leveraged LP position for `user`.
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
        if collateral_lp_amount > 0 {
            let leverage_bps =
                (collateral_lp_amount + min_lp_out).saturating_mul(10_000) / collateral_lp_amount;
            if leverage_bps > config.max_leverage_bps as i128 {
                return Err(Error::LeverageTooHigh);
            }
        }

        let vault = env.current_contract_address();
        let lp = token::TokenClient::new(&env, &config.lp_token);

        // Snapshot the vault's Blend position BEFORE the leverage round.
        let (b_before, d_before) = Self::read_blend_position(&env, &config);

        // 1. Pull the user's up-front LP collateral.
        if collateral_lp_amount > 0 {
            lp.transfer(&user, &vault, &collateral_lp_amount);
        }
        let total_supply_lp = collateral_lp_amount + min_lp_out;

        // 2. Pre-approve the pool to pull the full LP collateral after the zap.
        let expiration = env.ledger().sequence() + APPROVE_TTL_LEDGERS;
        lp.approve(&vault, &config.blend_pool, &total_supply_lp, &expiration);

        // 3. Stage the zap params on the zapper, then flash-loan with the zapper as receiver.
        let zapper = ZapperClient::new(&env, &config.zapper);
        zapper.prepare(&borrow_amount, &min_lp_out, &min_pair_out);

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
            &vault,
            &FlashLoan {
                contract: config.zapper.clone(),
                asset: config.borrow_asset.clone(),
                amount: borrow_amount,
            },
            &requests,
        );

        // 4. Mint shares from the ACTUAL change in the vault's Blend position (bToken/dToken
        //    deltas), so accounting tracks the real position exactly.
        let (b_after, d_after) = Self::read_blend_position(&env, &config);
        let delta_b = b_after - b_before;
        let delta_d = d_after - d_before;
        if delta_b <= 0 {
            return Err(Error::NothingMinted);
        }

        let total_c = Self::read_total(&env, &DataKey::TotalCollateralShares);
        let total_d = Self::read_total(&env, &DataKey::TotalDebtShares);
        let c_shares = if total_c == 0 || b_before <= 0 {
            delta_b
        } else {
            delta_b.saturating_mul(total_c) / b_before
        };
        let d_shares = if delta_d <= 0 {
            0
        } else if total_d == 0 || d_before <= 0 {
            delta_d
        } else {
            delta_d.saturating_mul(total_d) / d_before
        };

        let mut shares = Self::load_shares(&env, &user);
        shares.collateral_shares = shares.collateral_shares.saturating_add(c_shares);
        shares.debt_shares = shares.debt_shares.saturating_add(d_shares);
        Self::save_shares(&env, &user, &shares);
        Self::add_total(&env, &DataKey::TotalCollateralShares, c_shares);
        Self::add_total(&env, &DataKey::TotalDebtShares, d_shares);
        Ok(())
    }

    /// Deleverage: repay `repay_amount` of debt (pulled from `user`) and withdraw
    /// `withdraw_lp_amount` of LP collateral back to `user`. Shares are burned from the change
    /// in the vault's Blend position, keeping every other user's position whole.
    pub fn repay_and_withdraw(
        env: Env,
        user: Address,
        repay_amount: i128,
        withdraw_lp_amount: i128,
        min_lp_out_to_user: i128,
    ) -> Result<(), Error> {
        user.require_auth();
        let config = Self::load_config(&env)?;
        if repay_amount < 0 || withdraw_lp_amount < 0 || (repay_amount == 0 && withdraw_lp_amount == 0) {
            return Err(Error::InvalidAmount);
        }
        let _ = min_lp_out_to_user; // reserved for a future zap-out variant

        let shares = Self::load_shares(&env, &user);
        if shares.collateral_shares == 0 && shares.debt_shares == 0 {
            return Err(Error::NoPosition);
        }

        let vault = env.current_contract_address();
        let (b_before, d_before) = Self::read_blend_position(&env, &config);
        let total_c = Self::read_total(&env, &DataKey::TotalCollateralShares);
        let total_d = Self::read_total(&env, &DataKey::TotalDebtShares);

        // The user can withdraw/repay at most their share-derived position.
        let user_collateral = Self::shares_to_amount(shares.collateral_shares, b_before, total_c);
        let user_debt = Self::shares_to_amount(shares.debt_shares, d_before, total_d);
        if withdraw_lp_amount > user_collateral {
            return Err(Error::InsufficientCollateral);
        }
        if repay_amount > user_debt {
            return Err(Error::InsufficientDebt);
        }

        let mut requests: Vec<Request> = vec![&env];
        if repay_amount > 0 {
            // Pull the repay funds from the user into the vault (user authorizes via signing).
            token::TokenClient::new(&env, &config.borrow_asset)
                .transfer(&user, &vault, &repay_amount);
            requests.push_back(Request {
                request_type: RT_REPAY,
                address: config.borrow_asset.clone(),
                amount: repay_amount,
            });
        }
        if withdraw_lp_amount > 0 {
            requests.push_back(Request {
                request_type: RT_WITHDRAW_COLLATERAL,
                address: config.lp_token.clone(),
                amount: withdraw_lp_amount,
            });
        }

        // Non-flash `submit` pulls the Repay tokens via `transfer(spender=vault → pool)`,
        // which requires the vault's authorization. Pre-authorize that sub-invocation
        // (the WithdrawCollateral pays out FROM the pool, so it needs no vault auth).
        if repay_amount > 0 {
            let mut auth: Vec<InvokerContractAuthEntry> = vec![&env];
            auth.push_back(InvokerContractAuthEntry::Contract(SubContractInvocation {
                context: ContractContext {
                    contract: config.borrow_asset.clone(),
                    fn_name: Symbol::new(&env, "transfer"),
                    args: (vault.clone(), config.blend_pool.clone(), repay_amount).into_val(&env),
                },
                sub_invocations: vec![&env],
            }));
            env.authorize_as_current_contract(auth);
        }

        let pool = BlendPoolClient::new(&env, &config.blend_pool);
        pool.submit(&vault, &vault, &user, &requests);

        // Burn shares for the actual reduction in the vault's Blend position.
        let (b_after, d_after) = Self::read_blend_position(&env, &config);
        let removed_b = b_before - b_after;
        let removed_d = d_before - d_after;

        let mut new_shares = Self::load_shares(&env, &user);
        if removed_b > 0 && b_before > 0 {
            let burn = (removed_b.saturating_mul(total_c) / b_before).min(new_shares.collateral_shares);
            new_shares.collateral_shares -= burn;
            Self::add_total(&env, &DataKey::TotalCollateralShares, -burn);
        }
        if removed_d > 0 && d_before > 0 {
            let burn = (removed_d.saturating_mul(total_d) / d_before).min(new_shares.debt_shares);
            new_shares.debt_shares -= burn;
            Self::add_total(&env, &DataKey::TotalDebtShares, -burn);
        }
        Self::save_shares(&env, &user, &new_shares);
        Ok(())
    }

    /// Delete a stale liquidation auction on the vault (only valid once the vault's position
    /// is healthy again). Permissionless to call — `from` is the vault, so it deletes the
    /// vault's own auction. Lets anyone unstick the vault after a price recovery.
    pub fn clear_auction(env: Env) -> Result<(), Error> {
        let config = Self::load_config(&env)?;
        let vault = env.current_contract_address();
        let requests = vec![
            &env,
            Request {
                request_type: RT_DELETE_LIQ_AUCTION,
                address: vault.clone(),
                amount: 0,
            },
        ];
        let pool = BlendPoolClient::new(&env, &config.blend_pool);
        pool.submit(&vault, &vault, &vault, &requests);
        Ok(())
    }

    // -------------------------------------------------------------------- views

    pub fn get_config(env: Env) -> Result<Config, Error> {
        Self::load_config(&env)
    }

    /// The user's live, liquidation-adjusted position (derived from shares × the vault's
    /// current Blend position).
    pub fn get_position(env: Env, user: Address) -> UserPosition {
        let config = match Self::load_config(&env) {
            Ok(c) => c,
            Err(_) => return UserPosition { collateral_lp: 0, debt: 0 },
        };
        let shares = Self::load_shares(&env, &user);
        let (b, d) = Self::read_blend_position(&env, &config);
        let total_c = Self::read_total(&env, &DataKey::TotalCollateralShares);
        let total_d = Self::read_total(&env, &DataKey::TotalDebtShares);
        UserPosition {
            collateral_lp: Self::shares_to_amount(shares.collateral_shares, b, total_c),
            debt: Self::shares_to_amount(shares.debt_shares, d, total_d),
        }
    }

    pub fn get_user_shares(env: Env, user: Address) -> UserShares {
        Self::load_shares(&env, &user)
    }

    pub fn get_blend_positions(env: Env) -> Result<Positions, Error> {
        let config = Self::load_config(&env)?;
        let pool = BlendPoolClient::new(&env, &config.blend_pool);
        Ok(pool.get_positions(&env.current_contract_address()))
    }

    /// (total collateral, total debt) of the vault's live Blend position (bToken/dToken units).
    pub fn get_totals(env: Env) -> (i128, i128) {
        match Self::load_config(&env) {
            Ok(config) => Self::read_blend_position(&env, &config),
            Err(_) => (0, 0),
        }
    }

    pub fn get_share_totals(env: Env) -> (i128, i128) {
        (
            Self::read_total(&env, &DataKey::TotalCollateralShares),
            Self::read_total(&env, &DataKey::TotalDebtShares),
        )
    }

    // -------------------------------------------------------------------- admin

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

    /// Upgrade the contract wasm in place (keeps the contract address + state stable).
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), Error> {
        let config = Self::load_config(&env)?;
        config.admin.require_auth();
        env.deployer().update_current_contract_wasm(new_wasm_hash);
        Ok(())
    }

    // ----------------------------------------------------------------- internal

    fn load_config(env: &Env) -> Result<Config, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(Error::NotInitialized)
    }

    /// Read the vault's live Blend position as (collateral bTokens, debt dTokens).
    fn read_blend_position(env: &Env, config: &Config) -> (i128, i128) {
        let pool = BlendPoolClient::new(env, &config.blend_pool);
        let positions = pool.get_positions(&env.current_contract_address());
        let b = positions.collateral.get(config.lp_reserve_index).unwrap_or(0);
        let d = positions.liabilities.get(config.borrow_reserve_index).unwrap_or(0);
        (b, d)
    }

    fn shares_to_amount(user_shares: i128, total_amount: i128, total_shares: i128) -> i128 {
        if total_shares <= 0 || user_shares <= 0 {
            0
        } else {
            user_shares.saturating_mul(total_amount) / total_shares
        }
    }

    fn load_shares(env: &Env, user: &Address) -> UserShares {
        env.storage()
            .persistent()
            .get(&DataKey::Shares(user.clone()))
            .unwrap_or(UserShares {
                collateral_shares: 0,
                debt_shares: 0,
            })
    }

    fn save_shares(env: &Env, user: &Address, shares: &UserShares) {
        env.storage()
            .persistent()
            .set(&DataKey::Shares(user.clone()), shares);
    }

    fn read_total(env: &Env, key: &DataKey) -> i128 {
        env.storage().instance().get(key).unwrap_or(0)
    }

    fn add_total(env: &Env, key: &DataKey, delta: i128) {
        let v = Self::read_total(env, key).saturating_add(delta);
        env.storage().instance().set(key, &v);
    }
}

#[cfg(test)]
mod test;
