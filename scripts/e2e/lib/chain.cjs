'use strict';
/**
 * Read-only Soroban access for the daily E2E suite.
 *
 * SAFETY: this module has no signing keys and deliberately exposes no way to
 * submit a transaction. Every "write" check goes through `simulate()`, which
 * calls `simulateTransaction` and throws the assembled result away. The suite
 * can never move funds, by construction — keep it that way.
 */
const {
  Contract,
  TransactionBuilder,
  Networks,
  Address,
  rpc,
  nativeToScVal,
  scValToNative,
  Keypair,
} = require('@stellar/stellar-sdk');

const PRIMARY_RPC =
  process.env.E2E_SOROBAN_RPC_URL ||
  'https://mainnet.stellar.validationcloud.io/v1/Sd5L8Y_8sk_XwOEEBharLAgxGhXsNJoXyElW-tFp0YU';
const FALLBACK_RPC =
  process.env.E2E_SOROBAN_FALLBACK_RPC_URL ||
  'https://soroban-rpc.mainnet.stellar.gateway.fm';
const HORIZON = process.env.E2E_HORIZON_URL || 'https://horizon.stellar.org';

const CONTRACTS = {
  staking: 'CC72BEVVKHQ57PB5FCKAZYRXCSR6DOQSTN46QR7RZMMM64YWNRPDS24S',
  liquidity: 'CAMXZXXBD7DFBLYLHUW24U4MY37X7SU5XXT5ZVVUBXRXWLAIM7INI7G2',
  rewards: 'CC67FMPFQNGSFTXK53VUJ5FUTYQC6XVJPFZJCVTP4EGH7ZCQBNFOXQ5P',
  aqua: 'CAUIKL3IYGMERDRUN6YSCLWVAKIFG5Q4YJHUKM4S4NJZQIA3BAS6OJPK',
  blub: 'CBMFDIRY5OKI4JJURXC4SMEQPWB4UUADIADJK4NA6CYBNOYK4W4TMLLF',
};

const ACCOUNTS = {
  // blub-issuer-v2. Also the ICE-lock holder and a real staker (2 lock
  // entries), which makes it a safe default subject for user-scoped getters
  // without exposing anyone else's wallet.
  manager: 'GDERSSCKJQPPXUQOZIOXGRVAGNLVPVZCJ2MAX7RCMVMWGRPVAEG7XGTK',
  admin: 'GALE4XON37AQ4KFTJKB3W32BUQGXFE46TQLKUIGBSIHSOEHTDBMKEI3M',
};

const AQUA_CLASSIC =
  'AQUA:GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA';

// A throwaway keypair only ever used as a simulation source account. Simulation
// does not verify signatures or sequence numbers beyond the account existing,
// so we pass a funded read-only account instead of generating one.
const SIM_SOURCE = process.env.E2E_SIM_SOURCE || ACCOUNTS.manager;

let _server = null;
let _activeRpc = null;

/** Soroban RPC client, falling back to the secondary endpoint if the primary is unhealthy. */
async function server() {
  if (_server) return _server;
  for (const url of [PRIMARY_RPC, FALLBACK_RPC]) {
    try {
      const s = new rpc.Server(url);
      const h = await s.getHealth();
      if (h && h.status === 'healthy') {
        _server = s;
        _activeRpc = url;
        return s;
      }
    } catch (_) {
      /* try the next endpoint */
    }
  }
  throw new Error('no healthy Soroban RPC endpoint');
}

function activeRpc() {
  return _activeRpc;
}

/** Typed ScVal builders — explicit, unlike the dApp's type-guessing converter. */
const arg = {
  address: (v) => Address.fromString(v).toScVal(),
  u32: (v) => nativeToScVal(Number(v), { type: 'u32' }),
  u64: (v) => nativeToScVal(BigInt(v), { type: 'u64' }),
  i128: (v) => nativeToScVal(BigInt(v), { type: 'i128' }),
  u128: (v) => nativeToScVal(BigInt(v), { type: 'u128' }),
  bytes: (v) => nativeToScVal(Buffer.from(v), { type: 'bytes' }),
  enum: (variant) => nativeToScVal({ [variant]: undefined }, { type: { [variant]: ['symbol'] } }),
};

/**
 * Simulate a contract call and return { ok, value, contractError, raw }.
 *
 * A contract that answers with a declared business error (`Error(Contract, #N)`)
 * is a HEALTHY contract — callers decide whether that particular code is
 * acceptable. Only transport failures and host panics are hard errors.
 */
async function simulate(contractId, method, args = [], opts = {}) {
  const s = await server();
  const source = opts.source || SIM_SOURCE;
  let account;
  try {
    account = await s.getAccount(source);
  } catch (e) {
    return { ok: false, transport: true, error: `getAccount(${source.slice(0, 8)}…): ${e.message}` };
  }

  const tx = new TransactionBuilder(account, {
    fee: '1000000',
    networkPassphrase: Networks.PUBLIC,
  })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(60)
    .build();

  let sim;
  try {
    sim = await s.simulateTransaction(tx);
  } catch (e) {
    return { ok: false, transport: true, error: `simulateTransaction: ${e.message}` };
  }

  if (rpc.Api.isSimulationError(sim)) {
    const m = String(sim.error).match(/Error\(Contract,\s*#(\d+)\)/);
    return {
      ok: false,
      contractError: m ? Number(m[1]) : null,
      error: String(sim.error).split('\n')[0].slice(0, 300),
      raw: sim,
    };
  }

  let value = null;
  try {
    value = sim.result && sim.result.retval ? scValToNative(sim.result.retval) : null;
  } catch (e) {
    return { ok: false, error: `scValToNative: ${e.message}` };
  }
  return {
    ok: true,
    value,
    authCount: (sim.result && sim.result.auth && sim.result.auth.length) || 0,
    minResourceFee: sim.minResourceFee,
  };
}

/** Convenience: simulate against the staking contract. */
const staking = (method, args, opts) => simulate(CONTRACTS.staking, method, args, opts);

/** Token balance (7 decimals) held by an address, as a Number. */
async function tokenBalance(token, holder) {
  const r = await simulate(token, 'balance', [arg.address(holder)]);
  if (!r.ok) return null;
  return Number(r.value) / 1e7;
}

/** Sum of AQUA sitting in ICE claimable balances (the real locked position). */
async function icelockedAqua() {
  let url = `${HORIZON}/claimable_balances?claimant=${ACCOUNTS.manager}&asset=${AQUA_CLASSIC}&limit=200`;
  let total = 0;
  let count = 0;
  const seen = new Set();
  while (url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`horizon claimable_balances HTTP ${res.status}`);
    const body = await res.json();
    const records = (body._embedded && body._embedded.records) || [];
    if (!records.length) break;
    for (const r of records) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      total += Number(r.amount);
      count++;
    }
    if (records.length < 200) break;
    url = body._links.next.href;
  }
  return { total, count };
}

module.exports = {
  CONTRACTS,
  ACCOUNTS,
  AQUA_CLASSIC,
  HORIZON,
  PRIMARY_RPC,
  FALLBACK_RPC,
  arg,
  server,
  activeRpc,
  simulate,
  staking,
  tokenBalance,
  icelockedAqua,
};
