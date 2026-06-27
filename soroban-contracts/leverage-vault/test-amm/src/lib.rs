#![no_std]
//! Minimal constant-product AMM for TESTNET use as the leverage vault's LP collateral
//! source. Implements the Aquarius pool-level interface the vault targets
//! (`deposit` / `swap` / `withdraw` / `get_reserves` / `get_total_shares`) AND is its own
//! SEP-41 LP token, so the LP share token address == this contract and Blend can pull it
//! via `transfer_from`.
//!
//! NOT for mainnet. Two reserves, 0.3% swap fee, no oracle, no reentrancy hardening
//! beyond what Soroban gives for free. See docs/technical/leveraged-lp-farming.md.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, token, Address, Env, String, Vec,
};

const FEE_NUM: u128 = 997; // 0.3% fee
const FEE_DEN: u128 = 1000;

#[contracttype]
#[derive(Clone)]
pub struct AllowanceValue {
    pub amount: i128,
    pub expiration_ledger: u32,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Token0,
    Token1,
    Reserve0,
    Reserve1,
    TotalSupply,
    Balance(Address),
    Allowance(Address, Address), // (from, spender)
}

#[contracterror]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidAmount = 3,
    SlippageExceeded = 4,
    InsufficientLiquidity = 5,
    BadIndex = 6,
    InsufficientBalance = 7,
    InsufficientAllowance = 8,
}

#[contract]
pub struct TestAmm;

#[contractimpl]
impl TestAmm {
    pub fn initialize(env: Env, token_0: Address, token_1: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Token0) {
            return Err(Error::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Token0, &token_0);
        env.storage().instance().set(&DataKey::Token1, &token_1);
        env.storage().instance().set(&DataKey::Reserve0, &0i128);
        env.storage().instance().set(&DataKey::Reserve1, &0i128);
        env.storage().instance().set(&DataKey::TotalSupply, &0i128);
        Ok(())
    }

    // ----------------------------------------------------------- AMM interface

    /// Deposit `desired_amounts` = [amount0, amount1]; mint LP shares to `user`.
    /// Returns (amounts_used, shares_minted). Mirrors the Aquarius pool-level signature.
    pub fn deposit(
        env: Env,
        user: Address,
        desired_amounts: Vec<u128>,
        min_shares: u128,
    ) -> Result<(Vec<u128>, u128), Error> {
        user.require_auth();
        if desired_amounts.len() != 2 {
            return Err(Error::InvalidAmount);
        }
        let amt0 = desired_amounts.get(0).unwrap() as i128;
        let amt1 = desired_amounts.get(1).unwrap() as i128;
        if amt0 <= 0 || amt1 <= 0 {
            return Err(Error::InvalidAmount);
        }

        let (t0, t1) = Self::tokens(&env);
        let me = env.current_contract_address();
        // Pull underlying from the user (requires user -> this-contract allowance).
        token::TokenClient::new(&env, &t0).transfer_from(&me, &user, &me, &amt0);
        token::TokenClient::new(&env, &t1).transfer_from(&me, &user, &me, &amt1);

        let res0 = Self::reserve(&env, 0);
        let res1 = Self::reserve(&env, 1);
        let total = Self::total_supply(&env);

        let shares: i128 = if total == 0 {
            isqrt((amt0 as u128).saturating_mul(amt1 as u128)) as i128
        } else {
            let s0 = (amt0 as u128).saturating_mul(total as u128) / (res0 as u128);
            let s1 = (amt1 as u128).saturating_mul(total as u128) / (res1 as u128);
            s0.min(s1) as i128
        };
        if shares <= 0 {
            return Err(Error::InsufficientLiquidity);
        }
        if (shares as u128) < min_shares {
            return Err(Error::SlippageExceeded);
        }

        Self::set_reserve(&env, 0, res0 + amt0);
        Self::set_reserve(&env, 1, res1 + amt1);
        Self::mint(&env, &user, shares);

        let mut used = Vec::new(&env);
        used.push_back(amt0 as u128);
        used.push_back(amt1 as u128);
        Ok((used, shares as u128))
    }

    /// Swap `in_amount` of token `in_idx` for token `out_idx`. Returns amount out.
    pub fn swap(
        env: Env,
        user: Address,
        in_idx: u32,
        out_idx: u32,
        in_amount: u128,
        out_min: u128,
    ) -> Result<u128, Error> {
        user.require_auth();
        if in_idx == out_idx || in_idx > 1 || out_idx > 1 {
            return Err(Error::BadIndex);
        }
        if in_amount == 0 {
            return Err(Error::InvalidAmount);
        }
        let res_in = Self::reserve(&env, in_idx) as u128;
        let res_out = Self::reserve(&env, out_idx) as u128;
        if res_in == 0 || res_out == 0 {
            return Err(Error::InsufficientLiquidity);
        }

        let in_with_fee = in_amount.saturating_mul(FEE_NUM) / FEE_DEN;
        let out = res_out.saturating_mul(in_with_fee) / (res_in + in_with_fee);
        if out < out_min || out == 0 {
            return Err(Error::SlippageExceeded);
        }

        let (t0, t1) = Self::tokens(&env);
        let token_in = if in_idx == 0 { &t0 } else { &t1 };
        let token_out = if out_idx == 0 { &t0 } else { &t1 };
        let me = env.current_contract_address();
        token::TokenClient::new(&env, token_in).transfer_from(&me, &user, &me, &(in_amount as i128));
        token::TokenClient::new(&env, token_out).transfer(&me, &user, &(out as i128));

        Self::set_reserve(&env, in_idx, (res_in + in_amount) as i128);
        Self::set_reserve(&env, out_idx, (res_out - out) as i128);
        Ok(out)
    }

    /// Burn `share_amount` LP from `user`, return both underlying. Returns amounts out.
    pub fn withdraw(
        env: Env,
        user: Address,
        share_amount: u128,
        min_amounts: Vec<u128>,
    ) -> Result<Vec<u128>, Error> {
        user.require_auth();
        if share_amount == 0 || min_amounts.len() != 2 {
            return Err(Error::InvalidAmount);
        }
        let total = Self::total_supply(&env) as u128;
        if total == 0 {
            return Err(Error::InsufficientLiquidity);
        }
        let res0 = Self::reserve(&env, 0) as u128;
        let res1 = Self::reserve(&env, 1) as u128;
        let out0 = res0.saturating_mul(share_amount) / total;
        let out1 = res1.saturating_mul(share_amount) / total;
        if out0 < min_amounts.get(0).unwrap() || out1 < min_amounts.get(1).unwrap() {
            return Err(Error::SlippageExceeded);
        }

        Self::burn(&env, &user, share_amount as i128)?;
        Self::set_reserve(&env, 0, (res0 - out0) as i128);
        Self::set_reserve(&env, 1, (res1 - out1) as i128);

        let (t0, t1) = Self::tokens(&env);
        let me = env.current_contract_address();
        token::TokenClient::new(&env, &t0).transfer(&me, &user, &(out0 as i128));
        token::TokenClient::new(&env, &t1).transfer(&me, &user, &(out1 as i128));

        let mut out = Vec::new(&env);
        out.push_back(out0);
        out.push_back(out1);
        Ok(out)
    }

    pub fn get_reserves(env: Env) -> Vec<u128> {
        let mut v = Vec::new(&env);
        v.push_back(Self::reserve(&env, 0) as u128);
        v.push_back(Self::reserve(&env, 1) as u128);
        v
    }

    pub fn get_total_shares(env: Env) -> u128 {
        Self::total_supply(&env) as u128
    }

    pub fn share_id(env: Env) -> Address {
        env.current_contract_address()
    }

    // -------------------------------------------------- SEP-41 LP token (subset)

    pub fn balance(env: Env, id: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Balance(id))
            .unwrap_or(0)
    }

    pub fn allowance(env: Env, from: Address, spender: Address) -> i128 {
        match env
            .storage()
            .temporary()
            .get::<DataKey, AllowanceValue>(&DataKey::Allowance(from, spender))
        {
            Some(a) if a.expiration_ledger >= env.ledger().sequence() => a.amount,
            _ => 0,
        }
    }

    pub fn approve(
        env: Env,
        from: Address,
        spender: Address,
        amount: i128,
        expiration_ledger: u32,
    ) {
        from.require_auth();
        let key = DataKey::Allowance(from, spender);
        env.storage().temporary().set(
            &key,
            &AllowanceValue {
                amount,
                expiration_ledger,
            },
        );
        if amount > 0 {
            let ttl = expiration_ledger.saturating_sub(env.ledger().sequence());
            if ttl > 0 {
                env.storage().temporary().extend_ttl(&key, ttl, ttl);
            }
        }
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        Self::do_transfer(&env, &from, &to, amount);
    }

    pub fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) {
        spender.require_auth();
        Self::spend_allowance(&env, &from, &spender, amount);
        Self::do_transfer(&env, &from, &to, amount);
    }

    pub fn decimals(_env: Env) -> u32 {
        7
    }
    pub fn name(env: Env) -> String {
        String::from_str(&env, "WhaleHub Test LP")
    }
    pub fn symbol(env: Env) -> String {
        String::from_str(&env, "WHLP")
    }

    // ----------------------------------------------------------------- internal

    fn tokens(env: &Env) -> (Address, Address) {
        (
            env.storage().instance().get(&DataKey::Token0).unwrap(),
            env.storage().instance().get(&DataKey::Token1).unwrap(),
        )
    }

    fn reserve(env: &Env, idx: u32) -> i128 {
        let key = if idx == 0 { DataKey::Reserve0 } else { DataKey::Reserve1 };
        env.storage().instance().get(&key).unwrap_or(0)
    }

    fn set_reserve(env: &Env, idx: u32, val: i128) {
        let key = if idx == 0 { DataKey::Reserve0 } else { DataKey::Reserve1 };
        env.storage().instance().set(&key, &val);
    }

    fn total_supply(env: &Env) -> i128 {
        env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0)
    }

    fn mint(env: &Env, to: &Address, amount: i128) {
        let bal = Self::balance(env.clone(), to.clone()) + amount;
        env.storage().persistent().set(&DataKey::Balance(to.clone()), &bal);
        let total = Self::total_supply(env) + amount;
        env.storage().instance().set(&DataKey::TotalSupply, &total);
    }

    fn burn(env: &Env, from: &Address, amount: i128) -> Result<(), Error> {
        let bal = Self::balance(env.clone(), from.clone());
        if bal < amount {
            return Err(Error::InsufficientBalance);
        }
        env.storage().persistent().set(&DataKey::Balance(from.clone()), &(bal - amount));
        let total = Self::total_supply(env) - amount;
        env.storage().instance().set(&DataKey::TotalSupply, &total);
        Ok(())
    }

    fn do_transfer(env: &Env, from: &Address, to: &Address, amount: i128) {
        if amount <= 0 {
            return;
        }
        let from_bal = Self::balance(env.clone(), from.clone());
        if from_bal < amount {
            panic!("insufficient LP balance");
        }
        env.storage().persistent().set(&DataKey::Balance(from.clone()), &(from_bal - amount));
        let to_bal = Self::balance(env.clone(), to.clone()) + amount;
        env.storage().persistent().set(&DataKey::Balance(to.clone()), &to_bal);
    }

    fn spend_allowance(env: &Env, from: &Address, spender: &Address, amount: i128) {
        let current = Self::allowance(env.clone(), from.clone(), spender.clone());
        if current < amount {
            panic!("insufficient allowance");
        }
        let key = DataKey::Allowance(from.clone(), spender.clone());
        let existing: AllowanceValue = env.storage().temporary().get(&key).unwrap();
        env.storage().temporary().set(
            &key,
            &AllowanceValue {
                amount: current - amount,
                expiration_ledger: existing.expiration_ledger,
            },
        );
    }
}

/// Integer square root (Babylonian).
fn isqrt(n: u128) -> u128 {
    if n == 0 {
        return 0;
    }
    let mut x = n;
    let mut y = (x + 1) / 2;
    while y < x {
        x = y;
        y = (x + n / x) / 2;
    }
    x
}

#[cfg(test)]
mod test;
