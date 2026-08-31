import type { BotConfig } from "../config/schema.js";
import { POOL_AMP, POOL_FEE } from "../constants.js";
import { executableSellPrice } from "./stableSwap.js";
import { relDiff } from "../util/decimal.js";

export interface ReferenceResult {
  ok: boolean;
  mid: number | null; // AQUA per BLUB, after peg ceiling + sanity clamp
  reason?: string; // set when !ok (drives the circuit breaker)
  sources: {
    poolQuote?: number;
    poolExec?: number;
    ammApi?: number;
    sdexMid?: number;
    divergenceBps?: number;
    primarySource?: "poolQuote" | "poolMath" | "ammApi";
  };
}

export interface ReferenceInputs {
  /** The pool's own `estimate_swap` quote — contract truth, preferred source. */
  poolQuote: number | null;
  reserveBlub: number | null; // null if pool read failed/stale
  reserveAqua: number | null;
  /** Live amplification/fee from `get_info`; falls back to constants when null. */
  poolParams: { a: number; fee: number } | null;
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

  // Local StableSwap math, using live amplification/fee when we have them. The
  // pool exposes `ramp_a`, so hardcoded constants can go stale — they are only a
  // last resort here.
  const amp = input.poolParams?.a ?? POOL_AMP;
  const fee = input.poolParams?.fee ?? POOL_FEE;

  let poolExec: number | undefined;
  if (input.reserveBlub != null && input.reserveAqua != null && input.reserveBlub > 0 && input.reserveAqua > 0) {
    poolExec = executableSellPrice(input.reserveBlub, input.reserveAqua, cfg.refQuoteSizeBlub, amp, fee);
    sources.poolExec = poolExec;
  }

  const poolQuote = input.poolQuote != null && input.poolQuote > 0 ? input.poolQuote : undefined;
  if (poolQuote != null) sources.poolQuote = poolQuote;
  if (input.ammApiPrice != null) sources.ammApi = input.ammApiPrice;

  // Preference order: the pool's own quote (contract truth, no convention or fee
  // assumptions of ours), then our local math, then the off-chain API.
  let primary = poolQuote ?? poolExec ?? input.ammApiPrice ?? undefined;
  sources.primarySource =
    poolQuote != null ? "poolQuote" : poolExec != null ? "poolMath" : input.ammApiPrice != null ? "ammApi" : undefined;
  if (primary === undefined || !Number.isFinite(primary) || primary <= 0) {
    return { ok: false, mid: null, reason: "no primary reference (pool + amm-api both unavailable)", sources };
  }

  // Divergence check (informational unless both sources present and far apart).
  const onChain = poolQuote ?? poolExec;
  if (onChain != null && input.ammApiPrice != null) {
    const div = relDiff(onChain, input.ammApiPrice) * 10_000;
    sources.divergenceBps = div;
    // Trust on-chain; if amm-api is wildly different we keep on-chain but note it.
    if (div > cfg.refDivergenceBps) {
      primary = onChain;
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
