import { describe, it, expect } from "vitest";
import { createLogger } from "../src/obs/logger.js";
import { HorizonClient } from "../src/stellar/horizonClient.js";
import { SorobanClient } from "../src/stellar/sorobanClient.js";
import { deriveReferenceMid } from "../src/pricing/referenceEngine.js";
import { MarketMaker } from "../src/strategy/marketMaker.js";
import { mkConfig } from "./helpers.js";

/**
 * Read-only smoke test against LIVE mainnet endpoints. Places nothing.
 * Gated: run with `RUN_INTEGRATION=1 npm run test:integration`.
 */
const run = process.env.RUN_INTEGRATION ? describe : describe.skip;

run("smoke (live, read-only)", () => {
  const log = createLogger("silent");
  const cfg = mkConfig();

  it("derives an in-band mid and a valid non-crossing ladder", async () => {
    const horizon = new HorizonClient(cfg.horizonUrl, log);
    const soroban = new SorobanClient(cfg.sorobanRpcUrl, cfg.network, log);

    const [reserves, poolParams, poolQuote, book] = await Promise.all([
      soroban.getPoolReserves(),
      soroban.getPoolParams(),
      soroban.estimateSellPriceBlubToAqua(cfg.refQuoteSizeBlub),
      horizon.orderBookTop(),
    ]);
    expect(reserves).not.toBeNull();
    // The pool's own quote must be readable, and our local math must agree with
    // it closely — this is what proves the amplification convention is right.
    expect(poolQuote).not.toBeNull();
    expect(poolParams).not.toBeNull();

    const ref = deriveReferenceMid(cfg, {
      poolQuote,
      reserveBlub: reserves?.reserveBlub ?? null,
      reserveAqua: reserves?.reserveAqua ?? null,
      poolParams,
      ammApiPrice: null,
      sdexBestBid: book.bestBid,
      sdexBestAsk: book.bestAsk,
      sdexBidDepthBlub: book.bidDepthBlub,
    });
    expect(ref.ok).toBe(true);
    // Local StableSwap math vs the contract's own quote, at live reserves.
    const driftBps = Math.abs(ref.sources.poolExec! / poolQuote! - 1) * 10_000;
    expect(driftBps).toBeLessThan(5);
    expect(ref.mid!).toBeGreaterThan(cfg.priceFloor);
    expect(ref.mid!).toBeLessThanOrEqual(cfg.pegCeiling);

    const mm = new MarketMaker(cfg, { enforceInventory: false });
    const offers = mm.computeDesired({ mid: ref.mid!, inventory: { blub: 0, aqua: 0, xlm: 0 } });
    const bids = offers.filter((o) => o.side === "bid").map((o) => o.price);
    const asks = offers.filter((o) => o.side === "ask").map((o) => o.price);
    if (bids.length && asks.length) {
      expect(Math.max(...bids)).toBeLessThan(Math.min(...asks));
    }
    for (const a of asks) expect(a).toBeLessThanOrEqual(cfg.pegCeiling + 1e-9);
  }, 60_000);
});
