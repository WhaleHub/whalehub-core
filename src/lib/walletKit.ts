// Central Stellar Wallets Kit (v2) bootstrap + v1 compatibility layer.
//
// v2 is a STATIC singleton (`StellarWalletsKit.init(...)` once, then static methods, and
// `authModal()` replaced `openModal`). The app was written against the v1 instance API
// (`new StellarWalletsKit({...})`, `kit.openModal(...)`). Rather than rewrite ~50 call
// sites, this module:
//   1. Performs the one-time v2 `init()` with the real modules (incl. Reown WalletConnect).
//   2. Exports a `CompatKit` instance-class (as `StellarWalletsKit`) whose methods delegate
//      to the real static kit, and whose `openModal` bridges to v2 `authModal`.
//   3. Exports no-op module shims + a `WalletNetwork` shim so existing imports compile.
// Every consumer imports the kit from HERE instead of the package. See
// memory/wallet_kit_v2_migration.md.

import { StellarWalletsKit as RealKit, Networks } from "@creit.tech/stellar-wallets-kit";
import {
  FreighterModule as RealFreighterModule,
  FREIGHTER_ID,
} from "@creit.tech/stellar-wallets-kit/modules/freighter";
import {
  LobstrModule as RealLobstrModule,
  LOBSTR_ID,
} from "@creit.tech/stellar-wallets-kit/modules/lobstr";
import {
  xBullModule as RealXBullModule,
  XBULL_ID,
} from "@creit.tech/stellar-wallets-kit/modules/xbull";
import {
  WalletConnectModule as RealWalletConnectModule,
  WALLET_CONNECT_ID,
  WalletConnectAllowedMethods,
  WalletConnectTargetChain,
} from "@creit.tech/stellar-wallets-kit/modules/wallet-connect";
import { isMainnet } from "../config";

export type { ISupportedWallet } from "@creit.tech/stellar-wallets-kit";

const NETWORK = isMainnet ? Networks.PUBLIC : Networks.TESTNET;

let initialized = false;
export function ensureKitInitialized(): void {
  if (initialized) return;
  // Reown AppKit (v2 WalletConnect modal) needs a DOM; guard non-browser evaluation.
  if (typeof window === "undefined") return;
  try {
    RealKit.init({
      network: NETWORK,
      modules: [
        new RealFreighterModule(),
        new RealLobstrModule(),
        new RealXBullModule(),
        new RealWalletConnectModule({
          projectId: "3dcbb538e6a1ff9db2cdbf0b1c209a9d",
          metadata: {
            name: "Whalehub",
            description: "WhaleHub: stake AQUA, earn BLUB rewards",
            url: "https://app.whalehub.io",
            icons: ["https://app.whalehub.io/Blub_logo2.svg"],
          },
          allowedChains: [
            isMainnet ? WalletConnectTargetChain.PUBLIC : WalletConnectTargetChain.TESTNET,
          ],
        }),
      ],
    });
    initialized = true;
  } catch (e) {
    console.error("[walletKit] init failed:", e);
  }
}

ensureKitInitialized();

type SignOpts = { networkPassphrase?: string; address?: string; path?: string };

/**
 * v1-compatible instance facade over the v2 static kit. All real work goes to the single
 * static `RealKit`; constructor options (network/modules/selectedWalletId) are ignored
 * because the static kit is already configured — call sites always `setWallet(...)` before
 * signing, which still selects the active module.
 */
export class StellarWalletsKit {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_opts?: unknown) {
    ensureKitInitialized();
  }
  setWallet(id: string): void {
    RealKit.setWallet(id);
  }
  getAddress(): Promise<{ address: string }> {
    return RealKit.getAddress();
  }
  signTransaction(xdr: string, opts?: SignOpts): Promise<{ signedTxXdr: string; signerAddress?: string }> {
    return RealKit.signTransaction(xdr, opts);
  }
  signAuthEntry(entry: string, opts?: SignOpts): Promise<{ signedAuthEntry: string; signerAddress?: string }> {
    return RealKit.signAuthEntry(entry, opts);
  }
  disconnect(): Promise<void> {
    return RealKit.disconnect();
  }
  /**
   * Bridges the v1 `openModal({onWalletSelected, onClosed})` API onto v2 `authModal()`.
   * v2 selects the wallet + fetches the address internally and resolves with `{address}`;
   * we forward the resolved wallet id to `onWalletSelected` (whose body re-runs
   * setWallet/getAddress harmlessly), or call `onClosed` if the user dismisses.
   */
  async openModal(opts: {
    onWalletSelected?: (wallet: any) => void | Promise<void>;
    onClosed?: (err?: Error) => void;
    modalTitle?: string;
    notAvailableText?: string;
  }): Promise<void> {
    try {
      await RealKit.authModal();
      const mod = RealKit.selectedModule as unknown as { productId?: string; id?: string };
      const id = mod?.productId ?? mod?.id ?? WALLET_CONNECT_ID;
      if (opts?.onWalletSelected) await opts.onWalletSelected({ id } as any);
    } catch (e) {
      opts?.onClosed?.(e as Error);
    }
  }
  authModal(params?: { container?: HTMLElement }): Promise<{ address: string }> {
    return RealKit.authModal(params);
  }
}

// --- No-op module shims (the real modules are registered once in init above) ---
export class FreighterModule {}
export class LobstrModule {}
export class xBullModule {}
export class WalletConnectModule {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_opts?: unknown) {}
}
export const allowAllModules = (): unknown[] => [];
// v1 required registering this web component before openModal; v2 ships its own modal.
export const StellarWalletsModal: unknown = undefined;

/** v1 `WalletNetwork` enum shim — values are network passphrase strings. */
export const WalletNetwork = {
  PUBLIC: Networks.PUBLIC,
  TESTNET: Networks.TESTNET,
} as const;
// Type counterpart so existing `: WalletNetwork` / `as WalletNetwork` annotations compile.
export type WalletNetwork = (typeof WalletNetwork)[keyof typeof WalletNetwork];

/** v1 exposed a recreatable `kit` instance + `reconnectWalletConnect`; v2 is a singleton. */
export const kit = new StellarWalletsKit();
export const walletConnectKit = kit;
export function reconnectWalletConnect(): StellarWalletsKit {
  ensureKitInitialized();
  return kit;
}

export {
  Networks,
  FREIGHTER_ID,
  LOBSTR_ID,
  XBULL_ID,
  WALLET_CONNECT_ID,
  WalletConnectAllowedMethods,
  WalletConnectTargetChain,
};
