import { describe, it, expect } from "vitest";
import { MarketMaker } from "../src/strategy/marketMaker.js";
import { mkConfig } from "./helpers.js";

const cfg = mkConfig({
  halfSpreadBps: "50",
  ladderLevels: "3",
  levelStepBps: "40",
  orderSizeBlub: "10000",
  maxExposureBlub: "100000",
  maxExposureAqua: "100000",
  priceFloor: "0.3",
  pegCeiling: "1.0",
  priceCeiling: "1.0",
});

const noInv = { blub: 0, aqua: 0, xlm: 0 };

describe("MarketMaker", () => {
  it("produces a non-crossing two-sided ladder", () => {
    const mm = new MarketMaker(cfg, { enforceInventory: false });
    const offers = mm.computeDesired({ mid: 0.8, inventory: noInv });
    const bids = offers.filter((o) => o.side === "bid");
    const asks = offers.filter((o) => o.side === "ask");
    expect(bids.length).toBe(3);
    expect(asks.length).toBe(3);
    const bestBid = Math.max(...bids.map((b) => b.price));
    const bestAsk = Math.min(...asks.map((a) => a.price));
    expect(bestBid).toBeLessThan(bestAsk);
  });

  it("caps asks at the peg ceiling", () => {
    const mm = new MarketMaker(cfg, { enforceInventory: false });
    const offers = mm.computeDesired({ mid: 1.0, inventory: noInv });
    for (const a of offers.filter((o) => o.side === "ask")) {
      expect(a.price).toBeLessThanOrEqual(1.0 + 1e-9);
    }
  });

  it("truncates the ask ladder at the BLUB exposure cap", () => {
    const capped = mkConfig({ ...envOf(cfg), maxExposureBlub: "15000" });
    const mm = new MarketMaker(capped, { enforceInventory: false });
    const asks = mm.computeDesired({ mid: 0.8, inventory: noInv }).filter((o) => o.side === "ask");
    const total = asks.reduce((s, a) => s + a.amount, 0);
    expect(total).toBeLessThanOrEqual(15000 + 1e-6);
  });

  it("respects on-chain inventory when enforceInventory=true", () => {
    const mm = new MarketMaker(cfg, { enforceInventory: true });
    const asks = mm
      .computeDesired({ mid: 0.8, inventory: { blub: 5000, aqua: 100000, xlm: 50 } })
      .filter((o) => o.side === "ask");
    const total = asks.reduce((s, a) => s + a.amount, 0);
    expect(total).toBeLessThanOrEqual(5000 + 1e-6);
  });

  it("returns nothing for an invalid mid", () => {
    const mm = new MarketMaker(cfg, { enforceInventory: false });
    expect(mm.computeDesired({ mid: 0, inventory: noInv })).toEqual([]);
  });
});

// Re-derive an env-style override object from an existing config for tweaks.
function envOf(c: ReturnType<typeof mkConfig>): Record<string, string> {
  return {
    halfSpreadBps: String(c.halfSpreadBps),
    ladderLevels: String(c.ladderLevels),
    levelStepBps: String(c.levelStepBps),
    orderSizeBlub: String(c.orderSizeBlub),
    maxExposureAqua: String(c.maxExposureAqua),
    priceFloor: String(c.priceFloor),
    pegCeiling: String(c.pegCeiling),
    priceCeiling: String(c.priceCeiling),
  };
}
