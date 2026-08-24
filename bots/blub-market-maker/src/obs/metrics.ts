/**
 * Minimal in-memory metrics. Logged each cycle; a future exporter can read `snapshot()`.
 */
export class Metrics {
  cycles = 0;
  offersCreated = 0;
  offersUpdated = 0;
  offersCancelled = 0;
  breakerTrips = 0;
  submitErrors = 0;
  lastMid: number | null = null;

  snapshot(): Record<string, number | null> {
    return {
      cycles: this.cycles,
      offersCreated: this.offersCreated,
      offersUpdated: this.offersUpdated,
      offersCancelled: this.offersCancelled,
      breakerTrips: this.breakerTrips,
      submitErrors: this.submitErrors,
      lastMid: this.lastMid,
    };
  }
}
