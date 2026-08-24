import { configSchema, type BotConfig } from "../src/config/schema.js";

/**
 * Build a BotConfig for tests. Overrides are strings (the schema coerces env-style
 * string inputs), e.g. mkConfig({ halfSpreadBps: "100", dryRun: "true" }).
 */
export function mkConfig(overrides: Record<string, string> = {}): BotConfig {
  return configSchema.parse(overrides);
}
