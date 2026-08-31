import type { BotConfig } from "../config/schema.js";
import type { BotState } from "../core/state.js";
import type { DesiredOffer, OfferAction } from "../strategy/types.js";
import type { Logger } from "../obs/logger.js";
import type { Metrics } from "../obs/metrics.js";
import { BASE_RESERVE_XLM } from "../constants.js";

/** Trip the circuit breaker (idempotent). Caller then quotes nothing. */
export function tripBreaker(state: BotState, metrics: Metrics, log: Logger, reason: string): void {
  if (!state.breakerTripped) {
    metrics.breakerTrips++;
    log.warn({ reason }, "circuit breaker TRIPPED — cancelling all offers, idling");
  }
  state.breakerTripped = true;
  state.healthyStreak = 0;
}

/**
 * Record a healthy reference read. Returns true once the breaker has re-armed
 * (enough consecutive healthy cycles) and trading may resume.
 */
export function recordHealthy(state: BotState, cfg: BotConfig, log: Logger): boolean {
  if (!state.breakerTripped) return true;
  state.healthyStreak++;
  if (state.healthyStreak >= cfg.breakerRearmCycles) {
    state.breakerTripped = false;
    state.healthyStreak = 0;
    log.info("circuit breaker re-armed — resuming quoting");
    return true;
  }
  log.info({ streak: state.healthyStreak, need: cfg.breakerRearmCycles }, "breaker cooling down");
  return false;
}

/**
 * Enforce `MIN_RESERVE_BUFFER_XLM`: every new resting offer is a Stellar subentry
 * costing 0.5 XLM of minimum balance, so the bot must not create more offers than
 * its free XLM supports. Cancels and updates are always allowed through — they
 * free reserve or leave it unchanged, and blocking them could strand offers.
 *
 * When there is not enough headroom the ladder is trimmed from the OUTSIDE in:
 * the lowest levels sit closest to mid and do the most for the book, so they are
 * the ones kept.
 */
export function capCreatesByReserve(
  actions: OfferAction[],
  freeXlm: number | null,
  cfg: BotConfig,
  log: Logger,
): OfferAction[] {
  if (freeXlm === null) return actions; // no account loaded (dry run) — nothing to enforce
  const spendable = freeXlm - cfg.minReserveBufferXlm;
  const affordable = Math.max(0, Math.floor(spendable / BASE_RESERVE_XLM));
  const creates = actions.filter((a): a is Extract<OfferAction, { type: "create" }> => a.type === "create");
  if (creates.length <= affordable) return actions;

  const keep = new Set(
    [...creates].sort((a, b) => a.level - b.level).slice(0, affordable),
  );
  log.warn(
    { freeXlm, buffer: cfg.minReserveBufferXlm, wanted: creates.length, affordable },
    "insufficient XLM headroom — trimming new offers to stay above the reserve buffer",
  );
  return actions.filter((a) => a.type !== "create" || keep.has(a));
}

/**
 * Final defensive validation of the desired ladder: drop anything outside price
 * bounds or that would cross the book. The strategy already enforces these, so a
 * drop here indicates a bug and is logged loudly.
 */
export function validateDesired(desired: DesiredOffer[], cfg: BotConfig, log: Logger): DesiredOffer[] {
  const bestBid = Math.max(0, ...desired.filter((d) => d.side === "bid").map((d) => d.price));
  const bestAsk = Math.min(Infinity, ...desired.filter((d) => d.side === "ask").map((d) => d.price));
  const ok: DesiredOffer[] = [];
  for (const d of desired) {
    if (d.price < cfg.priceFloor || d.price > cfg.priceCeiling) {
      log.error({ offer: d }, "dropped offer: price out of bounds");
      continue;
    }
    if (d.side === "ask" && d.price > cfg.pegCeiling) {
      log.error({ offer: d }, "dropped ask: above peg ceiling");
      continue;
    }
    if (bestBid > 0 && bestAsk < Infinity && bestBid >= bestAsk) {
      log.error({ bestBid, bestAsk }, "dropped all: crossed book detected");
      return [];
    }
    if (d.amount <= 0) continue;
    ok.push(d);
  }
  return ok;
}
