import type { BotConfig } from "../config/schema.js";
import type { BotState } from "../core/state.js";
import type { DesiredOffer } from "../strategy/types.js";
import type { Logger } from "../obs/logger.js";
import type { Metrics } from "../obs/metrics.js";

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
