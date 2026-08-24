import { type Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import type { BotConfig } from "../config/schema.js";
import type { HorizonClient } from "../stellar/horizonClient.js";
import type { Logger } from "../obs/logger.js";
import type { Metrics } from "../obs/metrics.js";
import type { OfferAction } from "../strategy/types.js";
import { buildOfferOp } from "./offerOps.js";

const CANCEL_FIRST: Record<OfferAction["type"], number> = { cancel: 0, update: 1, create: 2 };

export class Executor {
  constructor(
    private readonly deps: {
      horizon: HorizonClient;
      cfg: BotConfig;
      passphrase: string;
      keypair: Keypair | null;
      log: Logger;
      metrics: Metrics;
    },
  ) {}

  private tally(actions: OfferAction[]): void {
    const m = this.deps.metrics;
    for (const a of actions) {
      if (a.type === "create") m.offersCreated++;
      else if (a.type === "update") m.offersUpdated++;
      else m.offersCancelled++;
    }
  }

  /** Apply reconciler actions. Dry-run logs intent only; live submits one batched tx. */
  async apply(actions: OfferAction[]): Promise<{ applied: boolean }> {
    if (actions.length === 0) return { applied: false };

    const ordered = [...actions].sort((a, b) => CANCEL_FIRST[a.type] - CANCEL_FIRST[b.type]);

    if (this.deps.cfg.dryRun || !this.deps.keypair) {
      for (const a of ordered) {
        this.deps.log.info({ intent: a.type.toUpperCase(), ...a }, "DRY_RUN offer action");
      }
      this.tally(ordered);
      return { applied: false };
    }

    try {
      await this.submitBatch(ordered);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("tx_bad_seq")) {
        this.deps.log.warn("tx_bad_seq — reloading account and retrying once");
        await this.submitBatch(ordered);
      } else {
        this.deps.metrics.submitErrors++;
        throw e;
      }
    }
    this.tally(ordered);
    return { applied: true };
  }

  private async submitBatch(actions: OfferAction[]): Promise<void> {
    const kp = this.deps.keypair!;
    const account = await this.deps.horizon.loadAccount(kp.publicKey());
    const builder = new TransactionBuilder(account, {
      fee: String(this.deps.cfg.feePerOpStroops),
      networkPassphrase: this.deps.passphrase,
    });
    for (const a of actions) builder.addOperation(buildOfferOp(a));
    const tx = builder.setTimeout(30).build();
    tx.sign(kp);
    const hash = await this.deps.horizon.submit(tx);
    this.deps.log.info({ hash, ops: actions.length }, "submitted offer batch");
  }
}
