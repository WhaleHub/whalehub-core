import { Networks } from "@stellar/stellar-sdk";

// Network configuration
// This determines if the app runs on mainnet or testnet
const getRequiredEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `❌ [Config] Missing required environment variable: ${key}. Please set it in your .env file.`
    );
  }
  return value;
};

export const isMainnet =
  getRequiredEnv("REACT_APP_STELLAR_NETWORK") === "mainnet";

// Network constants - use these throughout the app for consistency
export const STELLAR_NETWORK = isMainnet ? Networks.PUBLIC : Networks.TESTNET;
// v2 kit uses `Networks` (passphrase strings); WALLET_NETWORK is just the passphrase.
export const WALLET_NETWORK = STELLAR_NETWORK;
export const MIN_DEPOSIT_AMOUNT = 0.01;
export const MAX_FEE_TO_DEPOSIT = 0.014;
export const MINUTE_IN_MS = 60000;
export const DAY_IN_SECOND = 86400;
export const YEAR_IN_DAY = 365;
export const VOTE_COOLDOWN = 10 * 86400;
export const TOKEN_STAKING_EPOCH = 7 * 86400; // 7days;
export const TOKEN_STAKING_COOLDOWN = 7 * 86400; // 7days;
export const UNBOINDING_PERIOD = 5; // 5 Epoch
export const CONTRACT_DEPLOYED_AT = 1708214181;
