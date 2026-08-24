import { Keypair } from "@stellar/stellar-sdk";
import { loadConfig } from "./config/loadConfig.js";
import { passphraseFor } from "./constants.js";
import { createLogger } from "./obs/logger.js";
import { Metrics } from "./obs/metrics.js";
import { HorizonClient } from "./stellar/horizonClient.js";
import { SorobanClient } from "./stellar/sorobanClient.js";
import { MarketMaker } from "./strategy/marketMaker.js";
import { Executor } from "./execution/executor.js";
import { createState } from "./core/state.js";
import { Engine } from "./core/loop.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  const log = createLogger(cfg.logLevel);
  const metrics = new Metrics();
  const passphrase = passphraseFor(cfg.network);

  const keypair = cfg.botSecret ? Keypair.fromSecret(cfg.botSecret) : null;
  const pubkey = keypair?.publicKey() ?? null;

  log.info(
    {
      mode: cfg.dryRun ? "DRY_RUN (no orders placed)" : "LIVE",
      wallet: pubkey ?? "(none — dry-run without BOT_SECRET)",
      network: cfg.network,
      halfSpreadBps: cfg.halfSpreadBps,
      ladderLevels: cfg.ladderLevels,
      loopIntervalMs: cfg.loopIntervalMs,
    },
    "starting blub-market-maker",
  );

  const horizon = new HorizonClient(cfg.horizonUrl, log);
  const soroban = new SorobanClient(cfg.sorobanRpcUrl, cfg.network, log);
  const mm = new MarketMaker(cfg, { enforceInventory: !cfg.dryRun });
  const executor = new Executor({ horizon, cfg, passphrase, keypair, log, metrics });
  const state = createState();

  const engine = new Engine({ cfg, horizon, soroban, mm, executor, state, metrics, log, pubkey });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, "received shutdown signal");
    await engine.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  engine.start();
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("fatal:", (e as Error).message);
  process.exit(1);
});
