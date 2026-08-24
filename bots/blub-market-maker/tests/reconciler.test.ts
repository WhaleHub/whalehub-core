import { describe, it, expect } from "vitest";
import { reconcile, buildCacheFromMatch, offerKey } from "../src/execution/reconciler.js";
import type { DesiredOffer, LiveOffer } from "../src/strategy/types.js";
import { mkConfig } from "./helpers.js";

const cfg = mkConfig({ minRepriceBps: "20", minResizePct: "0.10" });

const desired: DesiredOffer[] = [{ side: "bid", level: 0, price: 0.8, amount: 100 }];

describe("reconciler", () => {
  it("creates when nothing is cached", () => {
    const actions = reconcile(desired, [], new Map(), cfg);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.type).toBe("create");
  });

  it("leaves matching offers untouched (within tolerance)", () => {
    const live: LiveOffer[] = [{ id: "11", side: "bid", price: 0.8, amount: 100 }];
    const cache = new Map([[offerKey("bid", 0), "11"]]);
    const actions = reconcile(desired, live, cache, cfg);
    expect(actions).toHaveLength(0);
  });

  it("updates when price drifts beyond tolerance", () => {
    const live: LiveOffer[] = [{ id: "11", side: "bid", price: 0.9, amount: 100 }];
    const cache = new Map([[offerKey("bid", 0), "11"]]);
    const actions = reconcile(desired, live, cache, cfg);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.type).toBe("update");
  });

  it("cancels all when desired is empty", () => {
    const live: LiveOffer[] = [{ id: "11", side: "bid", price: 0.8, amount: 100 }];
    const cache = new Map([[offerKey("bid", 0), "11"]]);
    const actions = reconcile([], live, cache, cfg);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.type).toBe("cancel");
  });

  it("cancels orphan live offers not in the cache", () => {
    const live: LiveOffer[] = [{ id: "99", side: "ask", price: 0.9, amount: 50 }];
    const actions = reconcile([], live, new Map(), cfg);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ type: "cancel", offerId: "99" });
  });

  it("buildCacheFromMatch pairs desired to nearest live by side/price", () => {
    const d: DesiredOffer[] = [
      { side: "bid", level: 0, price: 0.80, amount: 100 },
      { side: "ask", level: 0, price: 0.82, amount: 100 },
    ];
    const live: LiveOffer[] = [
      { id: "A", side: "bid", price: 0.799, amount: 100 },
      { id: "B", side: "ask", price: 0.821, amount: 100 },
    ];
    const cache = buildCacheFromMatch(d, live);
    expect(cache.get(offerKey("bid", 0))).toBe("A");
    expect(cache.get(offerKey("ask", 0))).toBe("B");
  });
});
