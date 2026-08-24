/** In-memory bot state that persists across cycles within one process. */
export interface BotState {
  /** key ("side:level") → live offerId, so we can amend/cancel our own offers. */
  cache: Map<string, string>;
  /** Circuit breaker: true = not quoting until reference recovers. */
  breakerTripped: boolean;
  /** Consecutive healthy reference reads since the breaker tripped. */
  healthyStreak: number;
  /** Set once we know the account holds both trustlines (live mode). */
  trustlinesChecked: boolean;
}

export function createState(): BotState {
  return {
    cache: new Map(),
    breakerTripped: false,
    healthyStreak: 0,
    trustlinesChecked: false,
  };
}
