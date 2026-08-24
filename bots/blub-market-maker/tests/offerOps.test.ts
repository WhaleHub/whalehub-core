import { describe, it, expect } from "vitest";
import { Operation } from "@stellar/stellar-sdk";
import { buildOfferOp } from "../src/execution/offerOps.js";
import { AQUA, BLUB } from "../src/stellar/assets.js";

/** Parse an xdr.Operation back into a readable object for assertions. */
function parse(op: ReturnType<typeof buildOfferOp>) {
  return Operation.fromXDRObject(op) as unknown as Record<string, string>;
}

describe("offerOps", () => {
  it("builds an ask as a manageSellOffer (sell BLUB, buy AQUA)", () => {
    const op = parse(buildOfferOp({ type: "create", side: "ask", level: 0, price: 0.82, amount: 100 }));
    expect(op.type).toBe("manageSellOffer");
    expect((op.selling as unknown as typeof BLUB).equals(BLUB)).toBe(true);
    expect((op.buying as unknown as typeof AQUA).equals(AQUA)).toBe(true);
    expect(op.amount).toBe("100.0000000");
    expect(op.offerId).toBe("0");
  });

  it("builds a bid as a manageBuyOffer (sell AQUA, buy BLUB)", () => {
    const op = parse(buildOfferOp({ type: "create", side: "bid", level: 0, price: 0.8, amount: 100 }));
    expect(op.type).toBe("manageBuyOffer");
    expect((op.selling as unknown as typeof AQUA).equals(AQUA)).toBe(true);
    expect((op.buying as unknown as typeof BLUB).equals(BLUB)).toBe(true);
    expect(op.buyAmount).toBe("100.0000000");
  });

  it("cancels an ask via amount 0 with the existing offerId", () => {
    const op = parse(buildOfferOp({ type: "cancel", side: "ask", offerId: "777" }));
    expect(op.type).toBe("manageSellOffer");
    expect(op.amount).toBe("0.0000000");
    expect(op.offerId).toBe("777");
  });

  it("carries the offerId on an update", () => {
    const op = parse(buildOfferOp({ type: "update", side: "bid", level: 1, offerId: "555", price: 0.79, amount: 50 }));
    expect(op.offerId).toBe("555");
    expect(op.buyAmount).toBe("50.0000000");
  });
});
