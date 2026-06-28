#![cfg(test)]

use super::*;
use soroban_sdk::testutils::Address as _;

fn new_addr(env: &Env) -> Address {
    Address::generate(env)
}

#[test]
fn test_initialize_and_config() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, LeverageVault);
    let client = LeverageVaultClient::new(&env, &contract_id);

    let admin = new_addr(&env);
    let zapper = new_addr(&env);
    let blend_pool = new_addr(&env);
    let amm_pool = new_addr(&env);
    let lp_token = new_addr(&env);
    let borrow_asset = new_addr(&env);
    let pair_token = new_addr(&env);

    client.initialize(
        &admin,
        &zapper,
        &blend_pool,
        &amm_pool,
        &lp_token,
        &borrow_asset,
        &pair_token,
        &0u32,
        &1u32,
        &30_000u32,
    );

    let config = client.get_config();
    assert_eq!(config.admin, admin);
    assert_eq!(config.blend_pool, blend_pool);
    assert_eq!(config.lp_token, lp_token);
    assert_eq!(config.borrow_idx, 0);
    assert_eq!(config.pair_idx, 1);
    assert_eq!(config.max_leverage_bps, 30_000);

    let (total_lp, total_debt) = client.get_totals();
    assert_eq!(total_lp, 0);
    assert_eq!(total_debt, 0);

    let pos = client.get_position(&new_addr(&env));
    assert_eq!(pos.collateral_lp, 0);
    assert_eq!(pos.debt, 0);
}

#[test]
#[should_panic]
fn test_double_initialize_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, LeverageVault);
    let client = LeverageVaultClient::new(&env, &contract_id);

    let a = new_addr(&env);
    client.initialize(
        &a, &a, &a, &a, &a, &a, &a, &0u32, &1u32, &30_000u32,
    );
    // second call must panic (AlreadyInitialized)
    client.initialize(
        &a, &a, &a, &a, &a, &a, &a, &0u32, &1u32, &30_000u32,
    );
}
