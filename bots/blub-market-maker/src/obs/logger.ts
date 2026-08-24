import pino from "pino";

export function createLogger(level: string) {
  return pino({
    level,
    base: { app: "blub-market-maker" },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export type Logger = ReturnType<typeof createLogger>;
