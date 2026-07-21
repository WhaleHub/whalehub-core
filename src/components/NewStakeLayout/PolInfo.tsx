import { useEffect, useState, useMemo } from "react";
import { useSelector } from "react-redux";
import { InformationCircleIcon } from "@heroicons/react/16/solid";
import { TailSpin } from "react-loader-spinner";
import { SorobanVaultService, TokenPriceService, IceBoostInfo } from "../../services/soroban-vault.service";
import { useTokenPrice, formatUsd } from "../../hooks/useTokenPrice";
import { RootState } from "../../lib/store";

interface PoolStats {
  // POL's share of the pool
  polReserveA: string;
  polReserveB: string;
  polUsdValue: string;
  polLp: string;
  polSharePercent: string;
  // Pool-level info
  tokenACode: string;
  tokenBCode: string;
  totalLp: string;
  poolApy: string;
  compoundApy: string;
  iceBoost: IceBoostInfo | null;
}

interface PolInfoProps {
  onDialogOpen: (msg: string, title: string) => void;
}

// Format number with comma separators and specified decimals
const fmtNum = (val: string | number, decimals = 2): string => {
  const n = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(n)) return "0";
  return n.toFixed(decimals).replace(/,/g, ".").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
};

function PolInfo({ onDialogOpen }: PolInfoProps) {
  const [stats, setStats] = useState<PoolStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const staking = useSelector((state: RootState) => state.staking);
  const blubPrice = useTokenPrice("BLUB");
  const aquaPrice = useTokenPrice("AQUA");

  const vaultService = useMemo(() => new SorobanVaultService(), []);

  useEffect(() => {
    let cancelled = false;

    const fetchPoolStats = async () => {
      try {
        // Pool 0 is the BLUB-AQUA POL pool
        const poolInfo = await vaultService.getPoolInfo(0);
        if (cancelled) return;

        const stakingContractId = process.env.REACT_APP_STAKING_CONTRACT_ID || "";

        const [apyData, reservesData, contractLpBalance] = await Promise.all([
          vaultService.getAquariusPoolApy(poolInfo.pool_address),
          vaultService.getPoolReserves(
            poolInfo.pool_address,
            poolInfo.share_token,
            poolInfo.token_a,
            poolInfo.token_b,
          ),
          // Contract's total LP token balance (POL + vault users).
          // The on-chain `aqua_blub_lp_position` field is stale/under-tracked since
          // POL has historically entered the contract via multiple paths that did not
          // all bump the counter, so we approximate: POL = contract_lp_balance − vault_lp.
          // This matches StakingRewardService.getPool0LpRatio on the backend.
          vaultService.getTokenBalance(poolInfo.share_token, stakingContractId),
        ]);
        if (cancelled) return;

        const vaultLp = parseFloat(poolInfo.total_lp_tokens) / 1e7;
        const contractTotalLp = parseFloat(contractLpBalance);
        const polLp = Math.max(0, contractTotalLp - vaultLp);

        // Total LP in the entire Aquarius pool
        const totalPoolLp = parseFloat(apyData.totalShare ?? reservesData.totalLpSupply);

        // POL's share of the pool
        const polShare = totalPoolLp > 0 ? polLp / totalPoolLp : 0;

        // POL's portion of reserves
        const totalResA = parseFloat(reservesData.reserveA);
        const totalResB = parseFloat(reservesData.reserveB);
        const polResA = totalResA * polShare;
        const polResB = totalResB * polShare;

        // USD value — BLUB is pegged 1:1 to AQUA, so use AQUA price for both
        // to avoid the reserve-ratio fallback giving a wrong price (stableswap pool
        // has imbalanced reserves that don't reflect the 1:1 peg)
        let usdValue = 0;
        try {
          const aquaPrice = await TokenPriceService.getTokenPrice("AQUA");
          if (aquaPrice > 0) {
            usdValue = (polResA + polResB) * aquaPrice;
          }
        } catch {
          // Graceful degradation — show 0 if price unavailable
        }

        if (cancelled) return;

        // Fetch ICE boost info (non-blocking)
        let iceBoost: IceBoostInfo | null = null;
        try {
          iceBoost = await vaultService.getIceBoostInfo(
            poolInfo.pool_address,
            poolInfo.share_token,
            totalPoolLp.toFixed(7),
          );
        } catch {
          // Graceful degradation
        }

        if (cancelled) return;

        setStats({
          polReserveA: polResA.toFixed(2),
          polReserveB: polResB.toFixed(2),
          polUsdValue: usdValue.toFixed(2),
          polLp: polLp.toFixed(2),
          polSharePercent: (polShare * 100).toFixed(2),
          tokenACode: poolInfo.token_a_code,
          tokenBCode: poolInfo.token_b_code,
          totalLp: totalPoolLp.toFixed(2),
          poolApy: apyData.poolApy,
          compoundApy: apyData.compoundApy,
          iceBoost,
        });
      } catch (err) {
        console.warn("[PolInfo] Failed to fetch pool stats:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchPoolStats();
    const interval = setInterval(fetchPoolStats, 60000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [vaultService]);

  // Collapse by default if POL total value < $25,000
  const polUsd = parseFloat(stats?.polUsdValue ?? "0");
  const isSmallPol = polUsd < 25000;
  const showStats = !isSmallPol || expanded;

  return (
    <div className="bg-[#0E111BCC] p-6 rounded-[16px]">
      <div className="flex items-center space-x-2 mb-2">
        <div className="text-xl font-medium text-white">Protocol Treasury</div>
        <InformationCircleIcon
          className="h-[15px] w-[15px] text-white cursor-pointer"
          onClick={() =>
            onDialogOpen(
              "The protocol's own permanent position in the AQUA-BLUB pool. Funded by a share of all earnings and held by WhaleHub itself, not by external liquidity providers.\n\nA crowdfunded reserve that grows over time. Earnings from this position are used to buy BLUB from the open market, creating consistent demand that benefits every backer.\n\nUnlike rented liquidity that disappears when incentives drop, this stays.",
              "Protocol Treasury"
            )
          }
        />
      </div>
      <div className="text-sm text-[#B1B3B8] font-medium mb-4">
        Protocol-owned liquidity. Earns fees. Buys BLUB. Benefits all backers.
      </div>

      {loading ? (
        <div className="flex justify-center items-center py-8">
          <TailSpin height="32" width="32" color="#00CC99" ariaLabel="loading" radius="1" visible={true} />
        </div>
      ) : isSmallPol && !expanded ? (
        <button
          onClick={() => setExpanded(true)}
          className="text-sm text-[#00CC99] hover:underline cursor-pointer"
        >
          View protocol stats &#9662;
        </button>
      ) : (
        <>
          {isSmallPol && (
            <button
              onClick={() => setExpanded(false)}
              className="text-sm text-[#00CC99] hover:underline cursor-pointer mb-3"
            >
              Hide protocol stats &#9652;
            </button>
          )}
          <div className="grid grid-cols-2 gap-4">
            {/* POL Token A */}
            <div className="bg-[#1A1E2E] p-4 rounded-[12px]">
              <div className="text-sm text-[#B1B3B8] mb-1">POL {stats?.tokenACode}</div>
              <div className="text-lg font-semibold text-white break-words">
                {fmtNum(stats?.polReserveA ?? "0")}
                <span className="text-[#6B7280] text-xs font-normal block sm:inline mt-1 sm:mt-0 sm:ml-1">{formatUsd(stats?.polReserveA ?? "0", stats?.tokenACode === "BLUB" ? blubPrice : aquaPrice)}</span>
              </div>
            </div>

            {/* POL Token B */}
            <div className="bg-[#1A1E2E] p-4 rounded-[12px]">
              <div className="text-sm text-[#B1B3B8] mb-1">POL {stats?.tokenBCode}</div>
              <div className="text-lg font-semibold text-white break-words">
                {fmtNum(stats?.polReserveB ?? "0")}
                <span className="text-[#6B7280] text-xs font-normal block sm:inline mt-1 sm:mt-0 sm:ml-1">{formatUsd(stats?.polReserveB ?? "0", stats?.tokenBCode === "BLUB" ? blubPrice : aquaPrice)}</span>
              </div>
            </div>

            {/* USD Value — hidden when price unavailable */}
            {polUsd > 0 && (
              <div className="bg-[#1A1E2E] p-4 rounded-[12px] col-span-2">
                <div className="text-sm text-[#B1B3B8] mb-1">POL Total Value</div>
                <div className="text-lg font-semibold text-[#00CC99]">
                  ${fmtNum(stats?.polUsdValue ?? "0")}
                </div>
                <div className="text-[10px] text-[#6B7280] mt-0.5">
                  {fmtNum(stats?.polLp ?? "0")} LP · {stats?.polSharePercent ?? "0"}% of pool
                </div>
              </div>
            )}

            {/* Pool APY */}
            <div className="bg-[#1A1E2E] p-4 rounded-[12px]">
              <div className="flex items-center gap-1 mb-1 relative group">
                <div className="text-sm text-[#B1B3B8]">Pool APY</div>
                <InformationCircleIcon className="h-[14px] w-[14px] text-[#6B7280] cursor-pointer flex-shrink-0" />
                <div className="absolute bottom-full left-0 mb-2 w-56 bg-gray-800 text-white text-xs rounded px-3 py-2 opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none">
                  The base annualized yield earned from trading fees and AQUA rewards in the Aquarius liquidity pool. Reflects real-time pool performance.
                </div>
              </div>
              <div className="text-lg font-semibold text-[#00CC99]">
                {stats?.poolApy === "--" ? "--" : `${stats?.poolApy}%`}
              </div>
              <div className="text-[10px] text-[#6B7280] mt-0.5">via Aquarius</div>
            </div>

            {/* Compounded APY */}
            <div className="bg-[#1A1E2E] p-4 rounded-[12px]">
              <div className="flex items-center gap-1 mb-1 relative group">
                <div className="text-sm text-[#B1B3B8]">Compounded APY</div>
                <InformationCircleIcon className="h-[14px] w-[14px] text-[#6B7280] cursor-pointer flex-shrink-0" />
                <div className="absolute bottom-full left-0 mb-2 w-64 bg-gray-800 text-white text-xs rounded px-3 py-2 opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none">
                  Your actual return through WhaleHub's vault. Higher than the base Pool APY because earnings are automatically reinvested into your position 24 times a day. Each reinvestment grows your backer share a tiny bit, and those tiny bits compound into a meaningfully higher annual return.
                </div>
              </div>
              <div className="text-lg font-semibold text-[#3B82F6]">
                {stats?.compoundApy === "--" ? "--" : `${stats?.compoundApy}%`}
              </div>
              <div className="text-[10px] text-[#6B7280] mt-0.5">24x daily · via Whalehub</div>
            </div>
          </div>

          {/* Protocol Stats — Total ICE Locked, Total Distributed & Total Staked */}
          <div className="mt-4 space-y-3">
            <div className="flex items-center bg-[#1A1E2E] px-4 py-3 rounded-[12px] justify-between gap-3">
              <div className="text-sm font-normal text-white flex items-center space-x-1 shrink-0">
                <span>Total ICE Locked</span>
                <InformationCircleIcon
                  className="h-[14px] w-[14px] text-[#6B7280] cursor-pointer"
                  onClick={() =>
                    onDialogOpen(
                      "Total ICE voting power held by the protocol from locking AQUA on Aquarius. ICE is non-transferable and is used to direct AQUA emissions and bribes toward WhaleHub's pools — the core of the yield strategy.",
                      "Total ICE Locked"
                    )
                  }
                />
              </div>
              <div className="min-w-0 text-right">
                {loading ? <span>...</span> : (
                  <div className="text-sm sm:text-base font-normal text-[#7CC5FF] break-words">
                    {(stats?.iceBoost?.myIce ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 })} ICE
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center bg-[#1A1E2E] px-4 py-3 rounded-[12px] justify-between gap-3">
              <div className="text-sm font-normal text-white flex items-center space-x-1 shrink-0">
                <span>Total Distributed</span>
                <InformationCircleIcon
                  className="h-[14px] w-[14px] text-[#6B7280] cursor-pointer"
                  onClick={() =>
                    onDialogOpen(
                      "Total BLUB rewards distributed to all stakers from POL (Protocol-Owned Liquidity) yield. Rewards are added automatically by the backend when AQUA is claimed from the BLUB-AQUA pool and swapped to BLUB.",
                      "Total Distributed"
                    )
                  }
                />
              </div>
              <div className="min-w-0 text-right">
                {staking.isLoading ? <span>...</span> : (
                  <div className="text-sm sm:text-base font-normal text-[#00CC99] break-words">
                    {(staking.rewardState?.total_rewards_added ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} BLUB
                    <span className="text-[11px] text-[#6B7280] font-normal block sm:inline mt-0.5 sm:mt-0 sm:ml-1">{formatUsd(staking.rewardState?.total_rewards_added ?? 0, blubPrice)}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center bg-[#1A1E2E] px-4 py-3 rounded-[12px] justify-between gap-3">
              <div className="text-sm font-normal text-white flex items-center space-x-1 shrink-0">
                <span>Total Staked</span>
                <InformationCircleIcon
                  className="h-[14px] w-[14px] text-[#6B7280] cursor-pointer"
                  onClick={() =>
                    onDialogOpen(
                      "Total BLUB currently staked across all users. A larger pool means your share of rewards is smaller, but it reflects broader protocol adoption.",
                      "Total BLUB Staked"
                    )
                  }
                />
              </div>
              <div className="min-w-0 text-right">
                {staking.isLoading ? <span>...</span> : (
                  staking.rewardState?.total_staked != null
                    ? <div className="text-sm sm:text-base font-normal break-words">
                        {Number(staking.rewardState.total_staked).toLocaleString("en-US", { maximumFractionDigits: 2 })} BLUB
                        <span className="text-[11px] text-[#6B7280] font-normal block sm:inline mt-0.5 sm:mt-0 sm:ml-1">{formatUsd(staking.rewardState.total_staked, blubPrice)}</span>
                      </div>
                    : <span>--</span>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default PolInfo;
