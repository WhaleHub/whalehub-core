/**
 * Curve-style StableSwap math for a 2-coin pool (float implementation — precise
 * enough for a reference mid; the on-chain contract is the source of truth for
 * actual swaps, which v1 does not perform).
 *
 * Convention: `Ann = A * n` (n = number of coins = 2), matching Curve's original
 * StableSwap `get_D` / `get_y`. The absolute off-peg magnitude depends on the amp
 * convention, so the reference engine cross-checks against the Aquarius amm-api.
 * The price AT BALANCE is 1.0 regardless of convention (asserted in tests).
 */

const N = 2;
const MAX_ITER = 255;

/** Invariant D for balances [x, y] at amplification A. */
export function computeD(x: number, y: number, A: number): number {
  const s = x + y;
  if (s === 0) return 0;
  const Ann = A * N;
  let d = s;
  for (let i = 0; i < MAX_ITER; i++) {
    // D_P = D^(n+1) / (n^n * prod(x_i))
    let dp = d;
    dp = (dp * d) / (x * N);
    dp = (dp * d) / (y * N);
    const dPrev = d;
    d = ((Ann * s + dp * N) * d) / ((Ann - 1) * d + (N + 1) * dp);
    if (Math.abs(d - dPrev) <= 1e-12 * d) break;
  }
  return d;
}

/** Given one balance `xKnown` and invariant D, solve for the other balance. */
export function getY(xKnown: number, D: number, A: number): number {
  const Ann = A * N;
  // c = D^(n+1) / (n^n * xKnown * Ann)
  let c = D;
  c = (c * D) / (xKnown * N);
  c = (c * D) / (Ann * N);
  const b = xKnown + D / Ann;
  let y = D;
  for (let i = 0; i < MAX_ITER; i++) {
    const yPrev = y;
    y = (y * y + c) / (2 * y + b - D);
    if (Math.abs(y - yPrev) <= 1e-12 * y) break;
  }
  return y;
}

/**
 * Average executable price (AQUA per BLUB) for selling `dxBlub` BLUB into the pool.
 * reserveIn = BLUB reserve, reserveOut = AQUA reserve.
 */
export function executableSellPrice(
  reserveBlub: number,
  reserveAqua: number,
  dxBlub: number,
  A: number,
  fee: number,
): number {
  if (dxBlub <= 0) return marginalPrice(reserveBlub, reserveAqua, A);
  const D = computeD(reserveBlub, reserveAqua, A);
  const newAqua = getY(reserveBlub + dxBlub, D, A);
  const aquaOut = (reserveAqua - newAqua) * (1 - fee);
  return aquaOut / dxBlub;
}

/** Marginal (infinitesimal) price of BLUB in AQUA at current reserves. */
export function marginalPrice(reserveBlub: number, reserveAqua: number, A: number): number {
  const D = computeD(reserveBlub, reserveAqua, A);
  const eps = Math.max(reserveBlub * 1e-6, 1e-3);
  const newAqua = getY(reserveBlub + eps, D, A);
  return (reserveAqua - newAqua) / eps;
}
