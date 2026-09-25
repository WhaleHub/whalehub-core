// Turning whatever a wallet or the SDK throws into something a user can read.
//
// Every staking handler used to interpolate `error.message` straight into the
// failure dialog. Wallet extensions and StellarWalletsKit routinely reject with
// a plain string or a `{ error: … }` object rather than an Error, so `.message`
// came back undefined and the dialog read "Error: undefined" — which told the
// user nothing and hid the real cause from us too.

// Contract error codes from soroban-contracts/staking-contract/staking/src/lib.rs
// (`pub enum Error`). Soroban surfaces these as `Error(Contract, #N)`.
const CONTRACT_ERRORS: Record<number, string> = {
  1: "The staking contract is not initialised.",
  2: "The staking contract is already initialised.",
  3: "Not authorised for this action.",
  4: "The contract rejected the input — check the amount and try again.",
  5: "Not found.",
  6: "Insufficient balance for this transaction.",
  7: "Reward calculation failed.",
  8: "These tokens are not unlockable yet.",
  9: "Already claimed.",
  19: "Insufficient token allowance.",
  20: "The contract is busy with another transaction. Wait a moment and retry.",
  21: "Invalid lock period.",
  22: "Nothing is unlockable right now.",
  23: "This ICE lock was already executed.",
  24: "Not enough AQUA pending for ICE locking.",
  25: "That pool is not active.",
  26: "Pool not found.",
  27: "The maximum number of pools has been reached.",
  28: "Position not found.",
  29: "Claim cooldown is still active.",
  30: "Unstake cooldown is still active — you can unstake after the 10-day cooldown.",
  31: "You have no rewards to claim yet.",
  32: "The reward swap failed — try again shortly.",
  33: "Rewards are still unsettled. Try again shortly.",
};

// Phrases wallets use when the person simply declined the signature. These are
// not failures worth a "contact support" dialog.
const REJECTION_PATTERNS = [
  "user declined",
  "user rejected",
  "user denied",
  "request rejected",
  "declined by the user",
  "cancelled",
  "canceled",
  "rejected by user",
  "denied by the user",
  "closed without",
  "user closed",
  "aborted",
];

/** Pull every plausible message field out of an unknown throwable. */
function rawMessage(err: unknown): string {
  if (err == null) return "";
  if (typeof err === "string") return err;
  if (typeof err !== "object") return String(err);

  const e = err as Record<string, any>;

  // Error, and anything with a usable .message
  if (typeof e.message === "string" && e.message.trim()) return e.message;

  // StellarWalletsKit / wallet extensions: { error: "…" } or { error: { message } }
  if (typeof e.error === "string" && e.error.trim()) return e.error;
  if (e.error && typeof e.error === "object") {
    const inner = e.error as Record<string, any>;
    if (typeof inner.message === "string" && inner.message.trim()) return inner.message;
    if (typeof inner.error === "string" && inner.error.trim()) return inner.error;
  }

  // Other shapes seen in the wild
  for (const key of ["reason", "description", "details", "msg", "statusText"]) {
    if (typeof e[key] === "string" && e[key].trim()) return e[key];
  }

  // Horizon / RPC result codes
  const resultCodes =
    e.response?.data?.extras?.result_codes ?? e.extras?.result_codes;
  if (resultCodes) {
    const ops = Array.isArray(resultCodes.operations)
      ? ` (${resultCodes.operations.join(", ")})`
      : "";
    return `${resultCodes.transaction ?? "Transaction failed"}${ops}`;
  }

  // Last resort: serialise, so we never render "undefined"
  try {
    const json = JSON.stringify(e);
    if (json && json !== "{}") return json;
  } catch {
    /* circular — fall through */
  }
  return "";
}

/** True when the person simply declined the signature in their wallet. */
export function isUserRejection(err: unknown): boolean {
  const msg = rawMessage(err).toLowerCase();
  if (!msg) return false;
  return REJECTION_PATTERNS.some((p) => msg.includes(p));
}

/**
 * A message that is always safe to show a user — never "undefined".
 *
 * Decodes `Error(Contract, #N)` into the contract's own failure reason where we
 * recognise the code, and falls back to the raw text otherwise.
 */
export function getErrorMessage(
  err: unknown,
  fallback = "Something went wrong. Please try again."
): string {
  if (isUserRejection(err)) {
    return "You cancelled the request in your wallet.";
  }

  const msg = rawMessage(err);
  if (!msg) return fallback;

  // Decode a Soroban contract error code, e.g. "Error(Contract, #30)"
  const contractCode = msg.match(/Error\(Contract,\s*#(\d+)\)/);
  if (contractCode) {
    const decoded = CONTRACT_ERRORS[Number(contractCode[1])];
    if (decoded) return decoded;
    return `The contract rejected the transaction (code #${contractCode[1]}).`;
  }

  // A few raw SDK/RPC strings that mean nothing to a user
  if (msg.includes("Bad union switch")) {
    return "Your wallet returned a transaction this app could not read. Please update your wallet extension and try again.";
  }
  if (/insufficient.*(fee|balance)/i.test(msg)) {
    return msg;
  }

  return msg;
}
