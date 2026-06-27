// Ambient declarations for @creit.tech/stellar-wallets-kit v2 module subpaths.
//
// v2 ships these via the package `exports` map (webpack 5 resolves them at build time),
// but our tsconfig uses `moduleResolution: "node"` (classic), which ignores `exports`.
// These declarations let tsc/fork-ts-checker resolve the imports used in src/lib/walletKit.ts.

declare module "@creit.tech/stellar-wallets-kit/modules/freighter" {
  export const FREIGHTER_ID: string;
  // `any` so the instance satisfies the kit's ModuleInterface without re-declaring it.
  export const FreighterModule: any;
}

declare module "@creit.tech/stellar-wallets-kit/modules/lobstr" {
  export const LOBSTR_ID: string;
  export const LobstrModule: any;
}

declare module "@creit.tech/stellar-wallets-kit/modules/xbull" {
  export const XBULL_ID: string;
  export const xBullModule: any;
}

declare module "@creit.tech/stellar-wallets-kit/modules/wallet-connect" {
  export const WALLET_CONNECT_ID: string;
  export const WalletConnectModule: any;
  export enum WalletConnectAllowedMethods {
    SIGN = "stellar_signXDR",
    SIGN_AND_SUBMIT = "stellar_signAndSubmitXDR",
    SIGN_MESSAGE = "stellar_signMessage",
    SIGN_AUTH_ENTRY = "stellar_signAuthEntry",
  }
  export enum WalletConnectTargetChain {
    PUBLIC = "stellar:pubnet",
    TESTNET = "stellar:testnet",
  }
}
