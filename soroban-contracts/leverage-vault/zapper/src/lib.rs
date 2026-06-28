#![no_std]
//! Flash-loan receiver / zapper for the WhaleHub leverage vault.
//!
//! This MUST be a contract separate from the vault. The vault calls `pool.flash_loan` from
//! within `open_position`, so the vault is already on the call stack when Blend invokes the
//! receiver's `exec_op`. If the vault were also the receiver, Soroban would reject it with
//! "Contract re-entry is not allowed". By making the zapper the receiver, the vault stays on
//! the stack while a *different* contract handles the callback.
//!
//! Flow per `open_position`:
//!   1. vault pulls the user's LP, pre-approves the pool for the total LP, and calls
//!      `zapper.prepare(...)` to stage the zap params.
//!   2. vault calls `pool.flash_loan(from=vault, contract=zapper, requests=[SupplyCollateral])`.
//!   3. Blend transfers the borrowed asset to the zapper and calls `zapper.exec_op`.
//!   4. exec_op swaps half → pair token, deposits both into the AMM → LP, and transfers the
//!      minted LP to the vault.
//!   5. Blend pulls the total LP from the vault (pre-approved) to satisfy SupplyCollateral.

use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, token, vec, Address,
    BytesN, Env, Vec,
};

#[contractclient(name = "AmmPoolClient")]
pub trait AmmPoolTrait {
    fn deposit(
        env: Env,
        user: Address,
        desired_amounts: Vec<u128>,
        min_shares: u128,
    ) -> (Vec<u128>, u128);
    fn swap(
        env: Env,
        user: Address,
        in_idx: u32,
        out_idx: u32,
        in_amount: u128,
        out_min: u128,
    ) -> u128;
}

#[contracttype]
#[derive(Clone)]
pub struct Config {
    pub admin: Address,
    /// The leverage vault this zapper serves (the flash-loan `from` / position owner).
    pub vault: Address,
    pub amm_pool: Address,
    pub lp_token: Address,
    pub borrow_asset: Address,
    pub pair_token: Address,
    pub borrow_idx: u32,
    pub pair_idx: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct Pending {
    pub borrow_amount: i128,
    pub claim_lp: i128,
    pub min_pair_out: i128,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Config,
    Pending,
}

#[contracterror]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    NoPending = 3,
    AssetMismatch = 4,
    Unauthorized = 5,
}

const APPROVE_TTL_LEDGERS: u32 = 120;

#[contract]
pub struct Zapper;

#[contractimpl]
impl Zapper {
    pub fn initialize(
        env: Env,
        admin: Address,
        vault: Address,
        amm_pool: Address,
        lp_token: Address,
        borrow_asset: Address,
        pair_token: Address,
        borrow_idx: u32,
        pair_idx: u32,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Config) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(
            &DataKey::Config,
            &Config {
                admin,
                vault,
                amm_pool,
                lp_token,
                borrow_asset,
                pair_token,
                borrow_idx,
                pair_idx,
            },
        );
        Ok(())
    }

    /// Staged by the vault immediately before it calls `pool.flash_loan`. Only the configured
    /// vault may call this.
    pub fn prepare(
        env: Env,
        borrow_amount: i128,
        claim_lp: i128,
        min_pair_out: i128,
    ) -> Result<(), Error> {
        let config = Self::load_config(&env)?;
        config.vault.require_auth();
        env.storage().temporary().set(
            &DataKey::Pending,
            &Pending {
                borrow_amount,
                claim_lp,
                min_pair_out,
            },
        );
        Ok(())
    }

    /// Blend flash-loan callback. The pool passes `caller` = the flash-loan `from` (the vault),
    /// having already transferred `amount` of `token_addr` to this contract.
    pub fn exec_op(
        env: Env,
        caller: Address,
        token_addr: Address,
        amount: i128,
        _fee: i128,
    ) -> Result<(), Error> {
        let config = Self::load_config(&env)?;
        // Only legitimate when invoked as the vault's flash-loan receiver.
        if caller != config.vault {
            return Err(Error::Unauthorized);
        }
        let pending: Pending = env
            .storage()
            .temporary()
            .get(&DataKey::Pending)
            .ok_or(Error::NoPending)?;
        env.storage().temporary().remove(&DataKey::Pending);

        if token_addr != config.borrow_asset || amount != pending.borrow_amount {
            return Err(Error::AssetMismatch);
        }

        let me = env.current_contract_address();
        let expiration = env.ledger().sequence() + APPROVE_TTL_LEDGERS;
        let borrow_tok = token::TokenClient::new(&env, &config.borrow_asset);
        let pair_tok = token::TokenClient::new(&env, &config.pair_token);

        // 1. Swap half the borrowed asset into the LP pair token (AMM pulls via transfer_from).
        let half = amount / 2;
        borrow_tok.approve(&me, &config.amm_pool, &amount, &expiration);
        let amm = AmmPoolClient::new(&env, &config.amm_pool);
        amm.swap(
            &me,
            &config.borrow_idx,
            &config.pair_idx,
            &(half as u128),
            &(pending.min_pair_out as u128),
        );

        // 2. Deposit both sides into the AMM → LP.
        let bal_borrow = borrow_tok.balance(&me).max(0) as u128;
        let bal_pair = pair_tok.balance(&me).max(0) as u128;
        pair_tok.approve(&me, &config.amm_pool, &(bal_pair as i128), &expiration);
        let mut desired: Vec<u128> = vec![&env, 0u128, 0u128];
        desired.set(config.borrow_idx, bal_borrow);
        desired.set(config.pair_idx, bal_pair);
        amm.deposit(&me, &desired, &(pending.claim_lp as u128));

        // 3. Send the minted LP to the vault (vault has pre-approved the pool to pull it).
        let lp = token::TokenClient::new(&env, &config.lp_token);
        let lp_bal = lp.balance(&me).max(0);
        if lp_bal > 0 {
            lp.transfer(&me, &config.vault, &lp_bal);
        }
        Ok(())
    }

    pub fn get_config(env: Env) -> Result<Config, Error> {
        Self::load_config(&env)
    }

    /// Upgrade the contract wasm in place (admin only).
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), Error> {
        let config = Self::load_config(&env)?;
        config.admin.require_auth();
        env.deployer().update_current_contract_wasm(new_wasm_hash);
        Ok(())
    }

    fn load_config(env: &Env) -> Result<Config, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(Error::NotInitialized)
    }
}
