'use strict';
/**
 * Every public getter on the staking contract, simulated against mainnet.
 *
 * The bar is "the contract answers without blowing up". A getter that starts
 * throwing after an upgrade is exactly the kind of silent breakage that reaches
 * users as a blank panel in the dApp, so each one is asserted individually
 * rather than through whichever few the UI happens to call.
 */
const { staking, arg, ACCOUNTS } = require('../lib/chain.cjs');

const USER = process.env.E2E_SAMPLE_USER || ACCOUNTS.manager;

// name → args. Kept in the contract's own declaration order so a new getter
// added to lib.rs is easy to slot in.
function getters() {
  return [
    ['get_version', []],
    ['get_config', []],
    ['get_global_state', []],
    ['get_manager_address', []],
    ['get_pool_count', []],
    ['get_reward_policy', []],
    ['get_reward_state_view', []],
    ['get_protocol_owned_liquidity', []],
    ['get_available_pol_balance', []],
    ['get_pending_aqua_for_ice', []],
    ['get_all_ice_balances', []],
    ['get_upvote_ice_balance', []],
    ['get_distribution_count', []],
    ['get_pending_stake_count', []],
    ['get_pool_reserves', []],
    ['get_pool_share_token', []],
    ['get_pool_virtual_price', []],
    ['get_pool_pending_rewards', []],

    // user-scoped
    ['get_user_staking_info', [arg.address(USER)]],
    ['get_user_lock_totals', [arg.address(USER)]],
    ['get_user_lock_count', [arg.address(USER)]],
    ['get_user_rewards', [arg.address(USER)]],
    ['get_user_pools', [arg.address(USER)]],
    ['get_user_pol_contribution', [arg.address(USER)]],
    ['get_user_reward_info', [arg.address(USER)]],
    ['get_pending_rewards', [arg.address(USER)]],
    ['get_reward_preference', [arg.address(USER)]],
    ['get_unlock_count', [arg.address(USER)]],
    ['get_blub_restake_count', [arg.address(USER)]],

    // indexed
    ['get_user_lock_by_index', [arg.address(USER), arg.u32(0)]],
    ['get_unstake_status', [arg.address(USER), arg.u32(0)]],
    ['get_ice_lock_authorization', [arg.u64(0)]],
    ['get_pool_info', [arg.u32(0)]],
    ['get_vault_total_shares', [arg.u32(0)]],
    ['get_pool_compound_stats', [arg.u32(0)]],
    ['get_user_vault_position', [arg.address(USER), arg.u32(0)]],
    ['get_user_compound_gains', [arg.address(USER), arg.u32(0)]],
  ];
}

// Getters allowed to answer with a declared error for an arbitrary subject —
// "this user has no entry at index 0" is a correct answer, not a fault.
const TOLERATED = {
  get_user_lock_by_index: [5],       // NotFound
  get_unstake_status: [5, 4],
  get_user_vault_position: [5, 28],  // NotFound / PositionNotFound
  get_user_compound_gains: [5, 28],
  get_unlock_by_index: [5],
  get_blub_restake_by_index: [5],
  get_distribution_by_index: [5],
  get_pending_stake: [5],
};

function preview(v) {
  if (v === null || v === undefined) return 'void';
  const s = JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? x.toString() : x));
  return s.length > 90 ? s.slice(0, 87) + '…' : s;
}

module.exports = async function reads(report) {
  report.group('contract reads');

  let covered = 0;
  for (const [method, args] of getters()) {
    const r = await staking(method, args);
    if (r.ok) {
      covered++;
      report.pass(method, preview(r.value));
      continue;
    }
    const tolerated = TOLERATED[method] || [];
    if (r.contractError != null && tolerated.includes(r.contractError)) {
      covered++;
      report.pass(method, `contract error #${r.contractError} (expected for sample subject)`);
      continue;
    }
    report.fail(method, r.error);
  }

  report.metric('getters covered', `${covered}/${getters().length}`);

  // Pool getters across every configured pool, not just pool 0.
  const pc = await staking('get_pool_count', []);
  if (pc.ok) {
    const n = Number(pc.value || 0);
    for (let id = 0; id < n; id++) {
      const info = await staking('get_pool_info', [arg.u32(id)]);
      if (info.ok) report.pass(`get_pool_info(${id})`, preview(info.value));
      else report.fail(`get_pool_info(${id})`, info.error);
    }
  }
};
