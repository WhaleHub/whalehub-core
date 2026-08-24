import type { BotConfig } from "../config/schema.js";
import { POOL_AMP, POOL_FEE } from "../constants.js";
import { executableSellPrice } from "./stableSwap.js";
import { relDiff } from "../util/decimal.js";

export interface ReferenceResult {
  ok: boolean;
  mid: number | null; // AQUA per BLUB, after peg ceiling + sanity clamp
  reason?: string; // set when !ok (drives the circuit breaker)
  sources: {
    poolExec?: number;
    ammApi?: number;
    sdexMid?: number;
    divergenceBps?: number;
  };
}

export interface ReferenceInputs {
  reserveBlub: number | null; // null if pool read failed/stale
  reserveAqua: number | null;
  ammApiPrice: number | null; // AQUA per BLUB, or null
  sdexBestBid: number | null;
  sdexBestAsk: number | null;
  sdexBidDepthBlub: number; // depth available near top of book
}

/**
 * Derive a robust fair mid (AQUA per BLUB). Primary = Aquarius pool executable
 * price; cross-checked against amm-api; SDEX mid optionally blended. Peg (1.0)
 * is a hard ceiling. Returns ok=false (→ circuit breaker) when no trustworthy,
 * in-band reference is available.
 */
export function deriveReferenceMid(cfg: BotConfig, input: ReferenceInputs): ReferenceResult {
  const sources: ReferenceResult["sources"] = {};

  let poolExec: number | undefined;
  if (input.reserveBlub != null && input.reserveAqua != null && input.reserveBlub > 0 && input.reserveAqua > 0) {
    poolExec = executableSellPrice(input.reserveBlub, input.reserveAqua, cfg.refQuoteSizeBlub, POOL_AMP, POOL_FEE);
    sources.poolExec = poolExec;
  }

  if (input.ammApiPrice != null) sources.ammApi = input.ammApiPrice;

  // Primary source: pool math; fall back to amm-api if the pool read is missing.
  let primary = poolExec ?? input.ammApiPrice ?? undefined;
  if (primary === undefined || !Number.isFinite(primary) || primary <= 0) {
    return { ok: false, mid: null, reason: "no primary reference (pool + amm-api both unavailable)", sources };
  }

  // Divergence check (informational unless both sources present and far apart).
  if (poolExec != null && input.ammApiPrice != null) {
    const div = relDiff(poolExec, input.ammApiPrice) * 10_000;
    sources.divergenceBps = div;
    // Trust on-chain math; if amm-api is wildly different we keep pool but note it.
    if (div > cfg.refDivergenceBps) {
      // Prefer pool (trustless); no breaker — just recorded.
      primary = poolExec;
    }
  }

  // Optional light blend with SDEX mid when the book has enough depth.
  let midRaw = primary;
  if (
    cfg.sdexBlendWeight > 0 &&
    input.sdexBestBid != null &&
    input.sdexBestAsk != null &&
    input.sdexBidDepthBlub >= cfg.sdexMinDepthBlub
  ) {
    const sdexMid = (input.sdexBestBid + input.sdexBestAsk) / 2;
    sources.sdexMid = sdexMid;
    const w = Math.min(Math.max(cfg.sdexBlendWeight, 0), 1);
    midRaw = (1 - w) * primary + w * sdexMid;
  }

  // Peg ceiling.
  let mid = Math.min(midRaw, cfg.pegCeiling);

  // Sanity band: a value below the floor or (before peg-cap) far above the ceiling
  // signals a bad source → circuit breaker rather than trading on a wild number.
  if (midRaw < cfg.priceFloor || midRaw > cfg.priceCeiling * 1.5) {
    return {
      ok: false,
      mid: null,
      reason: `reference ${midRaw.toFixed(4)} outside sane band [${cfg.priceFloor}, ${cfg.priceCeiling}]`,
      sources,
    };
  }

  mid = Math.min(Math.max(mid, cfg.priceFloor), cfg.pegCeiling);
  return { ok: true, mid, sources };
}
