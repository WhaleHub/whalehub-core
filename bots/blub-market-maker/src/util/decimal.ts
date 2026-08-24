import { STROOP_SCALE } from "../constants.js";

/**
 * Fixed-point helpers for Stellar's 7-decimal amounts. The Stellar SDK expects
 * amounts and prices as decimal STRINGS with at most 7 fractional digits.
 */

/** Format a JS number as a 7-dp decimal string (truncates extra precision). */
export function toAmountString(value: number): string {
  if (!Number.isFinite(value)) throw new Error(`non-finite amount: ${value}`);
  // Truncate (not round) to 7 dp to avoid ever exceeding an available balance.
  const truncated = Math.trunc(value * STROOP_SCALE) / STROOP_SCALE;
  return truncated.toFixed(7);
}

/** Format a price as a 7-dp decimal string. Prices may round (both directions ok). */
export function toPriceString(price: number): string {
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`invalid price: ${price}`);
  }
  return price.toFixed(7);
}

/** Convert a raw stroop bigint/number/string to a human number. */
export function fromStroops(raw: bigint | number | string): number {
  const asBig = typeof raw === "number" ? BigInt(Math.trunc(raw)) : BigInt(raw);
  return Number(asBig) / STROOP_SCALE;
}

/** basis points → fraction (e.g. 50 → 0.005). */
export function bps(v: number): number {
  return v / 10_000;
}

/** Relative difference |a-b|/b, guarding b≈0. */
export function relDiff(a: number, b: number): number {
  if (b === 0) return a === 0 ? 0 : Infinity;
  return Math.abs(a - b) / Math.abs(b);
}
