#![cfg(test)]
extern crate std;

use crate::{IceTokens, StakingRegistry, StakingRegistryClient};
use soroban_sdk::{testutils::Address as _, token, Address, Env};

// ── helpers ────────────────────────────────────────────────────────────────

fn gen_ice(env: &Env) -> IceTokens {
    IceTokens {
        ice_token: Address::generate(env),
        govern_ice_token: Address::generate(env),
        upvote_ice_token: Address::generate(env),
        downvote_ice_token: Address::generate(env),
    }
}

/// Owned test context — no borrows, so no self-referential-struct issues.
/// Build clients on demand from `env` inside each test.
struct Ctx {
    env: Env,
    contract_id: Address,
    admin: Address,
    aqua: Address,
    blub: Address,
    treasury: Address,
    vault_treasury: Address,
}

impl Ctx {
    fn client(&self) -> StakingRegistryClient<'_> {
        StakingRegistryClient::new(&self.env, &self.contract_id)
    }
    fn aqua_admin(&self) -> token::StellarAssetClient<'_> {
        token::StellarAssetClient::new(&self.env, &self.aqua)
    }
    fn aqua_tok(&self) -> token::TokenClient<'_> {
        token::TokenClient::new(&self.env, &self.aqua)
    }
    fn blub_tok(&self) -> token::TokenClient<'_> {
        token::TokenClient::new(&self.env, &self.blub)
    }
}

/// Full init with real AQUA/BLUB SACs and the staking contract set as the BLUB
/// SAC admin (so `lock` can mint BLUB).
fn setup() -> Ctx {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let vault_treasury = Address::generate(&env);
    let liquidity = Address::generate(&env);

    let aqua = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let blub = env.register_stellar_asset_contract_v2(admin.clone()).address();

    let contract_id = env.register_contract(None, StakingRegistry);
    let client = StakingRegistryClient::new(&env, &contract_id);
    client.initialize(
        &admin,
        &treasury,
        &aqua,
        &blub,
        &liquidity,
        &gen_ice(&env),
        &vault_treasury,
        &1500u32,
    );

    // Hand BLUB mint authority to the staking contract.
    token::StellarAssetClient::new(&env, &blub).set_admin(&contract_id);

    Ctx {
        env,
        contract_id,
        admin,
        aqua,
        blub,
        treasury,
        vault_treasury,
    }
}

// ── initialize / config ──────────────────────────────────────────────────

#[test]
fn test_initialize_sets_config() {
    let c = setup();
    let cfg = c.client().get_config();
    assert_eq!(cfg.admin, c.admin);
    assert_eq!(cfg.aqua_token, c.aqua);
    assert_eq!(cfg.blub_token, c.blub);
    assert_eq!(cfg.vault_fee_bps, 1500);
}

#[test]
fn test_double_initialize_fails() {
    let c = setup();
    let res = c.client().try_initialize(
        &c.admin,
        &c.treasury,
        &c.aqua,
        &c.blub,
        &Address::generate(&c.env),
        &gen_ice(&c.env),
        &c.vault_treasury,
        &1500u32,
    );
    assert!(res.is_err(), "second initialize must fail (AlreadyInitialized)");
}

// ── POL counter / sync_pol_position (NEW) ─────────────────────────────────

#[test]
fn test_pol_position_starts_zero() {
    let c = setup();
    assert_eq!(
        c.client().get_protocol_owned_liquidity().aqua_blub_lp_position,
        0
    );
}

#[test]
fn test_sync_pol_position_sets_counter() {
    let c = setup();
    // ManagerAddress unset -> require_manager_auth falls back to admin.
    c.client().sync_pol_position(&c.admin, &123_456_i128);
    assert_eq!(
        c.client().get_protocol_owned_liquidity().aqua_blub_lp_position,
        123_456
    );

    // Correcting to a negative value is the whole point of the setter.
    c.client().sync_pol_position(&c.admin, &-50_i128);
    assert_eq!(
        c.client().get_protocol_owned_liquidity().aqua_blub_lp_position,
        -50
    );
}

#[test]
fn test_sync_pol_position_unauthorized() {
    let c = setup();
    let attacker = Address::generate(&c.env);
    let res = c.client().try_sync_pol_position(&attacker, &999_i128);
    assert!(res.is_err(), "non-manager/non-admin must not set POL counter");
    assert_eq!(
        c.client().get_protocol_owned_liquidity().aqua_blub_lp_position,
        0
    );
}

#[test]
fn test_sync_pol_position_by_manager() {
    let c = setup();
    let manager = Address::generate(&c.env);
    c.client().set_manager(&c.admin, &manager);
    c.client().sync_pol_position(&manager, &777_i128);
    assert_eq!(
        c.client().get_protocol_owned_liquidity().aqua_blub_lp_position,
        777
    );
    // Once a manager is set, the admin no longer passes manager auth.
    let res = c.client().try_sync_pol_position(&c.admin, &1_i128);
    assert!(res.is_err(), "admin should not pass manager auth once manager is set");
}

// ── lock / stake accounting ────────────────────────────────────────────────

#[test]
fn test_lock_mints_blub_and_splits_to_manager() {
    let c = setup();
    let user = Address::generate(&c.env);
    let manager = Address::generate(&c.env);
    c.client().set_manager(&c.admin, &manager);

    // Fund the user with AQUA.
    let amount: i128 = 100_0000000; // 100 AQUA (7 decimals)
    c.aqua_admin().mint(&user, &amount);
    assert_eq!(c.aqua_tok().balance(&user), amount);

    c.client().lock(&user, &amount, &1u64);

    // 10% AQUA (10) goes to the manager wallet.
    let ten_pct = amount / 10;
    assert_eq!(c.aqua_tok().balance(&manager), ten_pct, "manager gets 10% AQUA");
    // User's AQUA is fully spent.
    assert_eq!(c.aqua_tok().balance(&user), 0);
    // Manager receives 0.1x BLUB (10 BLUB) for pool liquidity.
    assert_eq!(c.blub_tok().balance(&manager), ten_pct, "manager gets 0.1x BLUB");
}

#[test]
fn test_lock_grows_pending_aqua_for_ice() {
    let c = setup();
    let user = Address::generate(&c.env);
    let amount: i128 = 200_0000000; // 200 AQUA
    c.aqua_admin().mint(&user, &amount);

    c.client().lock(&user, &amount, &1u64);

    // 90% of the locked AQUA is queued for ICE governance locking.
    let pending = c.client().get_pending_aqua_for_ice();
    assert_eq!(pending, amount * 90 / 100, "90% queued for ICE");
}

#[test]
fn test_lock_zero_amount_fails() {
    let c = setup();
    let user = Address::generate(&c.env);
    let res = c.client().try_lock(&user, &0i128, &1u64);
    assert!(res.is_err(), "locking zero must fail");
}

// ── withdraw_from_pool guard (NEW) — auth gate ─────────────────────────────
// NOTE: the guard's *surplus math* (reject when share_amount > contract_lp -
// total_lp_tokens) needs a mock Aquarius pool + seeded pool_info to exercise,
// which is a larger harness (follow-up). Here we cover the admin-auth gate,
// which runs before the surplus check.

#[test]
fn test_withdraw_from_pool_requires_admin() {
    let c = setup();
    let attacker = Address::generate(&c.env);
    let res = c.client().try_withdraw_from_pool(&attacker, &1_000_000_i128, &0i128, &0i128);
    assert!(res.is_err(), "withdraw_from_pool must reject a non-admin caller");
}

#[test]
fn test_withdraw_from_pool_rejects_nonpositive() {
    let c = setup();
    let res = c.client().try_withdraw_from_pool(&c.admin, &0i128, &0i128, &0i128);
    assert!(res.is_err(), "withdraw_from_pool must reject share_amount <= 0");
}
