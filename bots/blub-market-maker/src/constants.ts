import { Networks } from "@stellar/stellar-sdk";

/**
 * On-chain identifiers for the BLUB/AQUA market. All verified live on Stellar mainnet.
 * Classic issuers are used for SDEX offers; contract (SAC) addresses for reading the
 * Aquarius Soroban pool reserves.
 */

// Classic assets (SDEX)
export const AQUA_CODE = "AQUA";
export const AQUA_ISSUER =
  "GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA";
export const BLUB_CODE = "BLUB";
export const BLUB_ISSUER =
  "GDERSSCKJQPPXUQOZIOXGRVAGNLVPVZCJ2MAX7RCMVMWGRPVAEG7XGTK";

// Soroban token contract (SAC) addresses — used only for reading pool reserves.
export const AQUA_CONTRACT =
  "CAUIKL3IYGMERDRUN6YSCLWVAKIFG5Q4YJHUKM4S4NJZQIA3BAS6OJPK";
export const BLUB_CONTRACT =
  "CBMFDIRY5OKI4JJURXC4SMEQPWB4UUADIADJK4NA6CYBNOYK4W4TMLLF";

// Aquarius StableSwap BLUB/AQUA pool (read-only reference in v1)
export const POOL_ADDRESS =
  "CAMXZXXBD7DFBLYLHUW24U4MY37X7SU5XXT5ZVVUBXRXWLAIM7INI7G2";
export const POOL_AMP = 1500; // StableSwap amplification `a`
export const POOL_FEE = 0.0005; // 0.05%

// Aquarius off-chain pathfinding (optional cross-check)
export const AMM_API_BASE = "https://amm-api.aqua.network/api/external/v2";

// Read-only burner account for Soroban simulations (no funds, seq irrelevant).
export const DUMMY_ACCOUNT =
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

// 7-decimal fixed point (Stellar stroops)
export const STROOP_SCALE = 1e7;

export function passphraseFor(network: string): string {
  const n = network.toLowerCase();
  return n === "public" || n === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;
}
