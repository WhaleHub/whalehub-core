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
import aquaLogo from "../../assets/images/aqua_logo.png";
import usdcLogo from "../../assets/images/usdc.svg";
import xlmLogo from "../../assets/images/xlm.png";

const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");

const TOKEN_LOGOS: Record<string, string> = {
  AQUA: aquaLogo,
  USDC: usdcLogo,
  XLM: xlmLogo,
  BLUB: "/blub_logo.png",
};

const markets = SOROBAN_CONFIG.leverage.markets;
type Market = (typeof markets)[number];

function TokenIcon({ code, size = 20 }: { code: string; size?: number }) {
  const src = TOKEN_LOGOS[code];
  if (!src) {
    return (
      <span
        className="inline-flex items-center justify-center rounded-full bg-white/10 text-[9px] text-white/70"
        style={{ width: size, height: size }}
      >
        {code.slice(0, 3)}
      </span>
    );
  }
  return (
    <img src={src} alt={code} className="rounded-full" style={{ width: size, height: size }} />
  );
}

/** Overlapping pair icons (token A over token B). */
function PairIcons({ a, b, size = 22 }: { a: string; b: string; size?: number }) {
  return (
    <span className="inline-flex items-center" style={{ width: size * 1.6 }}>
      <TokenIcon code={a} size={size} />
      <span style={{ marginLeft: -size / 3 }}>
        <TokenIcon code={b} size={size} />
      </span>
    </span>
  );
}

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

  const [selectedId, setSelectedId] = useState<string>(markets[0]?.id ?? "");
  const market: Market | undefined = useMemo(
    () => markets.find((m) => m.id === selectedId) ?? markets[0],
    [selectedId]
  );

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
    if (!configured || !market?.vault) return;
    setLoading(true);
    try {
      // Point the service at the selected market's vault before reading.
      sorobanLeverageService.setVault(market.vault);
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
  }, [configured, market?.vault, user?.userWalletAddress]);

  // Reset inputs + reload whenever the market changes.
  useEffect(() => {
    setConfig(null);
    setPosition(null);
    setTotals(null);
    setCollateralLp("");
    setBorrowAmount("");
    setRepayAmount("");
    setWithdrawLp("");
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
    if (!market?.vault) return;
    if (market.status === "activating")
      return toast.info("This market isn't live yet — its Blend reserve is still unlocking.");
    if (!borrowAmount || parseFloat(borrowAmount) <= 0) return toast.warn("Enter a borrow amount.");
    const { minLpOut, minPairOut } = estimateMins();
    sorobanLeverageService.setVault(market.vault);
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
    if (!market?.vault) return;
    if ((!repayAmount || parseFloat(repayAmount) <= 0) && (!withdrawLp || parseFloat(withdrawLp) <= 0)) {
      return toast.warn("Enter a repay and/or withdraw amount.");
    }
    sorobanLeverageService.setVault(market.vault);
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

      {/* ── Market selector ─────────────────────────────────────────── */}
      {configured && (
        <section className="mb-8">
          <p className="mb-2 text-xs uppercase tracking-wide text-white/40">Market</p>
          <div className="flex flex-wrap gap-3">
            {markets.map((m) => {
              const active = m.id === selectedId;
              return (
                <button
                  key={m.id}
                  onClick={() => setSelectedId(m.id)}
                  className={`flex items-center gap-3 rounded-2xl border px-4 py-3 transition ${
                    active
                      ? "border-[#37b06f]/60 bg-[#37b06f]/10"
                      : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
                  }`}
                >
                  <PairIcons a={m.tokenA} b={m.tokenB} />
                  <span className="text-left">
                    <span className="block text-sm font-semibold text-white">{m.label}</span>
                    <span className="block text-[11px] text-white/45">
                      collateral · borrow {m.borrowSymbol}
                    </span>
                  </span>
                  {m.status === "live" ? (
                    <span className="rounded-full bg-[#37b06f]/15 px-2 py-0.5 text-[10px] font-medium text-[#37b06f]">
                      Live
                    </span>
                  ) : (
                    <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                      Activating
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {market?.status === "activating" && (
            <p className="mt-2 text-[11px] text-amber-300/70">
              {market.note || "This market is not live yet."} — its Blend collateral reserve is in
              a 1-week activation timelock; reads work, opening is disabled until it unlocks.
            </p>
          )}
        </section>
      )}

      {/* ── Explainers ───────────────────────────────────────────────── */}
      <section className="mb-8 grid grid-cols-1 gap-5 md:grid-cols-3">
        <Card title="How it works">
          <ol className="space-y-2 text-sm text-white/70">
            <li><span className="text-white/40">1.</span> You supply an LP token as collateral (your equity).</li>
            <li><span className="text-white/40">2.</span> The vault <span className="text-white/90">flash-borrows</span> a stable asset against it.</li>
            <li><span className="text-white/40">3.</span> It <span className="text-white/90">zaps</span> the borrow into more LP (swap half → add liquidity).</li>
            <li><span className="text-white/40">4.</span> All the LP is supplied as collateral; the borrow stays as debt.</li>
            <li><span className="text-white/40">5.</span> Result: an <span className="text-white/90">N× LP position</span> — all in one atomic transaction.</li>
          </ol>
          <p className="mt-3 text-[11px] leading-relaxed text-white/35">
            Example: deposit 1,000 of LP, borrow 2,000 → you control 3,000 of LP (3× exposure)
            with 2,000 of debt.
          </p>
        </Card>

        <Card title="Where the yield comes from">
          <p className="text-sm text-white/70">
            Leverage doesn't create yield — it <span className="text-white/90">multiplies</span> the
            LP's underlying yield, which comes from:
          </p>
          <ul className="mt-2 space-y-1 text-sm text-white/70">
            <li>• AMM <span className="text-white/90">trading fees</span></li>
            <li>• <span className="text-white/90">Liquidity-mining incentives</span> (AQUA / BLUB rewards, bribes)</li>
          </ul>
          <div className="mt-3 rounded-lg border border-white/10 bg-black/30 p-3 font-mono text-[11px] text-emerald-300/90">
            Net APY = L · LP_APY − (L−1) · Borrow_APR
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-white/35">
            At 3× with a 20% LP and 5% borrow: 3·20 − 2·5 = <span className="text-emerald-300/80">~50% APY</span>.
            Profitable only while <span className="text-white/60">LP yield &gt; borrow cost</span>.
          </p>
        </Card>

        <Card title="Risks">
          <ul className="space-y-2 text-sm text-white/70">
            <li>
              <span className="text-amber-300/90">Liquidation</span> — if the LP value falls vs your
              debt, Blend liquidates your collateral. Leverage shrinks the safety buffer.
            </li>
            <li>
              <span className="text-amber-300/90">Negative carry</span> — if the borrow rate rises
              above the LP yield, a leveraged position loses money.
            </li>
            <li>
              <span className="text-amber-300/90">Impermanent loss &amp; slippage</span> — amplified by
              leverage; the zap swaps cost slippage on entry/exit.
            </li>
          </ul>
          <p className="mt-3 text-[11px] leading-relaxed text-white/35">
            Watch your health factor and keep leverage conservative. Never use funds you can't
            afford to have liquidated.
          </p>
        </Card>
      </section>

      <div className="mb-8 rounded-xl border border-sky-500/20 bg-sky-500/[0.06] p-4 text-xs leading-relaxed text-sky-200/80">
        <span className="font-semibold text-sky-200">{isMainnet ? "Beta." : "Testnet."}</span>{" "}
        {isMainnet
          ? "This is an early release — start small and verify your health factor before sizing up."
          : "This screen operates on Stellar testnet (separate from the rest of the app). Switch your wallet to testnet to interact. Yields here are simulated — the flow is real, but there are no live incentives on testnet."}
      </div>

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
          <Card title="Market">
            <div className="mb-3 flex items-center gap-3">
              <PairIcons a={market?.tokenA ?? ""} b={market?.tokenB ?? ""} size={26} />
              <div>
                <div className="text-base font-semibold text-white">{market?.label}</div>
                <div className="text-[11px] text-white/45">
                  {market?.tokenA}/{market?.tokenB} LP collateral · borrow {market?.borrowSymbol}
                </div>
              </div>
            </div>
            <dl className="space-y-2 text-sm">
              <Row k="Status" v={market?.status === "live" ? "Live" : "Activating (~7d)"} />
              <Row k="Blend pool" v={short(market?.blendPool)} />
              <Row k="AMM (LP token)" v={short(market?.amm)} />
              <Row k="Vault" v={short(market?.vault)} />
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
                disabled={busy || !user?.userWalletAddress || market?.status === "activating"}
                className="w-full rounded-xl bg-[#37b06f] py-3 font-semibold text-black hover:brightness-110 disabled:opacity-50"
              >
                {busy
                  ? "Working…"
                  : market?.status === "activating"
                  ? "Market activating (~7d)"
                  : "Open leveraged position"}
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
