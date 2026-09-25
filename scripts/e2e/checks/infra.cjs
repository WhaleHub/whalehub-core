'use strict';
/**
 * Infrastructure: the things that make the dApp unusable when they break, and
 * which nothing else in the stack alarms on.
 */
const { PRIMARY_RPC, FALLBACK_RPC, HORIZON, ACCOUNTS } = require('../lib/chain.cjs');

const APP = process.env.E2E_APP_URL || 'https://app.whalehub.io';
const SITE = process.env.E2E_SITE_URL || 'https://whalehub.io';
const BACKEND =
  process.env.E2E_BACKEND_URL || 'https://whalehub-server-28ipy.ondigitalocean.app';

async function timed(fn) {
  const t = Date.now();
  const r = await fn();
  return { r, ms: Date.now() - t };
}

async function rpcHealth(url) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  if (!body.result || body.result.status !== 'healthy') {
    throw new Error(`status=${body.result && body.result.status}`);
  }
  return body.result;
}

module.exports = async function infra(report) {
  report.group('infrastructure');

  // --- Soroban RPC -----------------------------------------------------
  for (const [label, url] of [['primary', PRIMARY_RPC], ['fallback', FALLBACK_RPC]]) {
    try {
      const { r, ms } = await timed(() => rpcHealth(url));
      report.pass(`Soroban RPC ${label} healthy`, `ledger ${r.latestLedger}, ${ms}ms`);
    } catch (e) {
      // The dApp survives losing one endpoint, so the primary going down is a
      // warning; both down is caught by every other check failing.
      report.warn(`Soroban RPC ${label} unhealthy`, e.message);
    }
  }

  // --- Horizon ---------------------------------------------------------
  try {
    const res = await fetch(`${HORIZON}/`);
    report.check(res.ok, 'Horizon reachable', `HTTP ${res.status}`);
  } catch (e) {
    report.fail('Horizon reachable', e.message);
  }

  // --- dApp ------------------------------------------------------------
  try {
    const res = await fetch(APP, { redirect: 'follow' });
    const html = await res.text();
    report.check(res.ok, 'dApp responds', `HTTP ${res.status}`);
    const bundle = (html.match(/src="(\/static\/js\/main\.[^"]+)"/) || [])[1];
    if (!bundle) {
      report.fail('dApp bundle referenced', 'no main.*.js in index.html');
    } else {
      const b = await fetch(`${APP}${bundle}`);
      report.check(b.ok, 'dApp bundle loads', `${bundle} → HTTP ${b.status}`);
      report.metric('dApp bundle', bundle.replace('/static/js/', ''));
    }
  } catch (e) {
    report.fail('dApp responds', e.message);
  }

  // --- Marketing site + SEP-1 toml -------------------------------------
  try {
    const res = await fetch(SITE, { redirect: 'follow' });
    report.check(res.ok, 'whalehub.io responds', `HTTP ${res.status}`);
  } catch (e) {
    report.fail('whalehub.io responds', e.message);
  }

  // Wallets resolve BLUB through home_domain → this file. If it 404s or loses
  // its headers, BLUB shows as "?" in wallets and explorers.
  try {
    const res = await fetch(`${SITE}/.well-known/stellar.toml`);
    const text = res.ok ? await res.text() : '';
    report.check(res.ok, 'stellar.toml served', `HTTP ${res.status}`);
    if (res.ok) {
      const ct = res.headers.get('content-type') || '';
      const cors = res.headers.get('access-control-allow-origin') || '';
      report.check(ct.includes('text/plain'), 'stellar.toml content-type', ct || '(none)');
      report.check(cors === '*', 'stellar.toml CORS', cors || '(none)');
      report.check(/\bBLUB\b/.test(text), 'stellar.toml lists BLUB', `${text.length} bytes`);
    }
  } catch (e) {
    report.fail('stellar.toml served', e.message);
  }

  // --- BLUB issuer home_domain -----------------------------------------
  // Documented recurring regression: signing from this account in the LOBSTR
  // app silently appends a set_options that flips home_domain to lobstr.co.
  try {
    const res = await fetch(`${HORIZON}/accounts/${ACCOUNTS.manager}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const acct = await res.json();
    const hd = acct.home_domain || '(unset)';
    report.check(
      hd === 'whalehub.io',
      'BLUB issuer home_domain is whalehub.io',
      hd === 'whalehub.io' ? hd : `is "${hd}" — wallets will mis-resolve BLUB`
    );
  } catch (e) {
    report.fail('BLUB issuer home_domain is whalehub.io', e.message);
  }

  // --- Backend ---------------------------------------------------------
  try {
    const { r, ms } = await timed(() => fetch(`${BACKEND}/test/health`));
    report.check(r.ok, 'backend health', `HTTP ${r.status}, ${ms}ms`);
  } catch (e) {
    report.warn('backend health', e.message);
  }

  try {
    const res = await fetch(`${BACKEND}/public/staking-apy?window_days=7`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    report.pass('staking-apy endpoint', `apy=${data.apy} events=${data.eventCount}`);
    report.metric('staking APY (7d)', String(data.apy));
  } catch (e) {
    report.warn('staking-apy endpoint', e.message);
  }
};
