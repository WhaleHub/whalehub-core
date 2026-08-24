import { describe, it, expect } from "vitest";
import { deriveReferenceMid } from "../src/pricing/referenceEngine.js";
import { mkConfig } from "./helpers.js";

const cfg = mkConfig({ priceFloor: "0.3", priceCeiling: "1.0", pegCeiling: "1.0", refQuoteSizeBlub: "100000" });

const base = {
  reserveBlub: 18_049_740,
  reserveAqua: 378_844,
  ammApiPrice: null as number | null,
  sdexBestBid: 0.51,
  sdexBestAsk: 0.92,
  sdexBidDepthBlub: 900_000,
};

describe("referenceEngine", () => {
  it("derives an in-band sub-peg mid from the pool", () => {
    const r = deriveReferenceMid(cfg, base);
    expect(r.ok).toBe(true);
    expect(r.mid!).toBeGreaterThan(cfg.priceFloor);
    expect(r.mid!).toBeLessThanOrEqual(cfg.pegCeiling);
  });

  it("trips (ok=false) when no primary source is available", () => {
    const r = deriveReferenceMid(cfg, { ...base, reserveBlub: null, reserveAqua: null, ammApiPrice: null });
    expect(r.ok).toBe(false);
    expect(r.mid).toBeNull();
  });

  it("caps the mid at the peg ceiling", () => {
    // Balanced reserves → pool price ~1.0; ceiling must hold at 1.0.
    const r = deriveReferenceMid(cfg, { ...base, reserveBlub: 1_000_000, reserveAqua: 1_000_000 });
    expect(r.ok).toBe(true);
    expect(r.mid!).toBeLessThanOrEqual(1.0);
  });

  it("falls back to amm-api when the pool read is missing", () => {
    const r = deriveReferenceMid(cfg, { ...base, reserveBlub: null, reserveAqua: null, ammApiPrice: 0.62 });
    expect(r.ok).toBe(true);
    expect(r.mid!).toBeCloseTo(0.62, 5);
  });

  it("trips when the reference is wildly out of band", () => {
    const r = deriveReferenceMid(cfg, { ...base, reserveBlub: null, reserveAqua: null, ammApiPrice: 5.0 });
    expect(r.ok).toBe(false);
  });

  it("records divergence when pool and amm-api disagree", () => {
    const r = deriveReferenceMid(cfg, { ...base, ammApiPrice: 0.40 });
    expect(r.sources.divergenceBps).toBeDefined();
  });
});
