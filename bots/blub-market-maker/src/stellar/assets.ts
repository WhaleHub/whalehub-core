import { Asset } from "@stellar/stellar-sdk";
import { AQUA_CODE, AQUA_ISSUER, BLUB_CODE, BLUB_ISSUER } from "../constants.js";

export const AQUA = new Asset(AQUA_CODE, AQUA_ISSUER);
export const BLUB = new Asset(BLUB_CODE, BLUB_ISSUER);

/** True if a balance line (from Horizon) matches the given classic asset. */
export function isAsset(
  balance: { asset_code?: string; asset_issuer?: string; asset_type?: string },
  asset: Asset,
): boolean {
  return balance.asset_code === asset.code && balance.asset_issuer === asset.issuer;
}
