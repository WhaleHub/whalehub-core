import {
  Address,
  Contract,
  SorobanRpc,
  TransactionBuilder,
  Networks,
  nativeToScVal,
  scValToNative,
  BASE_FEE,
} from "@stellar/stellar-sdk";
import {
  StellarWalletsKit,
  WalletNetwork,
  FREIGHTER_ID,
  LOBSTR_ID,
  FreighterModule,
  LobstrModule,
} from "../lib/walletKit";
import { WALLET_CONNECT_ID } from "../lib/walletKit";
import { kit as walletConnectKit, reconnectWalletConnect } from "../components/Navbar";

export interface VaultPoolInfo {
  pool_id: number;
  pool_address: string;
  token_a: string;
  token_b: string;
  share_token: string;
  total_lp_tokens: string;
  active: boolean;
  added_at: number;
  // Display fields
  token_a_code: string;
  token_b_code: string;
  token_a_logo: string;
  token_b_logo: string;
}

export interface VaultUserPosition {
  pool_id: number;
  share_ratio: string;
  deposited_at: number;
  active: boolean;
  // Calculated fields
  user_lp_amount: string;
  percentage: string;
}

// Detect stale/dropped WalletConnect session errors
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

export class SorobanVaultService {
  private server: SorobanRpc.Server;      // reads: getAccount, simulate, getTransaction
  private fallbackServer: SorobanRpc.Server; // fallback read RPC if primary fails
  private sendServer: SorobanRpc.Server;  // writes: sendTransaction only (gateway FM)
  private stakingContractId: string;
  private networkPassphrase: string;

  // Cache dummy account for 5 min — sequence number doesn't matter for read-only simulations
  private dummyAccountCache: any = null;
  private dummyAccountFetchedAt = 0;

  constructor() {
    const network = (process.env.REACT_APP_STELLAR_NETWORK || "PUBLIC").toLowerCase();

    // Read RPC: reliable for simulation and tx polling
    const readRpc = process.env.REACT_APP_SOROBAN_RPC_URL || "https://mainnet.sorobanrpc.com";
    // Send RPC: gateway FM handles complex tx submission better
    const sendRpc = process.env.REACT_APP_VAULT_RPC_URL || "https://soroban-rpc.mainnet.stellar.gateway.fm";

    this.server = new SorobanRpc.Server(readRpc);
    // If primary read RPC fails, fall back to gateway FM (it can do reads too)
    this.fallbackServer = new SorobanRpc.Server(sendRpc);
    this.sendServer = new SorobanRpc.Server(sendRpc);
    this.stakingContractId = process.env.REACT_APP_STAKING_CONTRACT_ID || "";
    this.networkPassphrase = (network === "public" || network === "mainnet")
      ? Networks.PUBLIC
      : Networks.TESTNET;
  }

  // Retry wrapper: retries up to maxRetries times with linear backoff.
  // Does NOT retry on HostError (simulation errors are final — retrying won't help).
  private async withRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
    let lastError: any;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (e: any) {
        lastError = e;
        const msg = String(e?.message || e);
        if (msg.includes("HostError") || msg.includes("Simulation failed")) throw e;
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        }
      }
    }
    throw lastError;
  }

  // Fetch dummy account with 5-minute cache — avoids 1 extra RPC call per simulation
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

  // Simulate with retry + automatic fallback to second RPC on failure
  private async simulateTx(tx: any): Promise<SorobanRpc.Api.SimulateTransactionResponse> {
    try {
      return await this.withRetry(() => this.server.simulateTransaction(tx));
    } catch (primaryErr: any) {
      const msg = String(primaryErr?.message || primaryErr);
      if (msg.includes("HostError") || msg.includes("Simulation failed")) throw primaryErr;
      console.warn("[Vault] Primary RPC failed, trying fallback...", primaryErr?.message);
      return await this.withRetry(() => this.fallbackServer.simulateTransaction(tx));
    }
  }

  // Poll both RPCs for a submitted transaction hash.
  // After 60s of NOT_FOUND, falls back to Horizon (permanent tx history).
  // Returns { success, hash } or throws.
  private async pollTransactionResult(hash: string): Promise<{ success: true; transactionHash: string }> {
    // "bad union switch" = Stellar SDK XDR parse error; the tx DID execute on-chain,
    // the SDK just can't decode the result envelope. Treat as success.
    const isBadUnionSwitch = (e: any) =>
      /bad union switch/i.test(String(e?.message || e));

    const pollOnce = async () => {
      try {
        return await this.server.getTransaction(hash);
      } catch (e: any) {
        if (isBadUnionSwitch(e)) return { status: "SUCCESS" } as any;
        try {
          return await this.fallbackServer.getTransaction(hash);
        } catch (e2: any) {
          if (isBadUnionSwitch(e2)) return { status: "SUCCESS" } as any;
          throw e2;
        }
      }
    };

    let response = await pollOnce();
    let attempts = 0;
    const maxAttempts = 60;

    while (response.status === "NOT_FOUND" && attempts < maxAttempts) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        response = await pollOnce();
      } catch (e: any) {
        if (isBadUnionSwitch(e)) return { success: true, transactionHash: hash };
      }
      attempts++;
    }

    console.log("[Vault] Soroban poll final status:", response.status, "attempts:", attempts);

    if (response.status === "SUCCESS") {
      return { success: true, transactionHash: hash };
    } else if (response.status === "FAILED") {
      throw new Error("Transaction failed on-chain");
    }

    // Still NOT_FOUND after 60s — Soroban RPC history window may have expired.
    // Fall back to Horizon which keeps permanent tx history.
    console.warn("[Vault] Soroban RPC timed out, checking Horizon for tx:", hash);
    const horizonStatus = await this.checkTxOnHorizon(hash);
    if (horizonStatus === "success") {
      console.log("[Vault] Horizon confirms transaction succeeded:", hash);
      return { success: true, transactionHash: hash };
    } else if (horizonStatus === "failed") {
      throw new Error("Transaction failed on-chain");
    }

    throw new Error(`Transaction confirmation timed out. Hash: ${hash}`);
  }

  // Check Horizon for a transaction — returns "success", "failed", or "not_found"
  private async checkTxOnHorizon(hash: string): Promise<"success" | "failed" | "not_found"> {
    try {
      const horizonUrl = process.env.REACT_APP_HORIZON_URL || "https://horizon.stellar.org";
      const res = await fetch(`${horizonUrl}/transactions/${hash}`);
      if (res.status === 404) return "not_found";
      if (!res.ok) return "not_found";
      const data = await res.json();
      return data.successful === true ? "success" : "failed";
    } catch {
      return "not_found";
    }
  }

  /**
   * Get total number of vault pools
   */
  async getPoolCount(): Promise<number> {
    try {
      const contract = new Contract(this.stakingContractId);
      const account = await this.getDummyAccount(); // Dummy account for simulation

      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(contract.call("get_pool_count"))
        .setTimeout(30)
        .build();

      const simulated = await this.simulateTx(tx);

      if (SorobanRpc.Api.isSimulationSuccess(simulated)) {
        const result = simulated.result?.retval;
        return result ? scValToNative(result) : 0;
      }

      throw new Error("Failed to simulate transaction");
    } catch (error) {
      console.error("Failed to get pool count:", error);
      return 0;
    }
  }

  /**
   * Get pool information by ID
   */
  async getPoolInfo(poolId: number): Promise<VaultPoolInfo> {
    try {
      const contract = new Contract(this.stakingContractId);
      const account = await this.getDummyAccount();

      const poolIdScVal = nativeToScVal(poolId, { type: "u32" });

      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(contract.call("get_pool_info", poolIdScVal))
        .setTimeout(30)
        .build();

      const simulated = await this.simulateTx(tx);

      if (SorobanRpc.Api.isSimulationSuccess(simulated)) {
        const result = simulated.result?.retval;
        const poolInfo = result ? scValToNative(result) : null;

        if (!poolInfo) throw new Error("Pool not found");

        // Fetch token symbols
        const token_a_code = await this.getTokenSymbol(poolInfo.token_a);
        const token_b_code = await this.getTokenSymbol(poolInfo.token_b);

        return {
          ...poolInfo,
          token_a_code,
          token_b_code,
          token_a_logo: this.getTokenLogo(token_a_code),
          token_b_logo: this.getTokenLogo(token_b_code),
        };
      }

      throw new Error("Failed to get pool info");
    } catch (error) {
      console.error(`Failed to get pool info for pool ${poolId}:`, error);
      throw error;
    }
  }

  /**
   * Get total vault shares for a pool (v1.8.0+)
   */
  async getVaultTotalShares(poolId: number): Promise<number> {
    try {
      const contract = new Contract(this.stakingContractId);
      const account = await this.getDummyAccount();

      const poolIdScVal = nativeToScVal(poolId, { type: "u32" });

      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(contract.call("get_vault_total_shares", poolIdScVal))
        .setTimeout(30)
        .build();

      const simulated = await this.simulateTx(tx);

      if (SorobanRpc.Api.isSimulationSuccess(simulated)) {
        const result = simulated.result?.retval;
        return result ? parseFloat(scValToNative(result)) : 0;
      }

      return 0;
    } catch (error) {
      console.error("Failed to get vault total shares:", error);
      return 0;
    }
  }

  /**
   * Get user's vault position for a specific pool
   */
  async getUserVaultPosition(
    userAddress: string,
    poolId: number,
    totalLpTokens?: string  // pass from already-fetched poolInfo to avoid double RPC
  ): Promise<VaultUserPosition | null> {
    try {
      const contract = new Contract(this.stakingContractId);
      const account = await this.getDummyAccount();

      const userScVal = nativeToScVal(userAddress, { type: "address" });
      const poolIdScVal = nativeToScVal(poolId, { type: "u32" });

      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(contract.call("get_user_vault_position", userScVal, poolIdScVal))
        .setTimeout(30)
        .build();

      const simulated = await this.simulateTx(tx);

      if (SorobanRpc.Api.isSimulationSuccess(simulated)) {
        const result = simulated.result?.retval;
        const position = result ? scValToNative(result) : null;

        if (!position || !position.active) {
          return null;
        }

        // v1.8.0+: share_ratio stores vault shares, not a ratio.
        // user_lp = user_shares * total_lp / total_shares
        const userShares = parseFloat(position.share_ratio);
        const rawLp = totalLpTokens ?? (await this.getPoolInfo(poolId)).total_lp_tokens;
        const totalLp = parseFloat(rawLp) / 1e7;
        const totalShares = await this.getVaultTotalShares(poolId);
        const userLpAmount = totalShares > 0 ? (totalLp * userShares / totalShares) : 0;
        const percentage = totalShares > 0 ? (userShares / totalShares * 100) : 0;

        return {
          ...position,
          user_lp_amount: userLpAmount.toFixed(7),
          percentage: percentage.toFixed(4),
        };
      }

      return null;
    } catch (error) {
      console.error("Failed to get user vault position:", error);
      return null;
    }
  }

  /**
   * Deposit tokens to vault pool
   */
  async vaultDeposit(params: {
    userAddress: string;
    poolId: number;
    desiredA: string;
    desiredB: string;
    minShares: string;
    walletName: string;
  }): Promise<{ success: boolean; error?: string; transactionHash?: string }> {
    try {
      const { userAddress, poolId, desiredA, desiredB, minShares, walletName } = params;
      console.log("[VaultDeposit] Starting deposit...", { userAddress, poolId, desiredA, desiredB, walletName });

      // Setup wallet - use existing WalletConnect kit for WalletConnect, create new kit for others
      let signKit: StellarWalletsKit;

      if (walletName === WALLET_CONNECT_ID || walletName === ("wallet_connect" as any)) {
        // Use the shared WalletConnect kit from Navbar
        signKit = walletConnectKit;
        await signKit.setWallet(WALLET_CONNECT_ID);
      } else {
        const selectedModule = walletName === LOBSTR_ID ? new LobstrModule() : new FreighterModule();
        const walletId = walletName === LOBSTR_ID ? LOBSTR_ID : FREIGHTER_ID;
        signKit = new StellarWalletsKit({
          network: WalletNetwork.PUBLIC,
          selectedWalletId: walletId,
          modules: [selectedModule],
        });
        await signKit.setWallet(walletId);
      }

      // Build transaction
      const contract = new Contract(this.stakingContractId);
      const account = await this.withRetry(() => this.server.getAccount(userAddress));

      const userScVal = nativeToScVal(userAddress, { type: "address" });
      const poolIdScVal = nativeToScVal(poolId, { type: "u32" });
      // Use BigInt to guarantee i128/u128 ScVal encoding — plain Number falls back to i32 for small values ("bad union switch 4")
      const desiredAScVal = nativeToScVal(BigInt(Math.round(parseFloat(desiredA) * 1e7)), { type: "i128" });
      const desiredBScVal = nativeToScVal(BigInt(Math.round(parseFloat(desiredB) * 1e7)), { type: "i128" });
      const minSharesScVal = nativeToScVal(BigInt(Math.round(parseFloat(minShares) * 1e7)), { type: "u128" });

      let tx = new TransactionBuilder(account, {
        fee: "1000000", // 1 XLM — required for Soroban mainnet inclusion; assembleTransaction adds resource fee on top
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          contract.call(
            "vault_deposit",
            userScVal,
            poolIdScVal,
            desiredAScVal,
            desiredBScVal,
            minSharesScVal
          )
        )
        .setTimeout(300) // 5 min TTL — prevents tx expiry during signing / submission lag
        .build();

      // Simulate to prepare transaction
      const simulated = await this.simulateTx(tx);

      if (SorobanRpc.Api.isSimulationError(simulated)) {
        throw new Error(`Simulation failed: ${simulated.error}`);
      }

      // Prepare transaction with auth
      tx = SorobanRpc.assembleTransaction(tx, simulated).build();

      // Sign transaction — with WalletConnect reconnect retry on stale session
      const txXdr = tx.toXDR();
      const signOpts = { address: userAddress, networkPassphrase: this.networkPassphrase };
      let signedTxXdr: string;
      try {
        ({ signedTxXdr } = await signKit.signTransaction(txXdr, signOpts));
      } catch (signErr: any) {
        const isWC = walletName === WALLET_CONNECT_ID || walletName === ("wallet_connect" as any);
        if (isWC && isWCConnectionError(signErr)) {
          console.warn("[Vault] WC session stale, reconnecting...", signErr.message);
          signKit = reconnectWalletConnect();
          await signKit.setWallet(WALLET_CONNECT_ID);
          ({ signedTxXdr } = await signKit.signTransaction(txXdr, signOpts));
        } else {
          throw signErr;
        }
      }

      // Submit via gateway FM (better for complex txs), poll via read RPC
      const signedTx = TransactionBuilder.fromXDR(signedTxXdr, this.networkPassphrase);
      console.log("[Vault] Submitting signed transaction...");
      const sendResponse = await this.sendServer.sendTransaction(signedTx as any);
      console.log("[Vault] Send response:", sendResponse.status, sendResponse.hash, (sendResponse as any).errorResult ?? "");

      if (sendResponse.status === "PENDING") {
        return await this.pollTransactionResult(sendResponse.hash);
      } else if (sendResponse.status === "ERROR") {
        console.error("[Vault] Send error:", (sendResponse as any).errorResult);
        throw new Error("Transaction send error");
      } else {
        throw new Error(`Unexpected send status: ${sendResponse.status}`);
      }
    } catch (error: any) {
      console.error("[VaultDeposit] Error:", error);
      return {
        success: false,
        error: error.message || "Deposit failed",
      };
    }
  }

  /**
   * Single-asset deposit to vault pool.
   * Deposits one token; the Aquarius AMM handles the internal swap.
   */
  async vaultDepositSingle(params: {
    userAddress: string;
    poolId: number;
    tokenIn: string;      // contract address of the token being deposited
    amountIn: string;      // human-readable amount (e.g. "100.5")
    minShares: string;
    walletName: string;
  }): Promise<{ success: boolean; error?: string; transactionHash?: string }> {
    try {
      const { userAddress, poolId, tokenIn, amountIn, minShares, walletName } = params;
      console.log("[VaultDepositSingle] Starting deposit...", { userAddress, poolId, tokenIn, amountIn, walletName });

      // Setup wallet
      let signKit: StellarWalletsKit;

      if (walletName === WALLET_CONNECT_ID || walletName === ("wallet_connect" as any)) {
        signKit = walletConnectKit;
        await signKit.setWallet(WALLET_CONNECT_ID);
      } else {
        const selectedModule = walletName === LOBSTR_ID ? new LobstrModule() : new FreighterModule();
        const walletId = walletName === LOBSTR_ID ? LOBSTR_ID : FREIGHTER_ID;
        signKit = new StellarWalletsKit({
          network: WalletNetwork.PUBLIC,
          selectedWalletId: walletId,
          modules: [selectedModule],
        });
        await signKit.setWallet(walletId);
      }

      // Build transaction
      const contract = new Contract(this.stakingContractId);
      const account = await this.withRetry(() => this.server.getAccount(userAddress));

      const userScVal = nativeToScVal(userAddress, { type: "address" });
      const poolIdScVal = nativeToScVal(poolId, { type: "u32" });
      const tokenInScVal = nativeToScVal(tokenIn, { type: "address" });
      const amountInScVal = nativeToScVal(BigInt(Math.round(parseFloat(amountIn) * 1e7)), { type: "i128" });
      const minSharesScVal = nativeToScVal(BigInt(Math.round(parseFloat(minShares) * 1e7)), { type: "u128" });

      let tx = new TransactionBuilder(account, {
        fee: "1000000",
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          contract.call(
            "vault_deposit_single",
            userScVal,
            poolIdScVal,
            tokenInScVal,
            amountInScVal,
            minSharesScVal
          )
        )
        .setTimeout(300)
        .build();

      // Simulate to prepare transaction
      const simulated = await this.simulateTx(tx);

      if (SorobanRpc.Api.isSimulationError(simulated)) {
        throw new Error(`Simulation failed: ${simulated.error}`);
      }

      // Prepare transaction with auth
      tx = SorobanRpc.assembleTransaction(tx, simulated).build();

      // Sign transaction
      const txXdr = tx.toXDR();
      const signOpts = { address: userAddress, networkPassphrase: this.networkPassphrase };
      let signedTxXdr: string;
      try {
        ({ signedTxXdr } = await signKit.signTransaction(txXdr, signOpts));
      } catch (signErr: any) {
        const isWC = walletName === WALLET_CONNECT_ID || walletName === ("wallet_connect" as any);
        if (isWC && isWCConnectionError(signErr)) {
          console.warn("[Vault] WC session stale, reconnecting...", signErr.message);
          signKit = reconnectWalletConnect();
          await signKit.setWallet(WALLET_CONNECT_ID);
          ({ signedTxXdr } = await signKit.signTransaction(txXdr, signOpts));
        } else {
          throw signErr;
        }
      }

      // Submit via gateway FM, poll via read RPC
      const signedTx = TransactionBuilder.fromXDR(signedTxXdr, this.networkPassphrase);
      console.log("[Vault] Submitting signed transaction...");
      const sendResponse = await this.sendServer.sendTransaction(signedTx as any);
      console.log("[Vault] Send response:", sendResponse.status, sendResponse.hash, (sendResponse as any).errorResult ?? "");

      if (sendResponse.status === "PENDING") {
        return await this.pollTransactionResult(sendResponse.hash);
      } else if (sendResponse.status === "ERROR") {
        console.error("[Vault] Send error:", (sendResponse as any).errorResult);
        throw new Error("Transaction send error");
      } else {
        throw new Error(`Unexpected send status: ${sendResponse.status}`);
      }
    } catch (error: any) {
      console.error("[VaultDepositSingle] Error:", error);
      return {
        success: false,
        error: error.message || "Single-asset deposit failed",
      };
    }
  }

  /**
   * Withdraw from vault pool
   */
  async vaultWithdraw(params: {
    userAddress: string;
    poolId: number;
    sharePercent: number;
    minA: string;
    minB: string;
    walletName: string;
  }): Promise<{ success: boolean; error?: string; transactionHash?: string }> {
    try {
      const { userAddress, poolId, sharePercent, minA, minB, walletName } = params;

      // Setup wallet - use existing WalletConnect kit for WalletConnect, create new kit for others
      let signKit: StellarWalletsKit;

      if (walletName === WALLET_CONNECT_ID || walletName === ("wallet_connect" as any)) {
        // Use the shared WalletConnect kit from Navbar
        signKit = walletConnectKit;
        await signKit.setWallet(WALLET_CONNECT_ID);
      } else {
        const selectedModule = walletName === LOBSTR_ID ? new LobstrModule() : new FreighterModule();
        const walletId = walletName === LOBSTR_ID ? LOBSTR_ID : FREIGHTER_ID;
        signKit = new StellarWalletsKit({
          network: WalletNetwork.PUBLIC,
          selectedWalletId: walletId,
          modules: [selectedModule],
        });
        await signKit.setWallet(walletId);
      }

      // Build transaction
      const contract = new Contract(this.stakingContractId);
      const account = await this.withRetry(() => this.server.getAccount(userAddress));

      const userScVal = nativeToScVal(userAddress, { type: "address" });
      const poolIdScVal = nativeToScVal(poolId, { type: "u32" });
      const sharePercentScVal = nativeToScVal(sharePercent, { type: "u32" });
      // Use BigInt to guarantee u128 ScVal encoding
      const minAScVal = nativeToScVal(BigInt(Math.round(parseFloat(minA) * 1e7)), { type: "u128" });
      const minBScVal = nativeToScVal(BigInt(Math.round(parseFloat(minB) * 1e7)), { type: "u128" });

      let tx = new TransactionBuilder(account, {
        fee: "1000000", // 1 XLM — required for Soroban mainnet inclusion
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          contract.call(
            "vault_withdraw",
            userScVal,
            poolIdScVal,
            sharePercentScVal,
            minAScVal,
            minBScVal
          )
        )
        .setTimeout(300) // 5 min TTL
        .build();

      // Simulate to prepare transaction
      const simulated = await this.simulateTx(tx);

      if (SorobanRpc.Api.isSimulationError(simulated)) {
        throw new Error(`Simulation failed: ${simulated.error}`);
      }

      // Prepare transaction with auth
      tx = SorobanRpc.assembleTransaction(tx, simulated).build();

      // Sign transaction — with WalletConnect reconnect retry on stale session
      const txXdr = tx.toXDR();
      const signOpts = { address: userAddress, networkPassphrase: this.networkPassphrase };
      let signedTxXdr: string;
      try {
        ({ signedTxXdr } = await signKit.signTransaction(txXdr, signOpts));
      } catch (signErr: any) {
        const isWC = walletName === WALLET_CONNECT_ID || walletName === ("wallet_connect" as any);
        if (isWC && isWCConnectionError(signErr)) {
          console.warn("[Vault] WC session stale, reconnecting...", signErr.message);
          signKit = reconnectWalletConnect();
          await signKit.setWallet(WALLET_CONNECT_ID);
          ({ signedTxXdr } = await signKit.signTransaction(txXdr, signOpts));
        } else {
          throw signErr;
        }
      }

      // Submit via gateway FM, poll via read RPC
      const signedTx = TransactionBuilder.fromXDR(signedTxXdr, this.networkPassphrase);
      console.log("[Vault] Submitting signed transaction...");
      const sendResponse = await this.sendServer.sendTransaction(signedTx as any);
      console.log("[Vault] Send response:", sendResponse.status, sendResponse.hash, (sendResponse as any).errorResult ?? "");

      if (sendResponse.status === "PENDING") {
        return await this.pollTransactionResult(sendResponse.hash);
      } else if (sendResponse.status === "ERROR") {
        console.error("[Vault] Send error:", (sendResponse as any).errorResult);
        throw new Error("Transaction send error");
      } else {
        throw new Error(`Unexpected send status: ${sendResponse.status}`);
      }
    } catch (error: any) {
      console.error("Vault withdraw error:", error);
      return {
        success: false,
        error: error.message || "Withdrawal failed",
      };
    }
  }

  // Helper methods

  // Known token contract addresses → symbol mapping to avoid RPC calls
  private static readonly KNOWN_TOKEN_SYMBOLS: Record<string, string> = {
    "CBMFDIRY5OKI4JJURXC4SMEQPWB4UUADIADJK4NA6CYBNOYK4W4TMLLF": "BLUB",
    "CAUIKL3IYGMERDRUN6YSCLWVAKIFG5Q4YJHUKM4S4NJZQIA3BAS6OJPK": "AQUA",
    "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA": "XLM",
    "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75": "USDC",
  };

  private async getTokenSymbol(tokenAddress: string): Promise<string> {
    // Check hardcoded map first — avoids RPC calls for all known tokens
    if (SorobanVaultService.KNOWN_TOKEN_SYMBOLS[tokenAddress]) {
      return SorobanVaultService.KNOWN_TOKEN_SYMBOLS[tokenAddress];
    }

    try {
      const contract = new Contract(tokenAddress);
      const account = await this.getDummyAccount();

      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(contract.call("symbol"))
        .setTimeout(30)
        .build();

      const simulated = await this.simulateTx(tx);

      if (SorobanRpc.Api.isSimulationSuccess(simulated)) {
        const result = simulated.result?.retval;
        const symbol = result ? scValToNative(result) : "UNKNOWN";
        // Convert "native" to "XLM" for display
        return symbol === "native" ? "XLM" : symbol;
      }

      return "UNKNOWN";
    } catch (error) {
      console.error(`Failed to get token symbol for ${tokenAddress}:`, error);
      return "UNKNOWN";
    }
  }

  private getTokenLogo(tokenCode: string): string {
    // Map token codes to logos in assets folder
    const tokenLogos: Record<string, string> = {
      AQUA: "/assets/images/aqua_logo.png",
      BLUB: "/Blub_logo2.svg",
      USDC: "/assets/images/usdc.svg",
      XLM: "/assets/images/xlm.png",
    };

    return tokenLogos[tokenCode] || "/assets/images/default-token.png";
  }

  /**
   * Fetch pool APY from Aquarius public API and compute compound APY.
   * @param poolAddress Aquarius pool contract address (C...)
   * API: https://amm-api.aqua.network/pools/{address}/
   * APY fields are decimal fractions: total_apy=0.9241 means 92.41%
   */
  async getAquariusPoolApy(poolAddress: string): Promise<{ poolApy: string; compoundApy: string; totalShare?: string }> {
    try {
      const res = await fetch(`https://amm-api.aqua.network/pools/${poolAddress}/`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      // total_apy = fee APY + AQUA rewards APY (decimal: 0.924 = 92.4%)
      const rawApy = data.total_apy ?? data.rewards_apy ?? data.apy;

      // total_share from API is authoritative for LP supply (avoids inflated on-chain values)
      let totalShare: string | undefined;
      if (data.total_share != null) {
        const ts = Number(data.total_share);
        if (!isNaN(ts) && ts > 0) {
          totalShare = (ts / 1e7).toFixed(7);
        }
      }

      if (rawApy == null) return { poolApy: "--", compoundApy: "--", totalShare };

      const apyDecimal = parseFloat(rawApy);
      if (isNaN(apyDecimal)) return { poolApy: "--", compoundApy: "--", totalShare };

      // Compound APY: 24 auto-compounds per day × 365 = 8,760 per year.
      // Cadence kept in sync with whalehub-server's staking-reward cron
      // (`'0 * * * *'` — hourly; was every 30 min until 2026-05-10).
      // Contract takes a 15% treasury fee on claimed rewards (vault_fee_bps=1500,
      // set on-chain 2026-05-16) before they reach vault depositors, so the
      // compounded APY is computed on the net 85%. POL/staking gets an extra
      // 17.65% deducted in the backend before BLUB distribution; vault is untouched.
      const n = 24 * 365;
      const compoundApy = (Math.pow(1 + (apyDecimal * 0.85) / n, n) - 1) * 100;

      return {
        poolApy: (apyDecimal * 100).toFixed(2),
        compoundApy: compoundApy.toFixed(2),
        totalShare,
      };
    } catch (error) {
      console.warn("Failed to fetch Aquarius pool APY:", error);
      return { poolApy: "--", compoundApy: "--" };
    }
  }

  /**
   * Get pool reserves (token amounts in the pool) and total LP supply.
   * tokenA / tokenB are the pool's token_a and token_b contract addresses;
   * they are used to correct for Aquarius's internal alphabetical token ordering.
   */
  async getPoolReserves(
    poolAddress: string,
    lpTokenAddress: string,
    tokenA?: string,
    tokenB?: string,
  ): Promise<{
    reserveA: string;
    reserveB: string;
    totalLpSupply: string;
  }> {
    try {
      const poolContract = new Contract(poolAddress);
      const account = await this.getDummyAccount();

      // Get reserves
      const reservesTx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(poolContract.call("get_reserves"))
        .setTimeout(30)
        .build();

      // Try get_total_shares on pool
      const totalSharesTx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(poolContract.call("get_total_shares"))
        .setTimeout(30)
        .build();

      // Try share_id to get the actual LP token address from pool
      const shareIdTx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(poolContract.call("share_id"))
        .setTimeout(30)
        .build();

      const [reservesSim, totalSharesSim, shareIdSim] = await Promise.all([
        this.simulateTx(reservesTx),
        this.simulateTx(totalSharesTx),
        this.simulateTx(shareIdTx),
      ]);

      let reserveA = "0", reserveB = "0", totalLpSupply = "0";

      if (SorobanRpc.Api.isSimulationSuccess(reservesSim)) {
        const result = reservesSim.result?.retval;
        const reserves = result ? scValToNative(result) : [0, 0];
        const raw0 = Number(reserves[0] || 0);
        const raw1 = Number(reserves[1] || 0);
        // Aquarius stores tokens in alphabetical order by contract address.
        // If pool's tokenA comes after tokenB alphabetically, Aquarius has
        // [tokenB, tokenA] internally → swap so reserveA = tokenA's reserve.
        if (tokenA && tokenB && tokenA > tokenB) {
          reserveA = (raw1 / 1e7).toFixed(7);
          reserveB = (raw0 / 1e7).toFixed(7);
        } else {
          reserveA = (raw0 / 1e7).toFixed(7);
          reserveB = (raw1 / 1e7).toFixed(7);
        }
      }

      // Try get_total_shares from pool
      if (SorobanRpc.Api.isSimulationSuccess(totalSharesSim)) {
        const result = totalSharesSim.result?.retval;
        const supply = result ? scValToNative(result) : 0;
        const supplyNum = typeof supply === 'bigint' ? Number(supply) : Number(supply);
        if (supplyNum > 0) {
          totalLpSupply = (supplyNum / 1e7).toFixed(7);
        }
      }

      // If still 0, try to get LP token from share_id and query its total_supply
      if (totalLpSupply === "0" && SorobanRpc.Api.isSimulationSuccess(shareIdSim)) {
        const result = shareIdSim.result?.retval;
        const actualLpToken = result ? scValToNative(result) : null;

        if (actualLpToken) {
          const lpContract = new Contract(actualLpToken);
          const supplyTx = new TransactionBuilder(account, {
            fee: BASE_FEE,
            networkPassphrase: this.networkPassphrase,
          })
            .addOperation(lpContract.call("total_supply"))
            .setTimeout(30)
            .build();

          const supplySim = await this.simulateTx(supplyTx);
          if (SorobanRpc.Api.isSimulationSuccess(supplySim)) {
            const supplyResult = supplySim.result?.retval;
            const supply = supplyResult ? scValToNative(supplyResult) : 0;
            const supplyNum = typeof supply === 'bigint' ? Number(supply) : Number(supply);
            if (supplyNum > 0) {
              totalLpSupply = (supplyNum / 1e7).toFixed(7);
            }
          }
        }
      }

      // Last fallback: try total_supply on provided lpTokenAddress
      if (totalLpSupply === "0") {
        const lpContract = new Contract(lpTokenAddress);
        const supplyTx = new TransactionBuilder(account, {
          fee: BASE_FEE,
          networkPassphrase: this.networkPassphrase,
        })
          .addOperation(lpContract.call("total_supply"))
          .setTimeout(30)
          .build();

        const supplySim = await this.simulateTx(supplyTx);
        if (SorobanRpc.Api.isSimulationSuccess(supplySim)) {
          const supplyResult = supplySim.result?.retval;
          const supply = supplyResult ? scValToNative(supplyResult) : 0;
          const supplyNum = typeof supply === 'bigint' ? Number(supply) : Number(supply);
          if (supplyNum > 0) {
            totalLpSupply = (supplyNum / 1e7).toFixed(7);
          }
        }
      }

      return { reserveA, reserveB, totalLpSupply };
    } catch (error) {
      console.error("Failed to get pool reserves:", error);
      return { reserveA: "0", reserveB: "0", totalLpSupply: "0" };
    }
  }

  /**
   * Get token balance for a user
   */
  async getTokenBalance(tokenAddress: string, userAddress: string): Promise<string> {
    try {
      // For native XLM, return spendable balance (total - reserves) via Horizon
      const NATIVE_XLM_SAC = "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA";
      if (tokenAddress === NATIVE_XLM_SAC) {
        return await this.getNativeSpendableBalance(userAddress);
      }

      const contract = new Contract(tokenAddress);
      const account = await this.getDummyAccount();

      const userScVal = nativeToScVal(userAddress, { type: "address" });

      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(contract.call("balance", userScVal))
        .setTimeout(30)
        .build();

      const simulated = await this.simulateTx(tx);

      if (SorobanRpc.Api.isSimulationSuccess(simulated)) {
        const result = simulated.result?.retval;
        const balance = result ? scValToNative(result) : 0;
        // Convert from stroops (7 decimals) to human readable
        return (Number(balance) / 1e7).toFixed(7);
      }

      return "0";
    } catch (error) {
      console.error(`Failed to get token balance for ${tokenAddress}:`, error);
      return "0";
    }
  }

  private async getNativeSpendableBalance(userAddress: string): Promise<string> {
    try {
      const horizonUrl = process.env.REACT_APP_HORIZON_URL || "https://horizon.stellar.org";
      const res = await fetch(`${horizonUrl}/accounts/${userAddress}`);
      if (!res.ok) return "0";
      const acc = await res.json();
      const totalXlm = parseFloat(acc.balances.find((b: any) => b.asset_type === "native")?.balance || "0");
      const subentryCount = acc.subentry_count || 0;
      const numSponsoring = acc.num_sponsoring || 0;
      const numSponsored = acc.num_sponsored || 0;
      // Stellar reserve: 1 base + 0.5 per subentry + sponsoring adjustments
      const reserve = 1 + (subentryCount + numSponsoring - numSponsored) * 0.5;
      const spendable = Math.max(0, totalXlm - reserve);
      return spendable.toFixed(7);
    } catch (error) {
      console.error("Failed to get native spendable balance:", error);
      return "0";
    }
  }
  /**
   * Get compound stats for a vault pool
   */
  async getPoolCompoundStats(poolId: number): Promise<{
    totalCompoundedLp: string;
    totalRewardsClaimed: string;
    totalTreasuryFees: string;
    lastCompoundTime: number;
    compoundCount: number;
  }> {
    try {
      const contract = new Contract(this.stakingContractId);
      const account = await this.getDummyAccount();

      const poolIdScVal = nativeToScVal(poolId, { type: "u32" });

      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(contract.call("get_pool_compound_stats", poolIdScVal))
        .setTimeout(30)
        .build();

      const simulated = await this.simulateTx(tx);

      if (SorobanRpc.Api.isSimulationSuccess(simulated)) {
        const result = simulated.result?.retval;
        const stats = result ? scValToNative(result) : null;

        if (stats) {
          return {
            totalCompoundedLp: (Number(stats.total_compounded_lp || 0) / 1e7).toFixed(7),
            totalRewardsClaimed: (Number(stats.total_rewards_claimed || 0) / 1e7).toFixed(7),
            totalTreasuryFees: (Number(stats.total_treasury_fees || 0) / 1e7).toFixed(7),
            lastCompoundTime: Number(stats.last_compound_time || 0),
            compoundCount: Number(stats.compound_count || 0),
          };
        }
      }

      return { totalCompoundedLp: "0", totalRewardsClaimed: "0", totalTreasuryFees: "0", lastCompoundTime: 0, compoundCount: 0 };
    } catch (error) {
      console.error("Failed to get pool compound stats:", error);
      return { totalCompoundedLp: "0", totalRewardsClaimed: "0", totalTreasuryFees: "0", lastCompoundTime: 0, compoundCount: 0 };
    }
  }

  /**
   * Get user's compound gains for a specific pool
   */
  async getUserCompoundGains(userAddress: string, poolId: number): Promise<{
    currentLp: string;
    depositedLp: string;
    compoundGainLp: string;
  }> {
    try {
      const contract = new Contract(this.stakingContractId);
      const account = await this.getDummyAccount();

      const userScVal = nativeToScVal(userAddress, { type: "address" });
      const poolIdScVal = nativeToScVal(poolId, { type: "u32" });

      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(contract.call("get_user_compound_gains", userScVal, poolIdScVal))
        .setTimeout(30)
        .build();

      const simulated = await this.simulateTx(tx);

      if (SorobanRpc.Api.isSimulationSuccess(simulated)) {
        const result = simulated.result?.retval;
        const data = result ? scValToNative(result) : null;

        if (data && Array.isArray(data) && data.length >= 3) {
          return {
            currentLp: (Number(data[0] || 0) / 1e7).toFixed(7),
            depositedLp: (Number(data[1] || 0) / 1e7).toFixed(7),
            compoundGainLp: (Number(data[2] || 0) / 1e7).toFixed(7),
          };
        }
      }

      return { currentLp: "0", depositedLp: "0", compoundGainLp: "0" };
    } catch (error) {
      console.error("Failed to get user compound gains:", error);
      return { currentLp: "0", depositedLp: "0", compoundGainLp: "0" };
    }
  }

  /**
   * ICE boost calculation using Aquarius Curve-style formula:
   * boost = min(0.4×deposit + 0.6×pool_liquidity×(my_ICE/total_ICE), deposit) / (0.4×deposit)
   *
   * - deposit = our LP tokens in the pool (contract + admin)
   * - pool_liquidity = total LP in the Aquarius pool
   * - my_ICE = admin wallet's ICE balance
   * - total_ICE = total ICE supply across all holders
   *
   * Returns boost multiplier (1.0 = no boost, 2.5 = max) and supporting data.
   * Recalculated by Aquarius every hour; we cache for 5 min.
   */
  async getIceBoostInfo(
    poolAddress: string,
    shareToken: string,
    totalPoolLp?: string,
  ): Promise<IceBoostInfo> {
    try {
      // Admin wallet that holds ICE
      const ADMIN_ADDRESS = process.env.REACT_APP_MANAGER_ADDRESS || "GDERSSCKJQPPXUQOZIOXGRVAGNLVPVZCJ2MAX7RCMVMWGRPVAEG7XGTK";
      // ICE token SAC address
      const ICE_TOKEN = process.env.REACT_APP_ICE_TOKEN || "CARCKZ66U4AI2545NS4RAF47QVEXG3PRRCDA52H4Q3FDRAGSMP4BRU3W";
      // ICE classic asset issuer (for total supply from Horizon)
      const ICE_ISSUER = "GA7YJSQJ4TPSKPM36BTB26B3WBUCUERSA7JCYWPBAA3CWYV7ZYEYLOBS";

      // 1. Get our LP in this pool (contract LP)
      const contractLpStr = await this.getTokenBalance(shareToken, this.stakingContractId);
      const contractLp = parseFloat(contractLpStr);

      // 2. Get total pool LP (use provided value or query pool contract)
      let poolLp = 0;
      if (totalPoolLp && parseFloat(totalPoolLp) > 0) {
        poolLp = parseFloat(totalPoolLp);
      } else {
        // Query pool contract get_total_shares
        const poolContract = new Contract(poolAddress);
        const account = await this.getDummyAccount();
        const tx = new TransactionBuilder(account, {
          fee: BASE_FEE,
          networkPassphrase: this.networkPassphrase,
        })
          .addOperation(poolContract.call("get_total_shares"))
          .setTimeout(30)
          .build();
        const sim = await this.simulateTx(tx);
        if (SorobanRpc.Api.isSimulationSuccess(sim) && sim.result?.retval) {
          poolLp = Number(scValToNative(sim.result.retval)) / 1e7;
        }
      }

      if (poolLp <= 0 || contractLp <= 0) {
        return { boost: 1.0, myIce: 0, totalIce: 0, ourLp: contractLp, poolLp, lpSharePct: 0, maxLpFor2_5x: 0 };
      }

      // 3. Get admin's ICE balance
      const myIceStr = await this.getTokenBalance(ICE_TOKEN, ADMIN_ADDRESS);
      const myIce = parseFloat(myIceStr);

      // 4. Get total ICE supply from Horizon
      let totalIce = 0;
      try {
        const horizonUrl = process.env.REACT_APP_HORIZON_URL || "https://horizon.stellar.org";
        const res = await fetch(`${horizonUrl}/assets?asset_code=ICE&asset_issuer=${ICE_ISSUER}`);
        if (res.ok) {
          const data = await res.json();
          const record = data?._embedded?.records?.[0];
          if (record?.balances?.authorized) {
            totalIce = parseFloat(record.balances.authorized);
          }
        }
      } catch {
        // If Horizon fails, we can't compute boost
      }

      if (totalIce <= 0 || myIce <= 0) {
        return { boost: 1.0, myIce, totalIce, ourLp: contractLp, poolLp, lpSharePct: (contractLp / poolLp) * 100, maxLpFor2_5x: 0 };
      }

      // 5. Compute boost
      const iceShare = myIce / totalIce;
      const deposit = contractLp;
      const numerator = Math.min(0.4 * deposit + 0.6 * poolLp * iceShare, deposit);
      const boost = numerator / (0.4 * deposit);

      // Max LP that would still get 2.5x: when iceShare >= deposit/poolLp
      const maxLpFor2_5x = iceShare * poolLp;

      return {
        boost: Math.min(boost, 2.5),
        myIce,
        totalIce,
        ourLp: contractLp,
        poolLp,
        lpSharePct: (contractLp / poolLp) * 100,
        maxLpFor2_5x,
      };
    } catch (error) {
      console.warn("Failed to compute ICE boost:", error);
      return { boost: 1.0, myIce: 0, totalIce: 0, ourLp: 0, poolLp: 0, lpSharePct: 0, maxLpFor2_5x: 0 };
    }
  }
}

export interface IceBoostInfo {
  boost: number;         // 1.0 – 2.5
  myIce: number;         // admin's ICE balance
  totalIce: number;      // total ICE supply
  ourLp: number;         // our LP in the pool (contract)
  poolLp: number;        // total LP in the pool
  lpSharePct: number;    // our LP share %
  maxLpFor2_5x: number;  // max LP that still gets full 2.5x
}

/**
 * Token price fetching service for USD value calculations
 */
export class TokenPriceService {
  private static priceCache: Map<string, { price: number; timestamp: number }> = new Map();
  private static CACHE_TTL = 60000; // 1 minute cache

  /**
   * Get token price in USD.
   * On fetch failure, returns stale cached price rather than 0.
   */
  static async getTokenPrice(tokenCode: string): Promise<number> {
    const now = Date.now();
    const cached = this.priceCache.get(tokenCode);

    if (cached && now - cached.timestamp < this.CACHE_TTL) {
      return cached.price;
    }

    try {
      // USDC is always $1
      if (tokenCode === "USDC") {
        this.priceCache.set(tokenCode, { price: 1, timestamp: now });
        return 1;
      }

      // CoinGecko public API (supports CORS, no proxy needed)
      const cgBase = "https://api.coingecko.com/api/v3";

      // Batch fetch XLM + AQUA in one call to reduce rate-limit hits
      if (tokenCode === "XLM" || tokenCode === "AQUA") {
        const response = await fetch(
          `${cgBase}/simple/price?ids=stellar,aquarius&vs_currencies=usd`
        );
        if (!response.ok) throw new Error(`CoinGecko ${response.status}`);
        const text = await response.text();
        if (text.startsWith("<")) throw new Error("CoinGecko returned HTML");
        const data = JSON.parse(text);

        const xlmPrice = data?.stellar?.usd || 0;
        const aquaPrice = data?.aquarius?.usd || 0;
        if (xlmPrice > 0) this.priceCache.set("XLM", { price: xlmPrice, timestamp: now });
        if (aquaPrice > 0) this.priceCache.set("AQUA", { price: aquaPrice, timestamp: now });

        const price = tokenCode === "XLM" ? xlmPrice : aquaPrice;
        return price || cached?.price || 0;
      }

      // BLUB is pegged 1:1 to AQUA, use AQUA price
      if (tokenCode === "BLUB") {
        const aquaPrice = await this.getTokenPrice("AQUA");
        if (aquaPrice > 0) this.priceCache.set(tokenCode, { price: aquaPrice, timestamp: now });
        return aquaPrice || cached?.price || 0;
      }

      // Default: return 0 for unknown tokens
      return 0;
    } catch (error) {
      console.error(`Failed to fetch price for ${tokenCode}:`, error);
      // Return stale cached price on error instead of 0
      return cached?.price || 0;
    }
  }

  /**
   * Calculate total USD value of token amounts.
   * If pool reserves are provided and one token's price is unavailable,
   * derives the missing price from the pool ratio and the known price.
   */
  static async calculateTotalUsdValue(
    tokenACode: string,
    tokenAAmount: number,
    tokenBCode: string,
    tokenBAmount: number,
    reserveA?: number,
    reserveB?: number
  ): Promise<number> {
    // Sequential fetch: ensures derived prices (e.g. BLUB → AQUA → XLM) hit the cache
    // on the second call rather than firing duplicate concurrent API requests that can fail.
    let priceA = await this.getTokenPrice(tokenACode);
    let priceB = await this.getTokenPrice(tokenBCode);

    // Derive missing price from pool reserves ratio
    if (priceA === 0 && priceB > 0 && reserveA && reserveB && reserveA > 0) {
      priceA = (reserveB / reserveA) * priceB;
    } else if (priceB === 0 && priceA > 0 && reserveA && reserveB && reserveB > 0) {
      priceB = (reserveA / reserveB) * priceA;
    }

    const valueA = tokenAAmount * priceA;
    const valueB = tokenBAmount * priceB;

    return valueA + valueB;
  }
}
