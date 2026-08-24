import { readFileSync } from "node:fs";
import dotenv from "dotenv";
import { configSchema, type BotConfig } from "./schema.js";

/** Map env var names → schema keys. */
const ENV_MAP: Record<string, string> = {
  DRY_RUN: "dryRun",
  BOT_SECRET: "botSecret",
  HORIZON_URL: "horizonUrl",
  SOROBAN_RPC_URL: "sorobanRpcUrl",
  STELLAR_NETWORK: "network",
  HALF_SPREAD_BPS: "halfSpreadBps",
  ORDER_SIZE_BLUB: "orderSizeBlub",
  LADDER_LEVELS: "ladderLevels",
  LEVEL_STEP_BPS: "levelStepBps",
  SIZE_DECAY: "sizeDecay",
  TARGET_BLUB_FRACTION: "targetBlubFraction",
  SKEW_FACTOR: "skewFactor",
  MAX_SKEW_BPS: "maxSkewBps",
  MIN_REPRICE_BPS: "minRepriceBps",
  MIN_RESIZE_PCT: "minResizePct",
  MAX_EXPOSURE_BLUB: "maxExposureBlub",
  MAX_EXPOSURE_AQUA: "maxExposureAqua",
  PRICE_FLOOR: "priceFloor",
  PRICE_CEILING: "priceCeiling",
  PEG_CEILING: "pegCeiling",
  REF_QUOTE_SIZE_BLUB: "refQuoteSizeBlub",
  REF_DIVERGENCE_BPS: "refDivergenceBps",
  MAX_REFERENCE_AGE_MS: "maxReferenceAgeMs",
  SDEX_BLEND_WEIGHT: "sdexBlendWeight",
  SDEX_MIN_DEPTH_BLUB: "sdexMinDepthBlub",
  AMM_API_ENABLED: "ammApiEnabled",
  LOOP_INTERVAL_MS: "loopIntervalMs",
  FEE_PER_OP_STROOPS: "feePerOpStroops",
  MIN_RESERVE_BUFFER_XLM: "minReserveBufferXlm",
  USE_PASSIVE_ASK: "usePassiveAsk",
  KILL_SWITCH_FILE: "killSwitchFile",
  LOG_LEVEL: "logLevel",
  BREAKER_REARM_CYCLES: "breakerRearmCycles",
};

/**
 * Load config from environment (+ .env) and an optional JSON file (env wins over JSON).
 * Throws a readable error if validation fails.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): BotConfig {
  dotenv.config();

  let fileValues: Record<string, unknown> = {};
  const cfgPath = env.CONFIG_FILE;
  if (cfgPath) {
    try {
      fileValues = JSON.parse(readFileSync(cfgPath, "utf8")) as Record<string, unknown>;
    } catch (e) {
      throw new Error(`failed to read CONFIG_FILE=${cfgPath}: ${(e as Error).message}`);
    }
  }

  const raw: Record<string, unknown> = { ...fileValues };
  for (const [envKey, schemaKey] of Object.entries(ENV_MAP)) {
    const v = env[envKey];
    if (v !== undefined) raw[schemaKey] = v;
  }

  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    throw new Error(`Invalid configuration:\n${msg}`);
  }
  return Object.freeze(parsed.data);
}
