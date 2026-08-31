import type { BotConfig } from "../config/schema.js";
import type { HorizonClient } from "../stellar/horizonClient.js";
import type { SorobanClient } from "../stellar/sorobanClient.js";
import type { MarketMaker } from "../strategy/marketMaker.js";
import type { Executor } from "../execution/executor.js";
import type { BotState } from "./state.js";
import type { Metrics } from "../obs/metrics.js";
import type { Logger } from "../obs/logger.js";
import type { DesiredOffer } from "../strategy/types.js";
import { findPathQuoteBlubToAqua } from "../pricing/ammApiClient.js";
import { deriveReferenceMid } from "../pricing/referenceEngine.js";
import { buildCacheFromMatch, reconcile } from "../execution/reconciler.js";
import { killSwitchActive } from "../risk/killSwitch.js";
import { capCreatesByReserve, recordHealthy, tripBreaker, validateDesired } from "../risk/riskManager.js";

export interface EngineDeps {
  cfg: BotConfig;
  horizon: HorizonClient;
  soroban: SorobanClient;
  mm: MarketMaker;
  executor: Executor;
  state: BotState;
  metrics: Metrics;
  log: Logger;
  pubkey: string | null; // null in dry-run without a wallet
}

export class Engine {
  private timer: NodeJS.Timeout | null = null;
  private stopping = false;

  constructor(private readonly deps: EngineDeps) {}

  async runCycle(): Promise<void> {
    const { cfg, horizon, soroban, mm, state, metrics, log, pubkey } = this.deps;
    metrics.cycles++;

    if (killSwitchActive(cfg.killSwitchFile)) {
      log.warn("kill switch active — cancelling all offers, idling");
      await this.applyDesired([], null);
      return;
    }

    const [reserves, poolParams, poolQuote, book, account] = await Promise.all([
      soroban.getPoolReserves(),
      soroban.getPoolParams(),
      soroban.estimateSellPriceBlubToAqua(cfg.refQuoteSizeBlub),
      horizon.orderBookTop(),
      pubkey ? horizon.loadAccount(pubkey).catch(() => null) : Promise.resolve(null),
    ]);

    const inventory = account ? horizon.inventoryOf(account) : { blub: 0, aqua: 0, xlm: 0 };
    // XLM headroom above the protocol minimum — gates how many NEW offers we may add.
    const freeXlm = account ? horizon.reserveInfo(account).freeXlm : null;

    if (!cfg.dryRun && account && !state.trustlinesChecked) {
      const tl = horizon.trustlines(account);
      if (!tl.aqua || !tl.blub) {
        throw new Error(
          `bot account is missing trustlines (AQUA=${tl.aqua}, BLUB=${tl.blub}). ` +
            `Add both trustlines and fund the account before running live.`,
        );
      }
      state.trustlinesChecked = true;
    }

    const ammApiPrice = cfg.ammApiEnabled
      ? await findPathQuoteBlubToAqua(cfg.refQuoteSizeBlub, 5000, log)
      : null;

    const ref = deriveReferenceMid(cfg, {
      poolQuote,
      reserveBlub: reserves?.reserveBlub ?? null,
      reserveAqua: reserves?.reserveAqua ?? null,
      poolParams,
      ammApiPrice,
      sdexBestBid: book.bestBid,
      sdexBestAsk: book.bestAsk,
      sdexBidDepthBlub: book.bidDepthBlub,
    });

    if (!ref.ok || ref.mid == null) {
      tripBreaker(state, metrics, log, ref.reason ?? "no reference");
      await this.applyDesired([], freeXlm);
      return;
    }
    if (!recordHealthy(state, cfg, log)) {
      await this.applyDesired([], freeXlm); // still cooling down
      return;
    }

    metrics.lastMid = ref.mid;

    const desired = validateDesired(mm.computeDesired({ mid: ref.mid, inventory }), cfg, log);
    await this.applyDesired(desired, freeXlm);

    log.info(
      {
        mid: Number(ref.mid.toFixed(7)),
        sources: ref.sources,
        book: { bestBid: book.bestBid, bestAsk: book.bestAsk },
        inventory,
        freeXlm,
        desiredCount: desired.length,
        metrics: metrics.snapshot(),
      },
      "cycle complete",
    );
  }

  /** Reconcile the desired ladder against live offers and apply (or log) the diff. */
  private async applyDesired(desired: DesiredOffer[], freeXlm: number | null): Promise<void> {
    const { horizon, executor, state, cfg, log, pubkey } = this.deps;
    const live = pubkey ? await horizon.myOffers(pubkey).catch(() => []) : [];
    const actions = capCreatesByReserve(reconcile(desired, live, state.cache, cfg), freeXlm, cfg, log);
    const { applied } = await executor.apply(actions);
    if (applied && pubkey) {
      const after = await horizon.myOffers(pubkey).catch(() => live);
      state.cache = buildCacheFromMatch(desired, after);
    } else if (!cfg.dryRun && pubkey && desired.length === 0) {
      // live cancel-all path: clear tracking once offers are gone
      state.cache = new Map();
    }
  }

  start(): void {
    const tick = async (): Promise<void> => {
      if (this.stopping) return;
      try {
        await this.runCycle();
      } catch (e) {
        this.deps.log.error({ err: (e as Error).message }, "cycle error");
      }
      if (!this.stopping) this.timer = setTimeout(tick, this.deps.cfg.loopIntervalMs);
    };
    void tick();
  }

  /** Graceful shutdown: cancel all open offers (live) and stop scheduling. */
  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    try {
      this.deps.log.info("shutting down — cancelling all offers");
      await this.applyDesired([], null);
    } catch (e) {
      this.deps.log.error({ err: (e as Error).message }, "error during shutdown cancel");
    }
  }
}
