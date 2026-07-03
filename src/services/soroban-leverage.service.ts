// Leveraged LP Farming service — talks to the WhaleHub Leverage Vault (Blend flash-loan
// leverage) Soroban contract. Testnet-first (Blend mainnet pool creation needs a backstop
// deposit). See docs/technical/leveraged-lp-farming.md and the leverage-vault contract.
//
// Mirrors the simulate → assembleTransaction → sign → send → poll flow used by
// SorobanVaultService, but network-aware (testnet/mainnet) via SOROBAN_CONFIG.

import {
  Address,
  Contract,
  rpc,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
} from "@stellar/stellar-sdk";
import {
  StellarWalletsKit,
  WalletNetwork,
  FREIGHTER_ID,
  LOBSTR_ID,
  FreighterModule,
  LobstrModule,
} from "@creit.tech/stellar-wallets-kit";
import { WALLET_CONNECT_ID } from "@creit.tech/stellar-wallets-kit/modules/walletconnect.module";
import { kit as walletConnectKit, reconnectWalletConnect } from "../components/Navbar";
import { SOROBAN_CONFIG } from "../config/soroban.config";

// Leverage farming is TESTNET-ONLY (Blend mainnet pool creation needs a backstop deposit),
// so this whole service is pinned to testnet regardless of the app's global network — the
// hidden /leverage screen "switches to testnet" while the rest of the app stays mainnet.
const TESTNET_RPC = "https://soroban-testnet.stellar.org";
const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

// Stroop scaling — AQUA / XLM / LP share tokens all use 7 decimals.
const SCALAR_7 = 1e7;
const toI128 = (human: string | number) =>
  nativeToScVal(BigInt(Math.round(parseFloat(String(human)) * SCALAR_7)), {
    type: "i128",
  });

const isWCConnectionError = (e: any): boolean => {
  const msg = String(e?.message || e).toLowerCase();
  return (
    msg.includes("connection key") ||
    msg.includes("session") ||
    msg.includes("not connected") ||
    msg.includes("disconnected") ||
    msg.includes("no matching key")
  );
};

export interface LeverageConfig {
  admin: string;
  blendPool: string;
  ammPool: string;
  lpToken: string;
  borrowAsset: string;
  pairToken: string;
  borrowIdx: number;
  pairIdx: number;
  maxLeverageBps: number;
}

export interface LeverageUserPosition {
  /** LP share tokens supplied as collateral on behalf of the user (human units). */
  collateralLp: string;
  /** borrow_asset debt principal attributed to the user (human units). */
  debt: string;
}

export interface TxResult {
  success: boolean;
  error?: string;
  transactionHash?: string;
}

export class SorobanLeverageService {
  private server: rpc.Server;
  private sendServer: rpc.Server;
  private vaultId: string;
  private networkPassphrase: string;

  private dummyAccountCache: any = null;
  private dummyAccountFetchedAt = 0;

  constructor() {
    this.server = new rpc.Server(TESTNET_RPC);
    this.sendServer = new rpc.Server(TESTNET_RPC);
    this.vaultId = SOROBAN_CONFIG.leverage.vaultContractId;
    this.networkPassphrase = TESTNET_PASSPHRASE;
  }

  /** True when at least one leverage market is configured. */
  isConfigured(): boolean {
    return Boolean(this.vaultId);
  }

  /** Point the service at a specific market's vault (called when the user switches markets). */
  setVault(vaultId: string): void {
    this.vaultId = vaultId;
  }

  // ----------------------------------------------------------------- internals

  private async withRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
    let lastError: any;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (e: any) {
        lastError = e;
        const msg = String(e?.message || e);
        if (msg.includes("HostError") || msg.includes("Simulation failed")) throw e;
        if (attempt < maxRetries) await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      }
    }
    throw lastError;
  }

  private async getDummyAccount() {
    const now = Date.now();
    if (this.dummyAccountCache && now - this.dummyAccountFetchedAt < 5 * 60 * 1000) {
      return this.dummyAccountCache;
    }
    const account = await this.withRetry(() =>
      this.server.getAccount("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF")
    );
    this.dummyAccountCache = account;
    this.dummyAccountFetchedAt = now;
    return account;
  }

  /** Read-only contract call: simulate and decode the return value. */
  private async readCall<T>(method: string, ...args: any[]): Promise<T> {
    if (!this.vaultId) throw new Error("Leverage vault not configured");
    const account = await this.getDummyAccount();
    const contract = new Contract(this.vaultId);
    const tx = new TransactionBuilder(account, {
      fee: "100000",
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(60)
      .build();

    const sim = await this.withRetry(() => this.server.simulateTransaction(tx));
    if (rpc.Api.isSimulationError(sim)) {
      throw new Error(`Simulation failed (${method}): ${sim.error}`);
    }
    const retval = (sim as rpc.Api.SimulateTransactionSuccessResponse).result?.retval;
    return scValToNative(retval as any) as T;
  }

  private async buildSignKit(walletName: string): Promise<StellarWalletsKit> {
    if (walletName === WALLET_CONNECT_ID || walletName === ("wallet_connect" as any)) {
      await walletConnectKit.setWallet(WALLET_CONNECT_ID);
      return walletConnectKit;
    }
    const selectedModule = walletName === LOBSTR_ID ? new LobstrModule() : new FreighterModule();
    const walletId = walletName === LOBSTR_ID ? LOBSTR_ID : FREIGHTER_ID;
    const kit = new StellarWalletsKit({
      network: WalletNetwork.TESTNET,
      selectedWalletId: walletId,
      modules: [selectedModule],
    });
    await kit.setWallet(walletId);
    return kit;
  }

  /** Build → simulate → assemble → sign → send → poll for a state-changing call. */
  private async invoke(
    userAddress: string,
    walletName: string,
    method: string,
    args: any[]
  ): Promise<TxResult> {
    try {
      if (!this.vaultId) throw new Error("Leverage vault not configured");
      let signKit = await this.buildSignKit(walletName);

      const contract = new Contract(this.vaultId);
      const account = await this.withRetry(() => this.server.getAccount(userAddress));

      let tx = new TransactionBuilder(account, {
        fee: "1000000",
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(contract.call(method, ...args))
        .setTimeout(300)
        .build();

      const sim = await this.withRetry(() => this.server.simulateTransaction(tx));
      if (rpc.Api.isSimulationError(sim)) {
        throw new Error(`Simulation failed: ${sim.error}`);
      }
      tx = rpc.assembleTransaction(tx, sim).build();

      const txXdr = tx.toXDR();
      const signOpts = { address: userAddress, networkPassphrase: this.networkPassphrase };
      let signedTxXdr: string;
      try {
        ({ signedTxXdr } = await signKit.signTransaction(txXdr, signOpts));
      } catch (signErr: any) {
        const isWC = walletName === WALLET_CONNECT_ID || walletName === ("wallet_connect" as any);
        if (isWC && isWCConnectionError(signErr)) {
          signKit = reconnectWalletConnect();
          await signKit.setWallet(WALLET_CONNECT_ID);
          ({ signedTxXdr } = await signKit.signTransaction(txXdr, signOpts));
        } else {
          throw signErr;
        }
      }

      const signedTx = TransactionBuilder.fromXDR(signedTxXdr, this.networkPassphrase);
      const sendResponse = await this.sendServer.sendTransaction(signedTx as any);
      if (sendResponse.status === "PENDING") {
        return await this.pollTransactionResult(sendResponse.hash);
      }
      if (sendResponse.status === "ERROR") {
        throw new Error(`Transaction send error: ${JSON.stringify((sendResponse as any).errorResult ?? "")}`);
      }
      throw new Error(`Unexpected send status: ${sendResponse.status}`);
    } catch (error: any) {
      console.error(`[Leverage] ${method} error:`, error);
      return { success: false, error: error.message || `${method} failed` };
    }
  }

  private async pollTransactionResult(hash: string): Promise<TxResult> {
    // 60 attempts × 1s — matches the vault service's busy-ledger budget.
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        const res = await this.server.getTransaction(hash);
        if (res.status === "SUCCESS") return { success: true, transactionHash: hash };
        if (res.status === "FAILED") {
          return { success: false, error: "Transaction failed on-chain", transactionHash: hash };
        }
      } catch {
        // NOT_FOUND yet — keep polling.
      }
    }
    return { success: false, error: "Timed out waiting for confirmation", transactionHash: hash };
  }

  // -------------------------------------------------------------------- reads

  async getConfig(): Promise<LeverageConfig | null> {
    try {
      const raw = await this.readCall<any>("get_config");
      // The vault config carries only on-chain fields; AMM/pair come from the market config
      // in the page (per selected market).
      return {
        admin: raw.admin,
        blendPool: raw.blend_pool,
        ammPool: "",
        lpToken: raw.lp_token,
        borrowAsset: raw.borrow_asset,
        pairToken: "",
        borrowIdx: 0,
        pairIdx: 1,
        maxLeverageBps: Number(raw.max_leverage_bps),
      };
    } catch (e) {
      console.error("[Leverage] getConfig failed:", e);
      return null;
    }
  }

  async getPosition(userAddress: string): Promise<LeverageUserPosition> {
    try {
      const raw = await this.readCall<any>(
        "get_position",
        nativeToScVal(Address.fromString(userAddress), { type: "address" })
      );
      return {
        collateralLp: (Number(raw.collateral_lp) / SCALAR_7).toFixed(7),
        debt: (Number(raw.debt) / SCALAR_7).toFixed(7),
      };
    } catch (e) {
      console.error("[Leverage] getPosition failed:", e);
      return { collateralLp: "0", debt: "0" };
    }
  }

  async getTotals(): Promise<{ totalCollateralLp: string; totalDebt: string }> {
    try {
      const raw = await this.readCall<any[]>("get_totals");
      return {
        totalCollateralLp: (Number(raw[0]) / SCALAR_7).toFixed(7),
        totalDebt: (Number(raw[1]) / SCALAR_7).toFixed(7),
      };
    } catch (e) {
      console.error("[Leverage] getTotals failed:", e);
      return { totalCollateralLp: "0", totalDebt: "0" };
    }
  }

  // ------------------------------------------------------------------- writes

  /**
   * Open / add to a leveraged LP position.
   * `minLpOut` / `minPairOut` should come from simulating the zap against current
   * AMM reserves on the client (leveraged collateral + swap slippage floors).
   */
  async openPosition(params: {
    userAddress: string;
    walletName: string;
    collateralLpAmount: string;
    borrowAmount: string;
    minLpOut: string;
    minPairOut: string;
  }): Promise<TxResult> {
    const { userAddress, walletName, collateralLpAmount, borrowAmount, minLpOut, minPairOut } = params;
    return this.invoke(userAddress, walletName, "open_position", [
      nativeToScVal(Address.fromString(userAddress), { type: "address" }),
      toI128(collateralLpAmount),
      toI128(borrowAmount),
      toI128(minLpOut),
      toI128(minPairOut),
    ]);
  }

  /** v1 unwind: repay debt (funds pulled from user) and withdraw LP collateral. */
  async repayAndWithdraw(params: {
    userAddress: string;
    walletName: string;
    repayAmount: string;
    withdrawLpAmount: string;
    minLpOutToUser?: string;
  }): Promise<TxResult> {
    const { userAddress, walletName, repayAmount, withdrawLpAmount, minLpOutToUser } = params;
    return this.invoke(userAddress, walletName, "repay_and_withdraw", [
      nativeToScVal(Address.fromString(userAddress), { type: "address" }),
      toI128(repayAmount),
      toI128(withdrawLpAmount),
      toI128(minLpOutToUser ?? "0"),
    ]);
  }
}

export const sorobanLeverageService = new SorobanLeverageService();
