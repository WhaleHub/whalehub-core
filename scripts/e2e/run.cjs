#!/usr/bin/env node
'use strict';
/**
 * WhaleHub daily end-to-end smoke suite.
 *
 * Runs read-only checks against live mainnet and the deployed sites, then posts
 * a summary to Telegram. Nothing is ever signed or submitted.
 *
 *   node scripts/e2e/run.cjs              # run everything, print, send if configured
 *   node scripts/e2e/run.cjs --no-telegram
 *   node scripts/e2e/run.cjs --only=infra,invariants
 *
 * Exit code is 1 when any check fails, so CI goes red as well as notifying.
 * See scripts/e2e/README.md for the Telegram setup.
 */
const { Report } = require('./lib/report.cjs');
const { sendTelegram } = require('./lib/telegram.cjs');
const { activeRpc } = require('./lib/chain.cjs');

const CHECKS = {
  infra: require('./checks/infra.cjs'),
  reads: require('./checks/reads.cjs'),
  writes: require('./checks/writes.cjs'),
  invariants: require('./checks/invariants.cjs'),
};

function parseArgs(argv) {
  const opts = { telegram: true, only: null, silent: false };
  for (const a of argv.slice(2)) {
    if (a === '--no-telegram') opts.telegram = false;
    else if (a === '--silent') opts.silent = true;
    else if (a.startsWith('--only=')) opts.only = a.slice(7).split(',').map((s) => s.trim());
  }
  return opts;
}

(async () => {
  const opts = parseArgs(process.argv);
  const report = new Report();

  const names = opts.only || Object.keys(CHECKS);
  for (const name of names) {
    const fn = CHECKS[name];
    if (!fn) {
      console.error(`unknown check group: ${name}`);
      process.exitCode = 2;
      return;
    }
    try {
      await fn(report);
    } catch (e) {
      // A check group throwing is itself a failure worth reporting, not a
      // reason to lose the results collected so far.
      report.group(name);
      report.fail(`${name} suite crashed`, e && e.message ? e.message : String(e));
    }
  }

  console.log(report.toText());
  if (activeRpc()) console.log(`\nRPC used: ${activeRpc()}`);

  if (opts.telegram) {
    const msg = report.toTelegram({
      runUrl:
        process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
          ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
          : null,
      sha: process.env.GITHUB_SHA || null,
    });
    // Quiet notification on a clean run; failures ping properly.
    const res = await sendTelegram(msg, { silent: opts.silent || !report.failed });
    console.log(res.sent ? '\nTelegram: sent' : `\nTelegram: not sent — ${res.reason}`);
  }

  process.exitCode = report.failed ? 1 : 0;
})().catch((e) => {
  console.error('E2E runner crashed:', e);
  process.exitCode = 1;
});
