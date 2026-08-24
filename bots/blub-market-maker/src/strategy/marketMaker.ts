import type { BotConfig } from "../config/schema.js";
import { bps } from "../util/decimal.js";
import { computeInventorySkew } from "./inventorySkew.js";
import type { DesiredOffer, Inventory, Strategy } from "./types.js";

export interface MarketMakerOptions {
  /** When true, cap ladder sizes to actual on-chain balances (live mode). */
  enforceInventory: boolean;
}

/**
 * Two-sided ladder market maker. Quotes AQUA per BLUB around a fair `mid`, with
 * inventory skew, a hard peg ceiling on asks, non-crossing guarantee, exposure
 * caps, and (in live mode) balance-aware sizing.
 */
export class MarketMaker implements Strategy {
  readonly name = "sdex-market-maker";

  constructor(
    private readonly cfg: BotConfig,
    private readonly opts: MarketMakerOptions,
  ) {}

  computeDesired(input: { mid: number; inventory: Inventory }): DesiredOffer[] {
    const { cfg } = this;
    const { mid, inventory } = input;
    if (!(mid > 0)) return [];

    const half = bps(cfg.halfSpreadBps);
    const skew = computeInventorySkew(inventory, mid, cfg);

    let bid0 = mid * (1 - half) * (1 - skew);
    let ask0 = mid * (1 + half) * (1 - skew);

    // Clamp to bounds; peg is a hard ceiling on the ask.
    ask0 = Math.min(ask0, cfg.pegCeiling);
    bid0 = Math.max(bid0, cfg.priceFloor);

    // Never cross: if the peg clamp pushed the ask at/below the bid, drop the bid.
    if (ask0 <= bid0) {
      bid0 = ask0 * (1 - 2 * half);
      if (bid0 < cfg.priceFloor) return []; // can't form a valid non-crossing quote
    }

    const step = bps(cfg.levelStepBps);
    const offers: DesiredOffer[] = [];

    // Remaining budgets (exposure caps, optionally intersected with balances).
    let blubBudget = cfg.maxExposureBlub;
    let aquaBudget = cfg.maxExposureAqua;
    if (this.opts.enforceInventory) {
      blubBudget = Math.min(blubBudget, Math.max(inventory.blub, 0));
      aquaBudget = Math.min(aquaBudget, Math.max(inventory.aqua, 0));
    }

    for (let k = 0; k < cfg.ladderLevels; k++) {
      const size = cfg.orderSizeBlub * Math.pow(cfg.sizeDecay, k);

      // Ask level (sell BLUB): consumes BLUB inventory.
      const askPrice = Math.min(ask0 * (1 + k * step), cfg.pegCeiling);
      const askSize = Math.min(size, blubBudget);
      if (askSize > 0 && askPrice > bid0) {
        offers.push({ side: "ask", level: k, price: askPrice, amount: askSize });
        blubBudget -= askSize;
      }

      // Bid level (buy BLUB): locks AQUA = size * price.
      const bidPrice = Math.max(bid0 * (1 - k * step), cfg.priceFloor);
      const aquaNeeded = size * bidPrice;
      const affordableSize = aquaNeeded > 0 ? Math.min(size, aquaBudget / bidPrice) : 0;
      if (affordableSize > 0 && bidPrice < askPrice) {
        offers.push({ side: "bid", level: k, price: bidPrice, amount: affordableSize });
        aquaBudget -= affordableSize * bidPrice;
      }
    }

    return offers;
  }
}
