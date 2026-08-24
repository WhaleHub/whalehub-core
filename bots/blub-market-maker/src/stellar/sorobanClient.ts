import {
  BASE_FEE,
  Contract,
  SorobanRpc,
  TransactionBuilder,
  scValToNative,
} from "@stellar/stellar-sdk";
import {
  AQUA_CONTRACT,
  BLUB_CONTRACT,
  DUMMY_ACCOUNT,
  POOL_ADDRESS,
  passphraseFor,
} from "../constants.js";
import { fromStroops } from "../util/decimal.js";
import { withRetry } from "../util/retry.js";
import type { Logger } from "../obs/logger.js";

export interface PoolReserves {
  reserveBlub: number;
  reserveAqua: number;
}

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
