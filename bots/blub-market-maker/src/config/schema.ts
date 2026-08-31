import { z } from "zod";

/** Coerce an env string to number with a default. */
const num = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : Number(v)))
    .pipe(z.number().finite());

/**
 * Parse a boolean env var FAIL-SAFE: anything we don't explicitly recognise falls
 * back to the default rather than to `false`.
 *
 * This matters because `dryRun` defaults to true. The previous implementation was
 * `v.toLowerCase() === "true"`, which silently turned `DRY_RUN=` (empty),
 * `DRY_RUN=1` and `DRY_RUN=yes` into LIVE TRADING — a deploy template with an
 * unset variable would have started placing real orders. Only an explicit,
 * recognised false value flips a default-true flag off.
 */
const TRUEISH = new Set(["true", "1", "yes", "y", "on"]);
const FALSEISH = new Set(["false", "0", "no", "n", "off"]);

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined) return def;
      const s = v.trim().toLowerCase();
      if (s === "") return def;
      if (TRUEISH.has(s)) return true;
      if (FALSEISH.has(s)) return false;
      return def; // unrecognised → default (safe)
    });

const str = (def: string) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : v));

export const configSchema = z
  .object({
    dryRun: bool(true),
    botSecret: z.string().optional(),

    horizonUrl: str("https://horizon.stellar.org"),
    sorobanRpcUrl: str("https://mainnet.sorobanrpc.com"),
    network: str("public"),

    // Spread / sizing
    halfSpreadBps: num(50),
    orderSizeBlub: num(10_000),
    ladderLevels: num(3),
    levelStepBps: num(40),
    sizeDecay: num(1.0),

    // Inventory skew
    targetBlubFraction: num(0.5),
    skewFactor: num(1.0),
    maxSkewBps: num(150),

    // Churn suppression
    minRepriceBps: num(20),
    minResizePct: num(0.1),

    // Exposure / bounds
    maxExposureBlub: num(100_000),
    maxExposureAqua: num(100_000),
    priceFloor: num(0.3),
    priceCeiling: num(1.0),
    pegCeiling: num(1.0),

    // Reference engine
    refQuoteSizeBlub: num(100_000),
    refDivergenceBps: num(300),
    maxReferenceAgeMs: num(60_000),
    sdexBlendWeight: num(0), // 0 = ignore SDEX mid in the blend
    sdexMinDepthBlub: num(50_000),
    ammApiEnabled: bool(true),

    // Loop / fees / reserves
    loopIntervalMs: num(20_000),
    feePerOpStroops: num(1_000),
    minReserveBufferXlm: num(5),

    usePassiveAsk: bool(false),
    killSwitchFile: str("./STOP"),
    logLevel: str("info"),
    breakerRearmCycles: num(2),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.priceFloor >= cfg.priceCeiling) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "priceFloor must be < priceCeiling" });
    }
    if (cfg.pegCeiling > cfg.priceCeiling) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "pegCeiling must be <= priceCeiling" });
    }
    if (cfg.halfSpreadBps <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "halfSpreadBps must be > 0" });
    }
    if (cfg.ladderLevels < 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "ladderLevels must be >= 1" });
    }
    if (cfg.targetBlubFraction < 0 || cfg.targetBlubFraction > 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "targetBlubFraction must be in [0,1]" });
    }
    // A live bot must have a valid-looking secret.
    if (!cfg.dryRun) {
      const s = cfg.botSecret ?? "";
      if (!/^S[A-Z2-7]{55}$/.test(s)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "BOT_SECRET must be a valid Stellar secret (S...) when DRY_RUN=false",
        });
      }
    }
  });

export type BotConfig = z.infer<typeof configSchema>;
