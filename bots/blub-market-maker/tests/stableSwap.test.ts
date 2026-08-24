import { describe, it, expect } from "vitest";
import { computeD, executableSellPrice, marginalPrice } from "../src/pricing/stableSwap.js";

const A = 1500;

describe("stableSwap", () => {
  it("prices ~1.0 at balance (convention-independent)", () => {
    const p = marginalPrice(1_000_000, 1_000_000, A);
    expect(p).toBeGreaterThan(0.999);
    expect(p).toBeLessThan(1.001);
  });

  it("computeD returns ~sum at balance", () => {
    const d = computeD(1_000_000, 1_000_000, A);
    expect(d).toBeGreaterThan(1_900_000);
    expect(d).toBeLessThan(2_100_000);
  });

  it("prices BLUB below 1.0 when the pool is BLUB-heavy (sub-peg)", () => {
    // Real-ish reserves: ~18M BLUB vs ~379k AQUA
    const p = executableSellPrice(18_049_740, 378_844, 100_000, A, 0.0005);
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(1.0);
  });

  it("shows price impact: larger sells get worse average price", () => {
    const small = executableSellPrice(18_049_740, 378_844, 1_000, A, 0.0005);
    const large = executableSellPrice(18_049_740, 378_844, 500_000, A, 0.0005);
    expect(large).toBeLessThan(small);
  });

  it("fee reduces output", () => {
    const noFee = executableSellPrice(1_000_000, 1_000_000, 10_000, A, 0);
    const withFee = executableSellPrice(1_000_000, 1_000_000, 10_000, A, 0.0005);
    expect(withFee).toBeLessThan(noFee);
  });
});
