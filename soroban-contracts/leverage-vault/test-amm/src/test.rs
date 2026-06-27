#![cfg(test)]

use super::*;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::token::StellarAssetClient;

fn setup() -> (Env, TestAmmClient<'static>, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let t0 = env.register_stellar_asset_contract(admin.clone());
    let t1 = env.register_stellar_asset_contract(admin.clone());

    let amm_id = env.register_contract(None, TestAmm);
    let amm = TestAmmClient::new(&env, &amm_id);
    amm.initialize(&t0, &t1);

    (env, amm, t0, t1, admin)
}

#[test]
fn test_deposit_swap_withdraw() {
    let (env, amm, t0, t1, _admin) = setup();
    let user = Address::generate(&env);

    let sac0 = StellarAssetClient::new(&env, &t0);
    let sac1 = StellarAssetClient::new(&env, &t1);
    sac0.mint(&user, &1_000_0000000);
    sac1.mint(&user, &1_000_0000000);

    // user approves the AMM to pull underlying
    let amm_addr = amm.address.clone();
    let exp = env.ledger().sequence() + 1000;
    token::TokenClient::new(&env, &t0).approve(&user, &amm_addr, &1_000_0000000, &exp);
    token::TokenClient::new(&env, &t1).approve(&user, &amm_addr, &1_000_0000000, &exp);

    // initial deposit 100 / 100
    let desired = Vec::from_array(&env, [100_0000000u128, 100_0000000u128]);
    let (_used, shares) = amm.deposit(&user, &desired, &0u128);
    assert!(shares > 0);
    assert_eq!(amm.balance(&user), shares as i128);

    let reserves = amm.get_reserves();
    assert_eq!(reserves.get(0).unwrap(), 100_0000000);
    assert_eq!(reserves.get(1).unwrap(), 100_0000000);

    // swap 10 of token0 -> token1
    let out = amm.swap(&user, &0u32, &1u32, &10_0000000u128, &0u128);
    assert!(out > 0 && out < 10_0000000); // fee + slippage
    let after = amm.get_reserves();
    assert_eq!(after.get(0).unwrap(), 110_0000000);
    assert_eq!(after.get(1).unwrap(), 100_0000000 - out);

    // withdraw half the shares
    let half = (shares / 2) as u128;
    let min = Vec::from_array(&env, [0u128, 0u128]);
    let got = amm.withdraw(&user, &half, &min);
    assert!(got.get(0).unwrap() > 0);
    assert!(got.get(1).unwrap() > 0);
    assert_eq!(amm.get_total_shares(), (shares as u128) - half);
}

#[test]
fn test_transfer_from_lp() {
    let (env, amm, t0, t1, _admin) = setup();
    let user = Address::generate(&env);
    let spender = Address::generate(&env);
    let recipient = Address::generate(&env);

    let sac0 = StellarAssetClient::new(&env, &t0);
    let sac1 = StellarAssetClient::new(&env, &t1);
    sac0.mint(&user, &1_000_0000000);
    sac1.mint(&user, &1_000_0000000);
    let amm_addr = amm.address.clone();
    let exp = env.ledger().sequence() + 1000;
    token::TokenClient::new(&env, &t0).approve(&user, &amm_addr, &1_000_0000000, &exp);
    token::TokenClient::new(&env, &t1).approve(&user, &amm_addr, &1_000_0000000, &exp);
    let desired = Vec::from_array(&env, [100_0000000u128, 100_0000000u128]);
    let (_u, shares) = amm.deposit(&user, &desired, &0u128);

    // user approves spender to move LP, spender transfers to recipient (Blend-style pull)
    amm.approve(&user, &spender, &(shares as i128), &exp);
    assert_eq!(amm.allowance(&user, &spender), shares as i128);
    amm.transfer_from(&spender, &user, &recipient, &(shares as i128));
    assert_eq!(amm.balance(&recipient), shares as i128);
    assert_eq!(amm.balance(&user), 0);
}
