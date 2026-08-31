import { type Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import type { BotConfig } from "../config/schema.js";
import type { HorizonClient } from "../stellar/horizonClient.js";
import type { Logger } from "../obs/logger.js";
import type { Metrics } from "../obs/metrics.js";
import type { OfferAction } from "../strategy/types.js";
import { MAX_OPS_PER_TX } from "../constants.js";
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

    // Stellar caps a transaction at 100 operations. A crash can leave far more
    // orphan offers than that (myOffers pages up to 200), and a single oversized
    // batch would fail forever — leaving the bot unable to clean up after itself.
    // Chunking keeps the cancel-first ordering across chunks.
    const chunks: OfferAction[][] = [];
    for (let i = 0; i < ordered.length; i += MAX_OPS_PER_TX) {
      chunks.push(ordered.slice(i, i + MAX_OPS_PER_TX));
    }
    if (chunks.length > 1) {
      this.deps.log.info(
        { actions: ordered.length, chunks: chunks.length, maxOpsPerTx: MAX_OPS_PER_TX },
        "batch exceeds the per-transaction operation cap — splitting",
      );
    }

    for (const chunk of chunks) {
      try {
        await this.submitBatch(chunk);
      } catch (e) {
        const msg = (e as Error).message;
        if (msg.includes("tx_bad_seq")) {
          this.deps.log.warn("tx_bad_seq — reloading account and retrying once");
          await this.submitBatch(chunk);
        } else {
          this.deps.metrics.submitErrors++;
          throw e;
        }
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
