/**
 * Linear-backoff retry. Mirrors the pattern in the app's soroban-vault.service.ts:
 * does NOT retry on deterministic errors (simulation/host errors), which won't
 * succeed on retry.
 */
const NON_RETRYABLE = ["HostError", "Simulation failed", "tx_bad_seq"];

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const retries = opts.retries ?? 2;
  const base = opts.baseDelayMs ?? 800;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = String((e as { message?: string })?.message ?? e);
      if (NON_RETRYABLE.some((n) => msg.includes(n))) throw e;
      if (attempt < retries) {
        await sleep(base * (attempt + 1));
      }
    }
  }
  throw lastErr;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
