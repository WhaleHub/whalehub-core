#!/usr/bin/env node
/**
 * Publishes website-redesign/apy.json with the SAME "Current APY" the dApp shows
 * at app.whalehub.io/stake/aqua.
 *
 * The dApp reads GET /public/staking-apy?window_days=7 and renders that value,
 * falling back to a fixed steady-state rate when the indexer has no events in the
 * window (see src/hooks/useStakingApy.ts + STKAqua.tsx, which calls it with 7).
 * We read the exact same endpoint here, so the website always matches the dApp
 * without a headless browser (no Puppeteer/Chromium, no DOM-scrape races).
 *
 * Run hourly by .github/workflows/live-apy.yml.
 * Local run:  node scripts/fetch-live-apy.cjs
 */
const fs = require('fs');
const path = require('path');

const API =
  process.env.STAKING_APY_URL ||
  'https://whalehub-server-28ipy.ondigitalocean.app/public/staking-apy';
// Must match the window STKAqua passes to useStakingApy (currently 7).
const WINDOW_DAYS = process.env.STAKING_APY_WINDOW_DAYS || '7';
// Must match FALLBACK_APY in src/hooks/useStakingApy.ts.
const FALLBACK_APY = '17.88';
// TEMP (2026-08-21) — mirrors the same-named guard in src/hooks/useStakingApy.ts.
// The Aug 17-20 distributions failed on the contract's 100,000 BLUB add_rewards
// cap, so the indexer window holds a single small catch-up event that annualises
// to ~2%. While that is the only event, publish the last real distribution
// (22,618.03 BLUB on 2026-08-21T00:01Z over 57,621,942 staked = 14.33%).
// Expires on its own; delete both copies once a normal day is indexed.
const TEMP_APY = '14.33';
const TEMP_APY_UNTIL = Date.parse('2026-08-23T00:00:00Z');
const OUT = path.join(__dirname, '..', 'website-redesign', 'apy.json');

(async () => {
  const url = `${API}?window_days=${WINDOW_DAYS}`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`staking-apy HTTP ${res.status}`);
  const data = await res.json();

  // Reproduce the dApp's exact logic: use the indexer value only when the window
  // actually has events, otherwise show the fallback (never "--", never 0).
  const hasEvents = data && data.apy && data.apy !== '--' && Number(data.eventCount) > 0;
  const thinWindow =
    hasEvents && Number(data.eventCount) <= 1 && Date.now() < TEMP_APY_UNTIL;

  let raw = FALLBACK_APY;
  let source = 'fallback';
  if (thinWindow) {
    raw = TEMP_APY;
    source = 'last real distribution';
  } else if (hasEvents) {
    raw = data.apy;
    source = 'staking-apy indexer';
  }
  const apy = parseFloat(raw);
  if (isNaN(apy)) throw new Error(`unparseable apy: ${raw}`);

  const payload = {
    apy: apy.toFixed(2),
    updated: new Date().toISOString(),
    source,
  };
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n');
  console.log('live APY ->', payload);
})().catch((e) => {
  // Never break the site — keep the previous apy.json.
  console.warn('live-apy: keeping previous value -', e.message || e);
  process.exit(0);
});
