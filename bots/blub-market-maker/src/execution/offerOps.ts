import { Operation, type xdr } from "@stellar/stellar-sdk";
import { AQUA, BLUB } from "../stellar/assets.js";
import { toAmountString, toPriceString } from "../util/decimal.js";
import type { OfferAction } from "../strategy/types.js";

/**
 * Build the classic SDEX operation for one reconciler action.
 * Price convention throughout is AQUA per BLUB; amount is BLUB.
 *   - ask  = sell BLUB for AQUA  → manageSellOffer(selling BLUB, buying AQUA)
 *   - bid  = buy BLUB with AQUA → manageBuyOffer(selling AQUA, buying BLUB)
 * For both, the SDK `price` arg is "units of buying per unit of selling" which
 * equals AQUA per BLUB for the ask and AQUA per BLUB for the bid — i.e. our price.
 * A cancel is the same op with amount 0 and the existing offerId.
 */
export function buildOfferOp(action: OfferAction): xdr.Operation {
  if (action.type === "cancel") {
    if (action.side === "ask") {
      return Operation.manageSellOffer({
        selling: BLUB,
        buying: AQUA,
        amount: "0",
        price: "1",
        offerId: action.offerId,
      });
    }
    return Operation.manageBuyOffer({
      selling: AQUA,
      buying: BLUB,
      buyAmount: "0",
      price: "1",
      offerId: action.offerId,
    });
  }

  const offerId = action.type === "update" ? action.offerId : "0";
  const price = toPriceString(action.price);
  const amount = toAmountString(action.amount);

  if (action.side === "ask") {
    return Operation.manageSellOffer({ selling: BLUB, buying: AQUA, amount, price, offerId });
  }
  return Operation.manageBuyOffer({ selling: AQUA, buying: BLUB, buyAmount: amount, price, offerId });
}
