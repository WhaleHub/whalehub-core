'use strict';
/**
 * Protocol invariants — the properties that must hold for the protocol to be
 * solvent and operable. These are the checks worth waking someone for.
 */
const {
  staking,
  simulate,
  arg,
  CONTRACTS,
  tokenBalance,
  icelockedAqua,
} = require('../lib/chain.cjs');

const fmt = (n) =>
  Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });

module.exports = async function invariants(report) {
  report.group('invariants');

  // --- BLUB mint authority --------------------------------------------
  // lock() mints via StellarAssetClient::mint. If the SAC admin ever moves off
  // the staking contract, every deposit fails at the mint.
  {
    const r = await simulate(CONTRACTS.blub, 'admin', []);
    if (!r.ok) {
      report.fail('BLUB SAC admin readable', r.error);
    } else {
      report.check(
        r.value === CONTRACTS.staking,
        'BLUB SAC admin is the staking contract',
        r.value === CONTRACTS.staking ? 'correct' : `is ${r.value} — deposits will fail`
      );
    }
  }

  // --- Vault solvency ---------------------------------------------------
  // vault_withdraw burns real pool-0 LP, so the contract's LP balance must
  // cover every vault user's claim or redemptions revert.
  {
    const poolInfo = await staking('get_pool_info', [arg.u32(0)]);
    const shareToken = await staking('get_pool_share_token', []);
    if (!poolInfo.ok || !shareToken.ok) {
      report.warn('vault solvency', 'could not read pool 0 info / share token');
    } else {
      const vaultLp = BigInt(poolInfo.value.total_lp_tokens ?? 0);
      const held = await simulate(String(shareToken.value), 'balance', [
        arg.address(CONTRACTS.staking),
      ]);
      if (!held.ok) {
        report.warn('vault solvency', `share-token balance unreadable: ${held.error}`);
      } else {
        const contractLp = BigInt(held.value ?? 0);
        const ok = contractLp >= vaultLp;
        report.check(
          ok,
          'contract pool-0 LP ≥ vault user claims',
          ok
            ? `${fmt(Number(contractLp) / 1e7)} LP held vs ${fmt(Number(vaultLp) / 1e7)} claimed`
            : `SHORT by ${fmt(Number(vaultLp - contractLp) / 1e7)} LP — redemptions will revert`
        );
        report.metric('POL surplus (LP)', fmt(Number(contractLp - vaultLp) / 1e7));
      }
    }
  }

  // --- Reward policy ----------------------------------------------------
  {
    const r = await staking('get_reward_policy', []);
    if (!r.ok) {
      report.fail('reward policy readable', r.error);
    } else {
      const p = r.value;
      const sum =
        Number(p.staker_bps) + Number(p.lp_bps) + Number(p.pol_bps) + Number(p.treasury_bps);
      report.check(sum === 10000, 'reward split sums to 10000 bps', `${sum} bps`);
      const token = Array.isArray(p.payout_token) ? p.payout_token[0] : p.payout_token;
      report.metric('reward payout token', String(token));
      report.metric(
        'reward split',
        `staker ${p.staker_bps} / lp ${p.lp_bps} / pol ${p.pol_bps} / treasury ${p.treasury_bps}`
      );
    }
  }

  // --- Reentrancy guard not stuck ---------------------------------------
  // `locked` is cleared at the end of every call. Finding it true between runs
  // means a call aborted mid-flight and every subsequent write will revert.
  {
    const r = await staking('get_global_state', []);
    if (!r.ok) {
      report.fail('global state readable', r.error);
    } else {
      const g = r.value;
      report.check(
        g.locked === false,
        'reentrancy guard is clear',
        g.locked ? 'STUCK — all writes will revert with #20' : 'clear'
      );
      report.metric('total_blub_supply (counter)', fmt(Number(g.total_blub_supply) / 1e7));
      report.metric('pending_aqua_for_ice', fmt(Number(g.pending_aqua_for_ice) / 1e7));
      report.metric('ice_lock_counter', String(g.ice_lock_counter));
    }
  }

  // --- Contract token balances -------------------------------------------
  {
    const blub = await tokenBalance(CONTRACTS.blub, CONTRACTS.staking);
    const aqua = await tokenBalance(CONTRACTS.aqua, CONTRACTS.staking);
    if (blub == null || aqua == null) {
      report.warn('contract balances', 'token balance unreadable');
    } else {
      report.metric('contract BLUB', fmt(blub));
      report.metric('contract AQUA', fmt(aqua));
      // A contract holding no BLUB cannot pay a single unstake.
      report.check(blub > 0, 'contract holds BLUB for redemptions', `${fmt(blub)} BLUB`);
    }
  }

  // --- ICE-locked AQUA ---------------------------------------------------
  // The real locked position, and what DefiLlama publishes as TVL.
  {
    try {
      const { total, count } = await icelockedAqua();
      report.check(
        total > 0,
        'ICE-locked AQUA present',
        `${fmt(total)} AQUA across ${count} claimable balances`
      );
      report.metric('ICE-locked AQUA', fmt(total));
      report.metric('ICE claimable balances', String(count));
    } catch (e) {
      report.fail('ICE-locked AQUA present', e.message);
    }
  }

  // --- Version -----------------------------------------------------------
  {
    const r = await staking('get_version', []);
    if (r.ok) report.metric('contract version', String(r.value));
  }
};
