import type { BotConfig } from "../config/schema.js";
import type { DesiredOffer, LiveOffer, OfferAction, Side } from "../strategy/types.js";
import { bps, relDiff } from "../util/decimal.js";

export const offerKey = (side: Side, level: number): string => `${side}:${level}`;

/**
 * Converge live offers → desired ladder. Matches by (side, level) via the
 * persisted key→offerId cache. Suppresses churn: an existing offer within
 * minRepriceBps / minResizePct is left untouched. Emits cancels for cached
 * offers no longer desired and for orphan live offers we don't track.
 */
export function reconcile(
  desired: DesiredOffer[],
  live: LiveOffer[],
  cache: Map<string, string>,
  cfg: BotConfig,
): OfferAction[] {
  const liveById = new Map(live.map((o) => [o.id, o]));
  const liveIds = new Set(live.map((o) => o.id));
  const cachedIds = new Set(cache.values());
  const actions: OfferAction[] = [];
  const desiredKeys = new Set<string>();

  for (const d of desired) {
    const key = offerKey(d.side, d.level);
    desiredKeys.add(key);
    const id = cache.get(key);
    const liveOffer = id ? liveById.get(id) : undefined;

    if (id && liveOffer) {
      const priceDrift = relDiff(d.price, liveOffer.price);
      const sizeDrift = relDiff(d.amount, liveOffer.amount);
      if (priceDrift > bps(cfg.minRepriceBps) || sizeDrift > cfg.minResizePct) {
        actions.push({ type: "update", side: d.side, level: d.level, offerId: id, price: d.price, amount: d.amount });
      }
      // else: within tolerance → keep as-is (no action)
    } else {
      actions.push({ type: "create", side: d.side, level: d.level, price: d.price, amount: d.amount });
    }
  }

  // Cancel cached offers that are no longer desired but still live.
  for (const [key, id] of cache) {
    if (!desiredKeys.has(key) && liveIds.has(id)) {
      const side: Side = key.startsWith("ask") ? "ask" : "bid";
      actions.push({ type: "cancel", side, offerId: id });
    }
  }

  // Cancel orphan live offers we don't track (e.g. left over from a crash).
  for (const o of live) {
    if (!cachedIds.has(o.id)) {
      actions.push({ type: "cancel", side: o.side, offerId: o.id });
    }
  }

  return actions;
}

/**
 * After a live submit, rebuild the key→offerId cache by pairing each desired
 * offer to the nearest live offer of the same side (one-to-one, closest price).
 */
export function buildCacheFromMatch(desired: DesiredOffer[], live: LiveOffer[]): Map<string, string> {
  const cache = new Map<string, string>();
  for (const side of ["bid", "ask"] as Side[]) {
    const wants = desired.filter((d) => d.side === side).sort((a, b) => a.level - b.level);
    const pool = live.filter((o) => o.side === side).slice();
    for (const d of wants) {
      let bestIdx = -1;
      let bestDiff = Infinity;
      for (let i = 0; i < pool.length; i++) {
        const diff = Math.abs(pool[i]!.price - d.price);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestIdx = i;
        }
      }
      if (bestIdx >= 0) {
        cache.set(offerKey(d.side, d.level), pool[bestIdx]!.id);
        pool.splice(bestIdx, 1);
      }
    }
  }
  return cache;
}
