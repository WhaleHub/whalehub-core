import { useEffect, useState } from "react";
import { apiService, StakingApyResponse } from "../services/api.service";
import { RewardStateInfo } from "../lib/slices/stakingSlice";

/**
 * Rolling-window staking APY.
 *
 * Source: backend `/public/staking-apy` — indexes `rwd_add` events and
 * annualises the last `windowDays` of emissions. Honest rate.
 *
 * Default window is 1 day so users see the current emission rate. Longer
 * windows smooth gaps from missed reward distributions back into the
 * displayed number — see staking_reward_balance_delta_bug.md for the
 * Apr 2026 incident that motivated the shorter window.
 *
 * Fallback: when the indexer is unreachable or empty, show a hardcoded
 * `FALLBACK_APY` close to the steady-state rate. The previous lifetime-ratio
 * fallback overstated by `protocol_age_days / windowDays` (~160-168% at
 * windowDays=1), and "--" left users staring at no number while the indexer
 * recovered. Pinning to 17.88 is the lesser of three evils until the indexer
 * is reliably populated.
 *
 * Refreshes every 60s, matching the indexer's poll cadence.
 */
const FALLBACK_APY = "17.88";

export function useStakingApy(
  _rewardState: RewardStateInfo | null,
  windowDays = 1,
): { apy: string; source: "indexer" | "fallback" } {
  const [apy, setApy] = useState<string>(FALLBACK_APY);
  const [source, setSource] = useState<"indexer" | "fallback">("fallback");

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      const res: StakingApyResponse | null = await apiService.getStakingApy(windowDays);
      if (cancelled) return;
      if (res && res.apy !== "--" && res.eventCount > 0) {
        setApy(res.apy);
        setSource("indexer");
        return;
      }
      // Indexer unreachable or empty — fall back to the hardcoded steady-state
      // rate rather than "--" or the misleading lifetime ratio.
      setApy(FALLBACK_APY);
      setSource("fallback");
    };

    refresh();
    const interval = setInterval(refresh, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [windowDays]);

  return { apy, source };
}
