import { describe, it, expect } from "vitest";
import { configSchema } from "../src/config/schema.js";
import { capCreatesByReserve } from "../src/risk/riskManager.js";
import { BASE_RESERVE_XLM } from "../src/constants.js";
import type { OfferAction } from "../src/strategy/types.js";
import { mkConfig } from "./helpers.js";

const silent = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as unknown as Parameters<typeof capCreatesByReserve>[3];

describe("DRY_RUN parsing is fail-safe", () => {
  // Regression: the original `v.toLowerCase() === "true"` turned every one of
  // these into LIVE TRADING. A deploy template with an unset variable would have
  // started placing real orders.
  it.each(["", " ", "1", "yes", "on", "TRUE", "True", "banana"])(
    "DRY_RUN=%j does not enable live trading",
    (v) => {
      expect(configSchema.parse({ dryRun: v }).dryRun).toBe(true);
    },
  );

  it.each(["false", "FALSE", "0", "no", "off"])("DRY_RUN=%j goes live (explicit only)", (v) => {
    // A live config also requires a valid secret, so parse must fail on THAT,
    // proving dryRun was actually flipped to false.
    const res = configSchema.safeParse({ dryRun: v });
    expect(res.success).toBe(false);
    expect(JSON.stringify(res.error?.issues)).toContain("BOT_SECRET");
  });

  it("omitting DRY_RUN entirely stays in dry run", () => {
    expect(configSchema.parse({}).dryRun).toBe(true);
  });
});

describe("capCreatesByReserve", () => {
  const cfg = mkConfig({ minReserveBufferXlm: "5" });
  const create = (level: number): OfferAction => ({
    type: "create",
    side: "ask",
    level,
    price: 0.8,
    amount: 100,
  });

  it("passes everything through when XLM headroom is ample", () => {
    const actions = [create(0), create(1), create(2)];
    expect(capCreatesByReserve(actions, 50, cfg, silent)).toHaveLength(3);
  });

  it("trims new offers to what free XLM supports, keeping levels closest to mid", () => {
    // free 6.5 XLM − 5 buffer = 1.5 spendable → 3 offers at 0.5 each.
    const actions = [create(0), create(1), create(2), create(3), create(4)];
    const out = capCreatesByReserve(actions, 6.5, cfg, silent);
    expect(out).toHaveLength(3);
    expect(out.map((a) => (a.type === "create" ? a.level : -1))).toEqual([0, 1, 2]);
  });

  it("blocks all new offers when free XLM is at or below the buffer", () => {
    expect(capCreatesByReserve([create(0), create(1)], 5, cfg, silent)).toHaveLength(0);
    expect(capCreatesByReserve([create(0)], 1, cfg, silent)).toHaveLength(0);
  });

  it("never blocks cancels or updates — they free or preserve reserve", () => {
    const actions: OfferAction[] = [
      { type: "cancel", side: "ask", offerId: "1" },
      { type: "update", side: "bid", level: 0, offerId: "2", price: 0.79, amount: 100 },
      create(0),
    ];
    const out = capCreatesByReserve(actions, 0, cfg, silent);
    expect(out.map((a) => a.type)).toEqual(["cancel", "update"]);
  });

  it("is a no-op when no account is loaded (dry run)", () => {
    const actions = [create(0), create(1)];
    expect(capCreatesByReserve(actions, null, cfg, silent)).toHaveLength(2);
  });

  it("uses the protocol base reserve of 0.5 XLM per offer", () => {
    expect(BASE_RESERVE_XLM).toBe(0.5);
  });
});
