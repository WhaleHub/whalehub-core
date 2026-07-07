/**
 * V2 dashboard — new WhaleHub features built in isolation so the existing app
 * (Stake / Compound / Vaults / Leverage) is never touched. Reachable at /v2.
 *
 * Feature 2 (multi-pair yield farming) lives here first; features 3–6 will be
 * added as sections/tabs on this same v2 surface.
 */
import React, { useState } from "react";
import { SOROBAN_CONFIG } from "../../config/soroban.config";
import VaultCard, { VaultConfig } from "./VaultCard";
import DepositEntry from "./DepositEntry";
import RestakeToggle from "./RestakeToggle";
import Analytics from "./Analytics";

const ENABLED_KEY = "wh_v2_enabled_vaults";

const V2: React.FC = () => {
  const vaults = (SOROBAN_CONFIG as { vaults?: VaultConfig[] }).vaults ?? [];

  // Feature 4: per-vault participation, persisted locally.
  const [enabled, setEnabled] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(ENABLED_KEY);
      return new Set<string>(raw ? JSON.parse(raw) : []);
    } catch {
      return new Set<string>();
    }
  });

  const toggle = (vault: VaultConfig, next: boolean) => {
    setEnabled((prev) => {
      const s = new Set(prev);
      if (next) s.add(vault.key);
      else s.delete(vault.key);
      try {
        localStorage.setItem(ENABLED_KEY, JSON.stringify(Array.from(s)));
      } catch {
        /* ignore */
      }
      return s;
    });
  };

  const selectedCount = vaults.filter((v) => enabled.has(v.key)).length;

  return (
    <div className="min-h-screen bg-[#0E111B] text-white">
      <div className="max-w-[1000px] mx-auto px-4 py-10">
        <div className="text-center mb-8">
          <div className="text-xs uppercase tracking-[0.18em] text-[#00cc99] font-semibold">
            WhaleHub v2
          </div>
          <h1 className="text-3xl md:text-4xl font-semibold mt-2">
            Multi-pair yield farming
          </h1>
          <p className="text-[#B1B3B8] mt-3 max-w-[620px] mx-auto">
            Provide liquidity across curated Aquarius pairs. WhaleHub supplies
            pooled-ICE-boosted LP and auto-compounds the rewards for you — no
            epoch-by-epoch vote management.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
          {/* Feature 3 + 5: deposit entry points + auto-restake toggle */}
          <div className="lg:col-span-1 lg:sticky lg:top-6 flex flex-col gap-5">
            <DepositEntry
              vaults={vaults}
              onDeposit={(asset, amount, route) => {
                // Swap+deposit wiring lands with the vault deposit flow.
                console.log("[v2] deposit", amount, asset, "->", route.vault?.key);
              }}
            />
            <RestakeToggle
              onChange={(on) => console.log("[v2] auto-restake", on)}
            />
          </div>

          {/* Feature 2 + 4: vault cards with participation toggles */}
          <div className="lg:col-span-2 flex flex-col gap-5">
            {/* Feature 4: selection summary — layers with the staking position */}
            <div className="rounded-2xl border border-[#1C2235] bg-[#0E111B] px-5 py-3 flex items-center justify-between">
              <span className="text-[13px] text-[#B1B3B8]">
                <span className="text-white font-medium">{selectedCount}</span>{" "}
                vault{selectedCount === 1 ? "" : "s"} on — combined with your
                staking position for layered yield
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {vaults.map((v) => (
                <VaultCard
                  key={v.key}
                  vault={v}
                  apr={null}
                  enabled={enabled.has(v.key)}
                  onToggle={toggle}
                  onDeposit={(vault) => {
                    console.log("[v2] deposit requested for", vault.key);
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Feature 6: analytics + yield projections */}
        {vaults.length > 0 && <Analytics vaults={vaults} />}

        {vaults.length === 0 && (
          <div className="text-center text-[#6B7280] mt-10">
            No vaults configured.
          </div>
        )}
      </div>
    </div>
  );
};

export default V2;
