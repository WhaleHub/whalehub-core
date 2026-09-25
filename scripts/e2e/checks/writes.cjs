'use strict';
/**
 * The user-facing state-changing calls, SIMULATED ONLY.
 *
 * Nothing here is ever signed or submitted — `simulate()` has no path to it.
 * What this proves is that each entry point still assembles, authorises and
 * runs to completion against live mainnet state, which is the thing that breaks
 * silently after a contract upgrade and only surfaces as a failed deposit.
 *
 * A declared business error counts as healthy: `claim_rewards` answering
 * #29 ClaimCooldownActive means the contract is working. Only an undeclared
 * error, a host panic or a transport failure is a real failure.
 *
 * Deliberately NOT exercised: upgrade, transfer_admin, update_sac_admin,
 * withdraw_from_pool, admin_emergency_reset_rewards and the other multisig and
 * manager-only operations. Simulating them would be harmless, but a daily job
 * has no business pointing at them.
 */
const { xdr } = require('@stellar/stellar-sdk');
const { staking, arg, ACCOUNTS, CONTRACTS, HORIZON, AQUA_CLASSIC } = require('../lib/chain.cjs');

// Staking-contract codes (staking/src/lib.rs `pub enum Error`). Calls that move
// tokens can also surface the Stellar Asset Contract's own codes, which use a
// separate numbering — 10 BalanceError and 13 TrustlineMissing both mean "this
// subject can't fund the call", not "the contract is broken".
const ERR = {
  3: 'Unauthorized',
  4: 'InvalidInput',
  5: 'NotFound',
  6: 'InsufficientBalance',
  8: 'UnlockNotReady',
  20: 'ReentrancyDetected',
  22: 'NoUnlockableAmount',
  29: 'ClaimCooldownActive',
  30: 'UnstakeCooldownActive',
  31: 'NoRewardsToClaim',
  33: 'RewardsUnsettled',
  // Stellar Asset Contract codes (different namespace):
  10: 'SAC BalanceError',
  13: 'SAC TrustlineMissing',
};

/** Option::Some(RewardToken::Aqua) — a unit enum variant inside an Option. */
const someAqua = () => xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Aqua')]);

/**
 * Find an account holding AQUA so `lock` can be exercised past its balance
 * check. Public Horizon data, used read-only for simulation; set E2E_SUBJECT to
 * pin a specific account (e.g. a project test wallet) instead.
 */
async function findAquaHolder(minAqua = 100) {
  const res = await fetch(`${HORIZON}/accounts?asset=${AQUA_CLASSIC}&limit=20`);
  if (!res.ok) return null;
  const body = await res.json();
  for (const acct of body._embedded.records) {
    const bal = acct.balances.find((b) => b.asset_code === 'AQUA');
    if (bal && Number(bal.balance) >= minAqua) return acct.id;
  }
  return null;
}

function classify(report, label, r, tolerated) {
  if (r.ok) {
    report.pass(label, `simulated clean (auth ${r.authCount}, fee ${r.minResourceFee})`);
    return;
  }
  if (r.transport) {
    report.fail(label, r.error);
    return;
  }
  if (r.contractError != null && tolerated.includes(r.contractError)) {
    report.pass(label, `#${r.contractError} ${ERR[r.contractError] || ''} — expected, contract healthy`);
    return;
  }
  report.fail(
    label,
    r.contractError != null
      ? `#${r.contractError} ${ERR[r.contractError] || 'undeclared'} — unexpected`
      : r.error
  );
}

module.exports = async function writes(report) {
  report.group('contract writes (simulated)');

  const staker = process.env.E2E_SAMPLE_USER || ACCOUNTS.manager;

  // --- lock: the deposit path -----------------------------------------
  let subject = process.env.E2E_SUBJECT || null;
  if (!subject) {
    try {
      subject = await findAquaHolder();
    } catch (_) {
      /* fall through to the staker */
    }
  }
  if (subject) {
    const r = await staking(
      'lock',
      [arg.address(subject), arg.i128(100000000n), arg.u64(1)],
      { source: subject }
    );
    // With a funded subject this should simulate clean end to end.
    classify(report, 'lock(10 AQUA) — deposit path', r, [6, 10, 13]);
  } else {
    report.warn('lock — deposit path', 'no AQUA-funded subject found; set E2E_SUBJECT');
  }

  // --- stake: BLUB restake path ---------------------------------------
  {
    const r = await staking(
      'stake',
      [arg.address(staker), arg.i128(10000000n), arg.u64(1)],
      { source: staker }
    );
    classify(report, 'stake(1 BLUB) — restake path', r, [6, 10, 13]);
  }

  // --- unstake ---------------------------------------------------------
  {
    const r = await staking(
      'unstake',
      [arg.address(staker), arg.i128(10000000n)],
      { source: staker }
    );
    classify(report, 'unstake(1 BLUB)', r, [6, 8, 10, 13, 22, 30]);
  }

  // --- claim_rewards ---------------------------------------------------
  {
    const r = await staking('claim_rewards', [arg.address(staker)], { source: staker });
    classify(report, 'claim_rewards', r, [6, 10, 13, 29, 31, 33]);
  }

  // --- set_reward_preference ------------------------------------------
  {
    const r = await staking(
      'set_reward_preference',
      [arg.address(staker), someAqua()],
      { source: staker }
    );
    classify(report, 'set_reward_preference(Some(Aqua))', r, [4]);
  }

  // --- vault deposit / withdraw ----------------------------------------
  // vault_deposit_single(user, pool_id, token_in, amount_in, min_shares)
  {
    const r = await staking(
      'vault_deposit_single',
      [arg.address(staker), arg.u32(0), arg.address(CONTRACTS.aqua), arg.i128(10000000n), arg.u128(0n)],
      { source: staker }
    );
    // Pool 0 is de-whitelisted; PoolNotActive / InsufficientBalance are fine.
    classify(report, 'vault_deposit_single(pool 0)', r, [4, 6, 10, 13, 25, 26]);
  }

  // vault_withdraw_single(user, pool_id, share_percent, coin_index, min_amount)
  {
    const r = await staking(
      'vault_withdraw_single',
      [arg.address(staker), arg.u32(0), arg.u32(1), arg.u32(0), arg.u128(0n)],
      { source: staker }
    );
    classify(report, 'vault_withdraw_single(pool 0)', r, [4, 5, 6, 10, 13, 25, 26, 28]);
  }
};
