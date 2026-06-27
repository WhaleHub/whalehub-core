// Leveraged LP Farming — dedicated page (kept fully separate from the homepage).
// A header entry point will be added later. Renders nothing useful until the
// REACT_APP_LEVERAGE_VAULT_CONTRACT_ID (+ stack) env vars are set on testnet.
//
// See docs/technical/leveraged-lp-farming.md and the leverage-vault contract.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import type { RootState } from "../../lib/store";
import { SOROBAN_CONFIG } from "../../config/soroban.config";
import { isMainnet } from "../../config";
import {
  sorobanLeverageService,
  type LeverageConfig,
  type LeverageUserPosition,
} from "../../services/soroban-leverage.service";

const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-white/60">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  suffix,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  suffix?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-white/50">{label}</span>
      <div className="flex items-center rounded-xl border border-white/10 bg-black/30 px-3">
        <input
          // type="text" + inputMode avoids browser-locale comma formatting (see frontend-notes memory)
          type="text"
          inputMode="decimal"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value.replace(/,/g, "."))}
          className="w-full bg-transparent py-3 text-white outline-none placeholder:text-white/25"
        />
        {suffix && <span className="pl-2 text-xs text-white/40">{suffix}</span>}
      </div>
    </label>
  );
}

export default function Leverage() {
  const user = useSelector((state: RootState) => state.user);
  const configured = sorobanLeverageService.isConfigured();

  const [config, setConfig] = useState<LeverageConfig | null>(null);
  const [position, setPosition] = useState<LeverageUserPosition | null>(null);
  const [totals, setTotals] = useState<{ totalCollateralLp: string; totalDebt: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  // Open form
  const [collateralLp, setCollateralLp] = useState("");
  const [borrowAmount, setBorrowAmount] = useState("");
  const [slippagePct, setSlippagePct] = useState("1.0");

  // Close form
  const [repayAmount, setRepayAmount] = useState("");
  const [withdrawLp, setWithdrawLp] = useState("");

  const maxLeverageX = useMemo(
    () => (config ? (config.maxLeverageBps / 10_000).toFixed(2) : "—"),
    [config]
  );

  const refresh = useCallback(async () => {
    if (!configured) return;
    setLoading(true);
    try {
      const [cfg, tot] = await Promise.all([
        sorobanLeverageService.getConfig(),
        sorobanLeverageService.getTotals(),
      ]);
      setConfig(cfg);
      setTotals(tot);
      if (user?.userWalletAddress) {
        setPosition(await sorobanLeverageService.getPosition(user.userWalletAddress));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [configured, user?.userWalletAddress]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // NOTE: a precise minLpOut/minPairOut must come from simulating the zap against
  // live AMM reserves once the testnet AMM is deployed. Until then we derive a
  // conservative floor from the user's slippage tolerance and the naive 50/50 split.
  // This is intentionally pessimistic and flagged for replacement.
  const estimateMins = useCallback(() => {
    const borrow = parseFloat(borrowAmount || "0");
    const slip = Math.max(0, parseFloat(slippagePct || "0")) / 100;
    const half = borrow / 2;
    // Placeholder: assumes ~1:1 value and applies slippage haircut. Replace with a
    // real AMM quote (reserves-based) before mainnet.
    const minPairOut = (half * (1 - slip)).toFixed(7);
    const minLpOut = (borrow * (1 - slip)).toFixed(7);
    return { minLpOut, minPairOut };
  }, [borrowAmount, slippagePct]);

  const onOpen = async () => {
    if (!user?.userWalletAddress) return toast.warn("Please connect wallet.");
    if (!borrowAmount || parseFloat(borrowAmount) <= 0) return toast.warn("Enter a borrow amount.");
    const { minLpOut, minPairOut } = estimateMins();
    setBusy(true);
    try {
      const res = await sorobanLeverageService.openPosition({
        userAddress: user.userWalletAddress,
        walletName: user.walletName || "freighter",
        collateralLpAmount: collateralLp || "0",
        borrowAmount,
        minLpOut,
        minPairOut,
      });
      if (res.success) {
        toast.success("Leverage position opened.");
        setCollateralLp("");
        setBorrowAmount("");
        await refresh();
      } else {
        toast.error(res.error || "Open failed.");
      }
    } finally {
      setBusy(false);
    }
  };

  const onClose = async () => {
    if (!user?.userWalletAddress) return toast.warn("Please connect wallet.");
    if ((!repayAmount || parseFloat(repayAmount) <= 0) && (!withdrawLp || parseFloat(withdrawLp) <= 0)) {
      return toast.warn("Enter a repay and/or withdraw amount.");
    }
    setBusy(true);
    try {
      const res = await sorobanLeverageService.repayAndWithdraw({
        userAddress: user.userWalletAddress,
        walletName: user.walletName || "freighter",
        repayAmount: repayAmount || "0",
        withdrawLpAmount: withdrawLp || "0",
      });
      if (res.success) {
        toast.success("Position unwound.");
        setRepayAmount("");
        setWithdrawLp("");
        await refresh();
      } else {
        toast.error(res.error || "Unwind failed.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 text-white">
      <header className="mb-8">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Leveraged LP Farming</h1>
          <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-300">
            {isMainnet ? "Beta" : "Testnet"}
          </span>
        </div>
        <p className="mt-2 max-w-2xl text-sm text-white/50">
          Use your LP position as collateral on Blend, flash-borrow against it, and recycle
          into more LP — multiplying your farming exposure in a single transaction.
          Leverage amplifies both yield and liquidation risk.
        </p>
      </header>

      {!configured ? (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-6 text-sm text-amber-200/90">
          <p className="font-semibold">Feature not yet configured.</p>
          <p className="mt-2 text-amber-200/70">
            Set <code>REACT_APP_LEVERAGE_VAULT_CONTRACT_ID</code> and the related{" "}
            <code>REACT_APP_LEVERAGE_*</code> / <code>REACT_APP_BLEND_POOL_ID</code> env vars
            (see <code>.env.example</code>) after deploying the leverage vault on testnet —
            runbook in <code>soroban-contracts/leverage-vault/DEPLOY.md</code>.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {/* Overview */}
          <Card title="Vault">
            <dl className="space-y-2 text-sm">
              <Row k="Blend pool" v={short(config?.blendPool)} />
              <Row k="AMM pool" v={short(config?.ammPool)} />
              <Row k="LP collateral token" v={short(config?.lpToken)} />
              <Row k="Borrow asset" v={short(config?.borrowAsset)} />
              <Row k="Max leverage" v={`${maxLeverageX}×`} />
              <Row k="Total collateral (LP)" v={totals?.totalCollateralLp ?? "—"} />
              <Row k="Total debt" v={totals?.totalDebt ?? "—"} />
            </dl>
          </Card>

          {/* User position */}
          <Card title="Your position">
            {user?.userWalletAddress ? (
              <dl className="space-y-2 text-sm">
                <Row k="Collateral (LP)" v={position?.collateralLp ?? "0"} />
                <Row k="Debt (borrow asset)" v={position?.debt ?? "0"} />
              </dl>
            ) : (
              <p className="text-sm text-white/40">Connect your wallet to view your position.</p>
            )}
            <button
              onClick={refresh}
              disabled={loading}
              className="mt-4 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/70 hover:bg-white/5 disabled:opacity-50"
            >
              {loading ? "Refreshing…" : "↺ Refresh"}
            </button>
          </Card>

          {/* Open */}
          <Card title="Open / add leverage">
            <div className="space-y-3">
              <Field
                label="LP collateral to supply (optional)"
                value={collateralLp}
                onChange={setCollateralLp}
                placeholder="0.0"
                suffix="LP"
              />
              <Field
                label="Amount to flash-borrow & recycle"
                value={borrowAmount}
                onChange={setBorrowAmount}
                placeholder="0.0"
                suffix="borrow asset"
              />
              <Field
                label="Slippage tolerance"
                value={slippagePct}
                onChange={setSlippagePct}
                placeholder="1.0"
                suffix="%"
              />
              <button
                onClick={onOpen}
                disabled={busy || !user?.userWalletAddress}
                className="w-full rounded-xl bg-[#37b06f] py-3 font-semibold text-black hover:brightness-110 disabled:opacity-50"
              >
                {busy ? "Working…" : "Open leveraged position"}
              </button>
              <p className="text-[11px] leading-relaxed text-white/35">
                Min-out floors are derived from your slippage tolerance. A precise
                reserves-based quote is wired once the testnet AMM is live.
              </p>
            </div>
          </Card>

          {/* Close */}
          <Card title="Repay & withdraw (unwind)">
            <div className="space-y-3">
              <Field
                label="Repay debt (funds pulled from your wallet)"
                value={repayAmount}
                onChange={setRepayAmount}
                placeholder="0.0"
                suffix="borrow asset"
              />
              <Field
                label="Withdraw collateral"
                value={withdrawLp}
                onChange={setWithdrawLp}
                placeholder="0.0"
                suffix="LP"
              />
              <button
                onClick={onClose}
                disabled={busy || !user?.userWalletAddress}
                className="w-full rounded-xl border border-white/15 py-3 font-semibold text-white hover:bg-white/5 disabled:opacity-50"
              >
                {busy ? "Working…" : "Repay & withdraw"}
              </button>
              <p className="text-[11px] leading-relaxed text-white/35">
                v1 unwind requires you to supply the repay funds. Flash-loan self-closing is a
                planned follow-up.
              </p>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-white/45">{k}</dt>
      <dd className="font-mono text-white/90">{v}</dd>
    </div>
  );
}
