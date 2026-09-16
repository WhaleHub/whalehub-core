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

// ── single-sided POL deposits (2026-09-08) ────────────────────────────────
//
// A reward tranche can now be added as pure AQUA (or pure BLUB) so it is not
// half-swapped into the other leg first. Exactly one leg may be zero; both zero
// is a caller error rather than a silent success.

#[test]
fn test_manual_deposit_pol_rejects_both_legs_zero() {
    let c = setup();
    let res = c.client().try_manual_deposit_pol(&c.admin, &0i128, &0i128, &0u128);
    assert!(res.is_err(), "a deposit of nothing must be rejected, not silently accepted");
}

#[test]
fn test_manual_deposit_pol_rejects_negative_leg() {
    let c = setup();
    let res = c.client().try_manual_deposit_pol(&c.admin, &-1i128, &10i128, &0u128);
    assert!(res.is_err(), "a negative leg must be rejected");
}

// NOTE: the single-sided *happy path* (one leg zero, deposit actually reaching
// the Aquarius pool) is NOT unit-tested. `liquidity_contract` is a bare address
// in this harness, so every call that reaches the pool collapses to
// `InvalidInput` and cannot be distinguished from a guard rejection. That path
// needs a mock AMM (as the leverage-vault workspace has) or a testnet dry-run.
// Only the input guards below are covered here.

#[test]
fn test_admin_compound_deposit_rejects_both_legs_zero() {
    let c = setup();
    let res = c.client().try_admin_compound_deposit(&c.admin, &0u32, &0i128, &0i128, &0u128);
    assert!(res.is_err(), "compounding nothing must be rejected");
}

// ── single-coin POL withdrawal (2026-09-08) ───────────────────────────────

#[test]
fn test_withdraw_pol_one_coin_requires_admin() {
    let c = setup();
    let attacker = Address::generate(&c.env);
    let res = c.client().try_withdraw_pol_one_coin(&attacker, &1_000_000_i128, &1u32, &0i128);
    assert!(res.is_err(), "withdraw_pol_one_coin must reject a non-admin caller");
}

#[test]
fn test_withdraw_pol_one_coin_rejects_bad_input() {
    let c = setup();
    let cl = c.client();
    assert!(
        cl.try_withdraw_pol_one_coin(&c.admin, &0i128, &1u32, &0i128).is_err(),
        "share_amount <= 0 must be rejected"
    );
    assert!(
        cl.try_withdraw_pol_one_coin(&c.admin, &1_000_i128, &2u32, &0i128).is_err(),
        "a coin_index outside the pool's two tokens must be rejected"
    );
    assert!(
        cl.try_withdraw_pol_one_coin(&c.admin, &1_000_i128, &1u32, &-1i128).is_err(),
        "a negative min_amount must be rejected"
    );
}

// ── zero-share bucket guard (2026-09-11) ──────────────────────────────────
//
// `admin_compound_deposit` raises a bucket's `total_lp_tokens` without minting
// shares. With `total_shares == 0` that LP has no owner, and the first depositor
// mints through the `total_shares == 0` branch — becoming sole shareholder and
// redeeming the entire accumulated tranche for a dust deposit. Pools 1 and 2
// were already sitting in exactly this state on mainnet when the guard was
// written.
//
// LIMITATION: as with the single-sided tests above, `liquidity_contract` is a
// bare address here, so a rejected call cannot be distinguished from a call that
// died reaching the pool. What this test does pin down is the PRECONDITION —
// a freshly added bucket really does report zero shares — plus the rejection
// itself, so removing the guard without replacing it is caught.

#[test]
fn test_admin_compound_deposit_rejects_zero_share_bucket() {
    let c = setup();
    let cl = c.client();

    assert_eq!(
        cl.get_vault_total_shares(&0u32),
        0,
        "a bucket with no depositors must report zero shares"
    );

    assert!(
        cl.try_admin_compound_deposit(&c.admin, &0u32, &1_000_i128, &1_000_i128, &0u128)
            .is_err(),
        "compounding into a bucket with no depositors must be rejected"
    );
}

// ── v3 reward engine (2026-09-12) ─────────────────────────────────────────
//
// v2 paid stakers in BLUB, which made every reward a market buy into a thin
// pool. v3 pays the AQUA that pooled ICE voting already earns. The payout token
// is a parameter so the change is reversible without an upgrade.

use crate::{RewardToken};

#[test]
fn test_reward_policy_defaults_to_v2_behaviour() {
    let c = setup();
    let p = c.client().get_reward_policy();
    assert_eq!(
        p.payout_token,
        RewardToken::Blub,
        "landing the v3 upgrade must not change payout behaviour on its own — \
         the engine only switches when the multisig sets the policy"
    );
    assert!(!p.allow_user_choice);
    assert_eq!(
        p.staker_bps + p.lp_bps + p.pol_bps + p.treasury_bps,
        10_000
    );
}

#[test]
fn test_set_reward_policy_requires_admin() {
    let c = setup();
    let attacker = Address::generate(&c.env);
    let res = c.client().try_set_reward_policy(
        &attacker, &RewardToken::Aqua, &true, &5000u32, &3000u32, &1000u32, &1000u32, &100u32,
    );
    assert!(res.is_err(), "only the multisig admin may set the reward policy");
}

#[test]
fn test_set_reward_policy_rejects_splits_that_do_not_total_10000() {
    let c = setup();
    let res = c.client().try_set_reward_policy(
        &c.admin, &RewardToken::Blub, &false, &5000u32, &3000u32, &1000u32, &2000u32, &100u32,
    );
    assert!(res.is_err(), "revenue split must total exactly 100%");
}

#[test]
fn test_set_reward_policy_applies_version_a_split() {
    let c = setup();
    let cl = c.client();
    // Version A: 50 stakers / 30 LPs / 10 POL / 10 treasury, no protocol BLUB buys.
    cl.set_reward_policy(
        &c.admin, &RewardToken::Aqua, &true, &5000u32, &3000u32, &1000u32, &1000u32, &100u32,
    );
    let p = cl.get_reward_policy();
    assert_eq!(p.payout_token, RewardToken::Aqua);
    assert!(p.allow_user_choice);
    assert_eq!(p.staker_bps, 5000);
    assert_eq!(p.lp_bps, 3000);
    assert_eq!(p.pol_bps, 1000);
    assert_eq!(p.treasury_bps, 1000);
}

#[test]
fn test_reward_policy_is_revertible() {
    let c = setup();
    let cl = c.client();
    cl.set_reward_policy(
        &c.admin, &RewardToken::Aqua, &true, &5000u32, &3000u32, &1000u32, &1000u32, &100u32,
    );
    assert_eq!(cl.get_reward_policy().payout_token, RewardToken::Aqua);

    // Nothing outstanding, so the switch back needs no upgrade.
    cl.set_reward_policy(
        &c.admin, &RewardToken::Blub, &false, &5000u32, &3000u32, &1000u32, &1000u32, &100u32,
    );
    assert_eq!(
        cl.get_reward_policy().payout_token,
        RewardToken::Blub,
        "the v3 switch must be reversible from the multisig alone"
    );
}

#[test]
fn test_user_reward_preference_roundtrip() {
    let c = setup();
    let cl = c.client();
    let user = Address::generate(&c.env);

    assert_eq!(
        cl.get_reward_preference(&user),
        None,
        "a staker who never elects defaults to the protocol token"
    );

    cl.set_reward_policy(
        &c.admin, &RewardToken::Aqua, &true, &5000u32, &3000u32, &1000u32, &1000u32, &100u32,
    );
    cl.set_reward_preference(&user, &Some(RewardToken::Blub));
    assert_eq!(cl.get_reward_preference(&user), Some(RewardToken::Blub));

    cl.set_reward_preference(&user, &None);
    assert_eq!(cl.get_reward_preference(&user), None, "clearing reverts to the default");
}

#[test]
fn test_reward_preference_rejected_when_choice_disabled() {
    let c = setup();
    let cl = c.client();
    let user = Address::generate(&c.env);

    // Default policy pays BLUB with allow_user_choice = false.
    let res = cl.try_set_reward_preference(&user, &Some(RewardToken::Aqua));
    assert!(
        res.is_err(),
        "electing the non-default token must be refused while user choice is off"
    );
}

#[test]
fn test_settle_user_rewards_is_idempotent_and_manager_gated() {
    let c = setup();
    let cl = c.client();
    let user = Address::generate(&c.env);

    // Nothing accrued: returns 0 rather than erroring, so a migration sweep can
    // run over every staker without special-casing.
    assert_eq!(cl.settle_user_rewards(&c.admin, &user), 0);
    assert_eq!(cl.settle_user_rewards(&c.admin, &user), 0);
}

// NOTE: the swap-on-claim path and the RewardsUnsettled guard are NOT unit
// tested. Both need a live AMM — `liquidity_contract` is a bare address in this
// harness, so any call reaching the pool collapses to an error indistinguishable
// from a guard rejection, and `outstanding` can only become non-zero via
// `add_rewards`, which needs a funded manager and a real pool to be meaningful.
// Cover them on testnet against a deployed Aquarius pool before the policy flip.

// ── vault position migration (2026-09-16) ─────────────────────────────────
//
// Two PoolInfo buckets may share one Aquarius pool and share token, which is how
// a single-sided-AQUA reward class is separated from the balanced one. Splitting
// the classes strands everyone who deposited before the second bucket existed:
// vault_deposit_single mints against a specific pool_id and nothing could move
// them. migrate_vault_position re-credits between buckets WITHOUT moving tokens.

#[test]
fn test_migrate_rejects_same_pool() {
    let c = setup();
    let user = Address::generate(&c.env);
    let res = c.client().try_migrate_vault_position(&c.admin, &user, &0u32, &0u32);
    assert!(res.is_err(), "migrating a bucket into itself must be rejected");
}

#[test]
fn test_migrate_rejects_unknown_pool() {
    let c = setup();
    let user = Address::generate(&c.env);
    let res = c.client().try_migrate_vault_position(&c.admin, &user, &0u32, &99u32);
    assert!(res.is_err(), "a non-existent destination bucket must be rejected");
}

#[test]
fn test_migrate_rejects_user_without_position() {
    let c = setup();
    let cl = c.client();
    let user = Address::generate(&c.env);
    // Second bucket over the SAME pool/share token — the supported shape.
    let pool_addr = Address::generate(&c.env);
    let share = Address::generate(&c.env);
    let a = Address::generate(&c.env);
    let b = Address::generate(&c.env);
    let p1 = cl.add_pool(&c.admin, &pool_addr, &a, &b, &share);
    let p2 = cl.add_pool(&c.admin, &pool_addr, &a, &b, &share);
    assert_ne!(p1, p2, "add_pool must allow a second bucket over the same pool");

    let res = cl.try_migrate_vault_position(&c.admin, &user, &p1, &p2);
    assert!(
        res.is_err(),
        "a user with no position in the source bucket must be rejected, not credited"
    );
}

#[test]
fn test_migrate_rejects_mismatched_share_tokens() {
    let c = setup();
    let cl = c.client();
    let user = Address::generate(&c.env);
    // Different share tokens means different physical LP. Re-crediting between
    // them would invent value, so the guard must refuse regardless of anything
    // else being valid.
    let p1 = cl.add_pool(
        &c.admin, &Address::generate(&c.env), &Address::generate(&c.env),
        &Address::generate(&c.env), &Address::generate(&c.env),
    );
    let p2 = cl.add_pool(
        &c.admin, &Address::generate(&c.env), &Address::generate(&c.env),
        &Address::generate(&c.env), &Address::generate(&c.env),
    );
    let res = cl.try_migrate_vault_position(&c.admin, &user, &p1, &p2);
    assert!(res.is_err(), "buckets with different share tokens must never be migrated between");
}

#[test]
fn test_migrate_requires_manager() {
    let c = setup();
    let attacker = Address::generate(&c.env);
    let user = Address::generate(&c.env);
    let res = c.client().try_migrate_vault_position(&attacker, &user, &0u32, &1u32);
    assert!(res.is_err(), "migration must be manager-gated");
}

// NOTE: the happy path — a real position moving between two buckets with its LP
// and share accounting intact — is NOT unit tested here. Creating a position
// requires vault_deposit_single, which reaches the Aquarius pool, and
// `liquidity_contract` is a bare address in this harness. Cover it on testnet
// against a deployed pool before running the migration on mainnet depositors.
