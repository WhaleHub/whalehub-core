import {
  BASE_FEE,
  Contract,
  SorobanRpc,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  type xdr,
} from "@stellar/stellar-sdk";
import {
  AQUA_CONTRACT,
  BLUB_CONTRACT,
  DUMMY_ACCOUNT,
  POOL_ADDRESS,
  passphraseFor,
} from "../constants.js";
import { fromStroops, toStroopsBigInt } from "../util/decimal.js";
import { withRetry } from "../util/retry.js";
import type { Logger } from "../obs/logger.js";

export interface PoolReserves {
  reserveBlub: number;
  reserveAqua: number;
}

/** Live pool parameters, read from `get_info` rather than hardcoded. */
export interface PoolParams {
  a: number; // amplification
  fee: number; // fractional (contract reports 1/10000 units)
}

/** Token index within the pool: Aquarius sorts by ascending contract address. */
const AQUA_IDX = AQUA_CONTRACT < BLUB_CONTRACT ? 0 : 1;
const BLUB_IDX = AQUA_IDX === 0 ? 1 : 0;

/**
 * Read-only Soroban client. In v1 it only reads the Aquarius pool's reserves for
 * the reference-price engine — it never signs or submits anything.
 */
export class SorobanClient {
  private readonly server: SorobanRpc.Server;
  private readonly passphrase: string;
  private dummy: Awaited<ReturnType<SorobanRpc.Server["getAccount"]>> | null = null;
  private dummyAt = 0;

  constructor(
    rpcUrl: string,
    network: string,
    private readonly log: Logger,
  ) {
    this.server = new SorobanRpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith("http://") });
    this.passphrase = passphraseFor(network);
  }

  private async getDummy() {
    const now = Date.now();
    if (this.dummy && now - this.dummyAt < 5 * 60 * 1000) return this.dummy;
    this.dummy = await withRetry(() => this.server.getAccount(DUMMY_ACCOUNT));
    this.dummyAt = now;
    return this.dummy;
  }

  /** Simulate a read-only pool call and return the native-decoded result. */
  private async readCall(fn: string, args: xdr.ScVal[] = []): Promise<unknown | null> {
    try {
      const account = await this.getDummy();
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: this.passphrase,
      })
        .addOperation(new Contract(POOL_ADDRESS).call(fn, ...args))
        .setTimeout(30)
        .build();
      const sim = await withRetry(() => this.server.simulateTransaction(tx));
      if (!SorobanRpc.Api.isSimulationSuccess(sim) || !sim.result) {
        this.log.warn({ fn }, "pool simulation failed");
        return null;
      }
      return scValToNative(sim.result.retval);
    } catch (e) {
      this.log.warn({ fn, err: (e as Error).message }, "pool read error");
      return null;
    }
  }

  /**
   * The pool's OWN quote for selling BLUB into it — the exact figure the contract
   * would honour, with no amplification-convention or fee assumptions on our side.
   *
   * Preferred over the local StableSwap math because the pool exposes `ramp_a`:
   * its amplification can change on-chain, which would silently invalidate a
   * hardcoded constant. Returns AQUA per BLUB, or null if the read fails.
   */
  async estimateSellPriceBlubToAqua(amountBlub: number): Promise<number | null> {
    if (!(amountBlub > 0)) return null;
    const out = await this.readCall("estimate_swap", [
      nativeToScVal(BLUB_IDX, { type: "u32" }),
      nativeToScVal(AQUA_IDX, { type: "u32" }),
      nativeToScVal(toStroopsBigInt(amountBlub), { type: "u128" }),
    ]);
    if (out === null || out === undefined) return null;
    const aquaOut = fromStroops(out as bigint | number | string);
    if (!(aquaOut > 0)) return null;
    return aquaOut / amountBlub;
  }

  /**
   * Live amplification + fee from `get_info`, so a `ramp_a` on the pool cannot
   * silently invalidate our fallback math. Returns null if unavailable.
   */
  async getPoolParams(): Promise<PoolParams | null> {
    const info = (await this.readCall("get_info")) as
      | { a?: bigint | number | string; fee?: bigint | number | string }
      | null;
    if (!info || info.a === undefined || info.fee === undefined) return null;
    const a = Number(info.a);
    // Aquarius reports the fee in 1/10000 units (5 = 0.05%).
    const fee = Number(info.fee) / 10_000;
    if (!Number.isFinite(a) || a <= 0 || !Number.isFinite(fee) || fee < 0 || fee >= 1) return null;
    return { a, fee };
  }

  /**
   * Reads `get_reserves` from the pool and maps the result to BLUB/AQUA. Aquarius
   * orders pool tokens by ascending contract address; AQUA_CONTRACT < BLUB_CONTRACT,
   * so index 0 = AQUA, index 1 = BLUB. We assert that ordering explicitly.
   */
  async getPoolReserves(): Promise<PoolReserves | null> {
    try {
      const account = await this.getDummy();
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: this.passphrase,
      })
        .addOperation(new Contract(POOL_ADDRESS).call("get_reserves"))
        .setTimeout(30)
        .build();

      const sim = await withRetry(() => this.server.simulateTransaction(tx));
      if (!SorobanRpc.Api.isSimulationSuccess(sim) || !sim.result) {
        this.log.warn("get_reserves simulation failed");
        return null;
      }
      const raw = scValToNative(sim.result.retval) as Array<bigint | number | string>;
      if (!Array.isArray(raw) || raw.length < 2) return null;

      const aquaFirst = AQUA_CONTRACT < BLUB_CONTRACT;
      const reserveAqua = fromStroops(raw[aquaFirst ? 0 : 1]!);
      const reserveBlub = fromStroops(raw[aquaFirst ? 1 : 0]!);
      if (!(reserveAqua > 0) || !(reserveBlub > 0)) return null;
      return { reserveBlub, reserveAqua };
    } catch (e) {
      this.log.warn({ err: (e as Error).message }, "getPoolReserves error");
      return null;
    }
  }
}
