import { describe, it, expect } from "vitest";
import { computeInventorySkew } from "../src/strategy/inventorySkew.js";
import { mkConfig } from "./helpers.js";

const cfg = mkConfig({ targetBlubFraction: "0.5", skewFactor: "1.0", maxSkewBps: "150" });
const mid = 0.8;

describe("inventorySkew", () => {
  it("is zero with no inventory", () => {
    expect(computeInventorySkew({ blub: 0, aqua: 0, xlm: 0 }, mid, cfg)).toBe(0);
  });

  it("is positive when long BLUB (shifts quotes down to shed BLUB)", () => {
    const skew = computeInventorySkew({ blub: 1_000_000, aqua: 1, xlm: 0 }, mid, cfg);
    expect(skew).toBeGreaterThan(0);
  });

  it("is negative when short BLUB", () => {
    const skew = computeInventorySkew({ blub: 1, aqua: 1_000_000, xlm: 0 }, mid, cfg);
    expect(skew).toBeLessThan(0);
  });

  it("is capped at maxSkewBps", () => {
    const skew = computeInventorySkew({ blub: 10_000_000, aqua: 0, xlm: 0 }, mid, cfg);
    expect(skew).toBeLessThanOrEqual(0.015 + 1e-9); // 150 bps
  });
});
