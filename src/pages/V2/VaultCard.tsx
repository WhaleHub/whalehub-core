/**
 * V2 — Vault card (feature 2: multi-pair yield farming).
 * Self-contained; does NOT touch the existing Vaults/AddLiquidity components.
 */
import React from "react";

export interface VaultConfig {
  key: string;
  name: string;
  assetA: string;
  assetB: string;
  poolType: "volatile" | "stable";
  aquariusPool: string;
  poolId: number | null;
  status: "live" | "activating";
}

interface Props {
  vault: VaultConfig;
  apr?: number | null; // live APR once wired; null = not yet available
  onDeposit?: (vault: VaultConfig) => void;
}

const VaultCard: React.FC<Props> = ({ vault, apr, onDeposit }) => {
  const isLive = vault.status === "live";
  return (
    <div className="rounded-2xl border border-[#1C2235] bg-[#151A29] p-5 flex flex-col gap-4 transition-colors hover:border-[#2a3050]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex -space-x-2">
            <span className="w-8 h-8 rounded-full bg-[#0E111B] border border-[#2a3050] grid place-items-center text-xs text-white">
              {vault.assetA.slice(0, 3)}
            </span>
            <span className="w-8 h-8 rounded-full bg-[#0E111B] border border-[#2a3050] grid place-items-center text-xs text-white">
              {vault.assetB.slice(0, 3)}
            </span>
          </div>
          <div>
            <div className="text-white font-medium">{vault.name}</div>
            <div className="text-[11px] uppercase tracking-wider text-[#6B7280]">
              {vault.poolType === "stable" ? "Stable pool" : "Volatile pool"}
            </div>
          </div>
        </div>
        <span
          className={
            "text-[11px] px-2.5 py-1 rounded-full font-medium " +
            (isLive
              ? "bg-[rgba(0,204,153,0.1)] text-[#1fe0a8] border border-[rgba(0,204,153,0.24)]"
              : "bg-[rgba(252,211,77,0.08)] text-[#fcd34d] border border-[rgba(252,211,77,0.22)]")
          }
        >
          {isLive ? "Live" : "Activating"}
        </span>
      </div>

      <div className="flex items-end justify-between">
        <div>
          <div className="text-[12px] text-[#6B7280]">Est. APR</div>
          <div className="text-2xl font-semibold text-white">
            {apr != null ? `${apr.toFixed(2)}%` : "—"}
          </div>
        </div>
        <div className="text-right text-[11px] text-[#6B7280] max-w-[160px]">
          Auto-compounded · ICE-boosted emissions
        </div>
      </div>

      <button
        disabled={!isLive}
        onClick={() => isLive && onDeposit?.(vault)}
        className={
          "w-full rounded-xl py-3 text-sm font-semibold transition-transform " +
          (isLive
            ? "text-white bg-[linear-gradient(120deg,#00e0a3_0%,#0aa0c4_52%,#0b6aa6_100%)] hover:-translate-y-0.5"
            : "text-[#6B7280] bg-[#1C2235] cursor-not-allowed")
        }
      >
        {isLive ? "Deposit" : "Coming soon"}
      </button>
    </div>
  );
};

export default VaultCard;
