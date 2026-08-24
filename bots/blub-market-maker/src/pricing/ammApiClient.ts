import { AMM_API_BASE, AQUA_CONTRACT, BLUB_CONTRACT, STROOP_SCALE } from "../constants.js";
import type { Logger } from "../obs/logger.js";

/**
 * Thin client for the Aquarius pathfinding API (executable-quote cross-check).
 * POST /find-path/  { token_in_address, token_out_address, amount(stroops) }
 *   -> { success, amount, ... }
 * Defensive: short timeout, never throws — returns null on any failure so a
 * schema/endpoint change can't break quoting.
 */
export async function findPathQuoteBlubToAqua(
  amountBlub: number,
  timeoutMs: number,
  log: Logger,
): Promise<number | null> {
  const body = {
    token_in_address: BLUB_CONTRACT,
    token_out_address: AQUA_CONTRACT,
    amount: Math.round(amountBlub * STROOP_SCALE),
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${AMM_API_BASE}/find-path/`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      log.warn({ status: res.status }, "amm-api find-path non-200");
      return null;
    }
    const data = (await res.json()) as { success?: boolean; amount?: number | string };
    if (!data?.success || data.amount == null) return null;
    const aquaOut = Number(data.amount) / STROOP_SCALE;
    if (!Number.isFinite(aquaOut) || aquaOut <= 0) return null;
    return aquaOut / amountBlub; // AQUA per BLUB
  } catch (e) {
    log.warn({ err: (e as Error).message }, "amm-api find-path failed");
    return null;
  } finally {
    clearTimeout(timer);
  }
}
