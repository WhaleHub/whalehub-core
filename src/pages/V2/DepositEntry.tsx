/**
 * V2 — Deposit entry points (feature 3).
 * User picks XLM / USDC / EURC + amount; the deposit is auto-routed into the
 * optimal vault based on which pairs the asset belongs to (and, for assets not
 * directly in a pair, via a swap into the deepest stable vault).
 * Self-contained; routing preview only — the on-chain swap+deposit is wired
 * with the vault deposit flow once pools are registered.
 */
import React, { useMemo, useState } from "react";
import { VaultConfig } from "./VaultCard";

type Entry = "XLM" | "USDC" | "EURC";
const ENTRIES: Entry[] = ["XLM", "USDC", "EURC"];

interface Route {
  vault: VaultConfig | null;
  viaSwap: boolean;
}

/** Pick the best vault for a deposit asset from the configured vaults. */
function routeFor(asset: Entry, vaults: VaultConfig[]): Route {
  const contains = vaults.filter(
    (v) => v.assetA === asset || v.assetB === asset
  );
  const live = contains.find((v) => v.status === "live");
  if (live) return { vault: live, viaSwap: false };
  if (contains.length) return { vault: contains[0], viaSwap: false };
  // Asset not directly in any pair (e.g. EURC) -> route via swap to the
  // deepest stable vault so the deposit still earns.
  const stable = vaults.find((v) => v.poolType === "stable");
  return { vault: stable ?? vaults[0] ?? null, viaSwap: true };
}

interface Props {
  vaults: VaultConfig[];
  onDeposit?: (asset: Entry, amount: string, route: Route) => void;
}

const DepositEntry: React.FC<Props> = ({ vaults, onDeposit }) => {
  const [asset, setAsset] = useState<Entry>("USDC");
  const [amount, setAmount] = useState("");

  const route = useMemo(() => routeFor(asset, vaults), [asset, vaults]);
  const canDeposit =
    Boolean(route.vault) && Number(amount) > 0 && route.vault?.status === "live";

  return (
    <div className="rounded-2xl border border-[#1C2235] bg-[#151A29] p-5">
      <div className="text-white font-medium mb-1">Deposit</div>
      <div className="text-[13px] text-[#6B7280] mb-4">
        Deposit XLM, USDC, or EURC — we auto-route it into the best vault.
      </div>

      {/* asset tabs */}
      <div className="flex gap-2 mb-4">
        {ENTRIES.map((e) => (
          <button
            key={e}
            onClick={() => setAsset(e)}
            className={
              "flex-1 rounded-xl py-2 text-sm font-medium border transition-colors " +
              (asset === e
                ? "border-[#00cc99] text-white bg-[rgba(0,204,153,0.08)]"
                : "border-[#2a3050] text-[#B1B3B8] hover:text-white")
            }
          >
            {e}
          </button>
        ))}
      </div>

      {/* amount */}
      <div className="flex items-center rounded-xl border border-[#2a3050] bg-[#0E111B] px-4 py-3 mb-4">
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
          inputMode="decimal"
          placeholder="0.00"
          className="bg-transparent flex-1 text-white text-lg outline-none"
        />
        <span className="text-[#6B7280] text-sm">{asset}</span>
      </div>

      {/* routing preview */}
      <div className="flex items-center justify-between text-[13px] mb-4">
        <span className="text-[#6B7280]">Routes to</span>
        <span className="text-[#B1B3B8]">
          {route.vault ? (
            <>
              {route.viaSwap && (
                <span className="text-[#fcd34d]">swap → </span>
              )}
              <span className="text-white">{route.vault.name}</span>
              {route.vault.status !== "live" && (
                <span className="text-[#fcd34d]"> (activating)</span>
              )}
            </>
          ) : (
            "—"
          )}
        </span>
      </div>

      <button
        disabled={!canDeposit}
        onClick={() => canDeposit && onDeposit?.(asset, amount, route)}
        className={
          "w-full rounded-xl py-3 text-sm font-semibold transition-transform " +
          (canDeposit
            ? "text-white bg-[linear-gradient(120deg,#00e0a3_0%,#0aa0c4_52%,#0b6aa6_100%)] hover:-translate-y-0.5"
            : "text-[#6B7280] bg-[#1C2235] cursor-not-allowed")
        }
      >
        {route.vault && route.vault.status !== "live"
          ? "Vault activating soon"
          : "Deposit"}
      </button>
    </div>
  );
};

export default DepositEntry;
