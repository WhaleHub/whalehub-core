#!/usr/bin/env node
/**
 * Reads the LIVE "Current APY" the dApp itself renders at app.whalehub.io/stake/aqua
 * (the value is in the public DOM — no wallet needed) and writes website-redesign/apy.json.
 *
 * This is formula-agnostic: the website always shows exactly what the dApp shows, even as
 * the on-chain APY math evolves. Run hourly by .github/workflows/live-apy.yml.
 *
 * Local run:  PUPPETEER_EXECUTABLE_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe" node scripts/fetch-live-apy.cjs
 * CI:         `npm i puppeteer` provides a bundled Chromium automatically.
 */
const fs = require('fs');
const path = require('path');

const URL = process.env.DAPP_URL || 'https://app.whalehub.io/stake/aqua';
const OUT = path.join(__dirname, '..', 'website-redesign', 'apy.json');

let puppeteer;
try { puppeteer = require('puppeteer'); }
catch { puppeteer = require('puppeteer-core'); }

(async () => {
  const launchOpts = { headless: 'new', args: ['--no-sandbox', '--disable-gpu'] };
  if (process.env.PUPPETEER_EXECUTABLE_PATH) launchOpts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;

  const browser = await puppeteer.launch(launchOpts);
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });

  // Wait until "Current APY … NN.NN%" is rendered (on-chain read resolves client-side).
  await page.waitForFunction(
    () => /Current APY[\s\S]{0,40}?\d+(?:\.\d+)?\s*%/.test(document.body.innerText),
    { timeout: 45000 }
  );

  const apy = await page.evaluate(() => {
    const m = document.body.innerText.match(/Current APY[\s\S]{0,40}?([\d,]+(?:\.\d+)?)\s*%/);
    return m ? m[1].replace(/,/g, '') : null;
  });
  await browser.close();

  if (!apy || isNaN(parseFloat(apy))) throw new Error('could not read Current APY from dApp');

  const payload = { apy: parseFloat(apy).toFixed(2), updated: new Date().toISOString(), source: 'app.whalehub.io' };
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n');
  console.log('live APY ->', payload);
})().catch((e) => {
  // Never break the site — keep the previous apy.json.
  console.warn('live-apy: keeping previous value —', e.message || e);
  process.exit(0);
});
