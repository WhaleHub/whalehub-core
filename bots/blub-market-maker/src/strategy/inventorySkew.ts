import type { BotConfig } from "../config/schema.js";
import type { Inventory } from "./types.js";
import { bps } from "../util/decimal.js";

/**
 * Compute a price-skew fraction to mean-revert inventory toward the target mix.
 * Returns `skew` to apply as `price * (1 - skew)` to BOTH bid and ask:
 *   - long BLUB (too much) → skew > 0 → both quotes shift DOWN (ask more
 *     aggressive to sell, bid less aggressive to buy) → sheds BLUB.
 *   - short BLUB → skew < 0 → quotes shift UP → accumulates BLUB.
 * Bounded by ±maxSkewBps.
 */
export function computeInventorySkew(inv: Inventory, mid: number, cfg: BotConfig): number {
  const blubValue = inv.blub * mid;
  const total = blubValue + inv.aqua;
  if (total <= 0) return 0; // no inventory info → no skew
  const blubFraction = blubValue / total;
  const imbalance = blubFraction - cfg.targetBlubFraction; // >0 = too much BLUB
  const raw = imbalance * cfg.skewFactor;
  const cap = bps(cfg.maxSkewBps);
  return Math.max(-cap, Math.min(cap, raw));
}
