/**
 * V2 — Analytics & yield projections (feature 6).
 * Projects expected APR (fees + emissions + ICE boost), shows the rewards
 * split, and a historical-performance sparkline — so users see the picture
 * before depositing. Values are placeholders until the live contract-state
 * feed is wired (getPoolInfo / reward events / APY indexer).
 */
import React from "react";
import { VaultConfig } from "./VaultCard";

interface Projection {
  baseFeesApr: number; // trading fees
  emissionsApr: number; // AQUA emissions
  iceBoostApr: number; // WhaleHub pooled-ICE amplification
  history: number[]; // recent daily APR points
}

// Placeholder projection until live queries are wired. Deterministic per key
// so cards stay stable (no Math.random).
function projectionFor(v: VaultConfig): Projection {
  const seed = v.key.length + v.name.length;
  const base = v.poolType === "stable" ? 4 : 9;
  const emissions = v.status === "live" ? 18 + (seed % 6) : 0;
  const boost = v.status === "live" ? 22 + (seed % 8) : 0;
  const total = base + emissions + boost;
  const history = Array.from({ length: 14 }, (_, i) =>
    Math.max(0, total + Math.sin(i + seed) * 6)
  );
  return {
    baseFeesApr: base,
    emissionsApr: emissions,
    iceBoostApr: boost,
    history,
  };
}

const Sparkline: React.FC<{ points: number[] }> = ({ points }) => {
  const w = 240;
  const h = 48;
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const range = max - min || 1;
  const d = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - ((p - min) / range) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="w-full">
      <path d={d} fill="none" stroke="#00cc99" strokeWidth={2} />
    </svg>
  );
};

const Bar: React.FC<{ label: string; value: number; total: number; color: string }> = ({
  label,
  value,
  total,
  color,
}) => (
  <div className="flex items-center gap-3 text-[12px]">
    <span className="w-24 text-[#6B7280]">{label}</span>
    <div className="flex-1 h-2 rounded-full bg-[#0E111B] overflow-hidden">
      <div
        className="h-full rounded-full"
        style={{ width: `${total ? (value / total) * 100 : 0}%`, background: color }}
      />
    </div>
    <span className="w-14 text-right text-white">{value.toFixed(1)}%</span>
  </div>
);

const Analytics: React.FC<{ vaults: VaultConfig[] }> = ({ vaults }) => {
  const live = vaults.filter((v) => v.status === "live");
  const shown = live.length ? live : vaults.slice(0, 1);

  return (
    <div className="mt-8">
      <h2 className="text-xl font-semibold mb-1">Analytics &amp; projections</h2>
      <p className="text-[13px] text-[#6B7280] mb-4">
        Expected APR, rewards split, and recent performance — before you deposit.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {shown.map((v) => {
          const p = projectionFor(v);
          const total = p.baseFeesApr + p.emissionsApr + p.iceBoostApr;
          return (
            <div
              key={v.key}
              className="rounded-2xl border border-[#1C2235] bg-[#151A29] p-5"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="text-white font-medium">{v.name}</div>
                <div className="text-right">
                  <div className="text-[11px] text-[#6B7280]">Projected APR</div>
                  <div className="text-xl font-semibold text-[#1fe0a8]">
                    {total.toFixed(1)}%
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-2 mb-4">
                <Bar label="Trading fees" value={p.baseFeesApr} total={total} color="#3a827f" />
                <Bar label="Emissions" value={p.emissionsApr} total={total} color="#0aa0c4" />
                <Bar label="ICE boost" value={p.iceBoostApr} total={total} color="#00cc99" />
              </div>

              <div className="text-[11px] text-[#6B7280] mb-1">14-day APR</div>
              <Sparkline points={p.history} />
            </div>
          );
        })}
      </div>
      <div className="text-[11px] text-[#4b5163] mt-3">
        Projections are estimates from pool composition + WhaleHub's ICE-boost
        allocation; live contract-state feed replaces these placeholders.
      </div>
    </div>
  );
};

export default Analytics;
