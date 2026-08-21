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

/**
 * TEMP (2026-08-21) — hold yesterday's rate while the window is unrepresentative.
 *
 * `add_rewards` reverts above 100,000 BLUB per call (contract cap), so every
 * distribution from 17-20 Aug failed and the backlog was cleared in two small
 * catch-up runs. The indexer's window now holds a single 3,398 BLUB event, which
 * annualises to 2.15% — arithmetically right, wildly unrepresentative.
 *
 * Until a normal day is back in the window we show the last real distribution
 * instead: 22,618.03 BLUB on 2026-08-21T00:01Z against 57,621,942 BLUB staked
 * = 14.33%. Measured on-chain, not invented.
 *
 * Two guards so this cannot quietly outlive the outage: it only applies while the
 * indexer reports a single event, and it stops applying after `TEMP_APY_UNTIL`.
 * Delete this block once a full day of distributions is indexed.
 */
const TEMP_APY = "14.33";
const TEMP_APY_UNTIL = Date.parse("2026-08-23T00:00:00Z");

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
        // A single event in the window annualises one distribution as if it were
        // the daily rate. After the Aug outage that event is a small catch-up run,
        // so prefer the last real rate until a second event lands.
        if (res.eventCount <= 1 && Date.now() < TEMP_APY_UNTIL) {
          setApy(TEMP_APY);
          setSource("fallback");
          return;
        }
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
