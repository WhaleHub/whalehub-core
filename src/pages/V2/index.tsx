/**
 * V2 dashboard — new WhaleHub features built in isolation so the existing app
 * (Stake / Compound / Vaults / Leverage) is never touched. Reachable at /v2.
 *
 * Feature 2 (multi-pair yield farming) lives here first; features 3–6 will be
 * added as sections/tabs on this same v2 surface.
 */
import React from "react";
import { SOROBAN_CONFIG } from "../../config/soroban.config";
import VaultCard, { VaultConfig } from "./VaultCard";
import DepositEntry from "./DepositEntry";

const V2: React.FC = () => {
  const vaults = (SOROBAN_CONFIG as { vaults?: VaultConfig[] }).vaults ?? [];

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
          {/* Feature 3: deposit entry points (XLM/USDC/EURC auto-routed) */}
          <div className="lg:col-span-1 lg:sticky lg:top-6">
            <DepositEntry
              vaults={vaults}
              onDeposit={(asset, amount, route) => {
                // Swap+deposit wiring lands with the vault deposit flow.
                console.log("[v2] deposit", amount, asset, "->", route.vault?.key);
              }}
            />
          </div>

          {/* Feature 2: vault cards */}
          <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-5">
            {vaults.map((v) => (
              <VaultCard
                key={v.key}
                vault={v}
                apr={null}
                onDeposit={(vault) => {
                  console.log("[v2] deposit requested for", vault.key);
                }}
              />
            ))}
          </div>
        </div>

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
