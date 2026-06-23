import { useEffect, useState, useMemo, useCallback } from "react";
import { useAppDispatch } from "../../lib/hooks";
import { useSelector } from "react-redux";
import { RootState } from "../../lib/store";
import clsx from "clsx";
import { Button, Input } from "@headlessui/react";
import { toast } from "react-toastify";
import { TailSpin } from "react-loader-spinner";
import { InformationCircleIcon } from "@heroicons/react/16/solid";
import DialogC from "./Dialog";
import { SorobanVaultService, TokenPriceService, IceBoostInfo } from "../../services/soroban-vault.service";
import { useTokenPrice, formatUsd } from "../../hooks/useTokenPrice";
import { StellarService } from "../../services/stellar.service";
import { getAccountInfo, storeAccountBalance } from "../../lib/slices/userSlice";
import aquaLogo from "../../assets/images/aqua_logo.png";
import xlmLogo from "../../assets/images/xlm.png";
import usdcLogo from "../../assets/images/usdc.svg";

// Locale-safe number formatter — always uses dot as decimal separator
const fmtNum = (val: string | number, decimals = 4): string =>
  parseFloat(String(val)).toFixed(decimals).replace(/,/g, ".");

const TOKEN_LOGOS: Record<string, string> = {
  AQUA: aquaLogo,
  XLM: xlmLogo,
  USDC: usdcLogo,
  BLUB: "/Blub_logo2.svg",
};

interface PoolInfo {
  pool_id: number;
  pool_address: string;
  token_a: string;
  token_b: string;
  share_token: string;
  total_lp_tokens: string;
  active: boolean;
  added_at: number;
  // Display info
  token_a_code: string;
  token_b_code: string;
  token_a_logo: string;
  token_b_logo: string;
}

interface UserPosition {
  pool_id: number;
  share_ratio: string;
  deposited_at: number;
  active: boolean;
  // Calculated fields
  user_lp_amount: string;
  percentage: string;
}

function AddLiquidity() {
  const aquaPrice = useTokenPrice("AQUA");
  const blubPrice = useTokenPrice("BLUB");
  const [pools, setPools] = useState<PoolInfo[]>([]);
  const [selectedPool, setSelectedPool] = useState<PoolInfo | null>(null);
  const [userPositions, setUserPositions] = useState<UserPosition[]>([]);

  const [depositAmount1, setDepositAmount1] = useState<string>("");
  const [depositAmount2, setDepositAmount2] = useState<string>("");
  const [withdrawPercent, setWithdrawPercent] = useState<number>(100);

  const [isDepositing, setIsDepositing] = useState(false);
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [isLoadingPools, setIsLoadingPools] = useState(true);

  // Token balances
  const [balanceA, setBalanceA] = useState<string>("0");
  const [balanceB, setBalanceB] = useState<string>("0");
  const [isLoadingBalances, setIsLoadingBalances] = useState(false);

  // Pool reserves for withdrawal estimates
  const [reserveA, setReserveA] = useState<string>("0");
  const [reserveB, setReserveB] = useState<string>("0");
  const [totalLpSupply, setTotalLpSupply] = useState<string>("0");

  // Compound stats
  const [compoundStats, setCompoundStats] = useState<{
    totalCompoundedLp: string; totalRewardsClaimed: string; compoundCount: number; lastCompoundTime: number;
  } | null>(null);
  const [userCompoundGains, setUserCompoundGains] = useState<{
    currentLp: string; depositedLp: string; compoundGainLp: string;
  } | null>(null);

  const [activeTab, setActiveTab] = useState<"deposit" | "withdraw">("deposit");

  // Position USD value derived from pool reserves and token prices
  const positionValueUsd = useMemo(() => {
    const pos = userPositions[0];
    if (!pos || !selectedPool) return null;
    const userLp = parseFloat(pos.user_lp_amount || "0");
    const totalLp = parseFloat(totalLpSupply);
    if (totalLp <= 0 || userLp <= 0) return null;
    const userShare = userLp / totalLp;
    const resA = parseFloat(reserveA);
    const resB = parseFloat(reserveB);
    const priceA = selectedPool.token_a_code === "BLUB" ? blubPrice : selectedPool.token_a_code === "AQUA" ? aquaPrice : 0;
    const priceB = selectedPool.token_b_code === "BLUB" ? blubPrice : selectedPool.token_b_code === "AQUA" ? aquaPrice : 0;
    return userShare * (resA * priceA + resB * priceB);
  }, [userPositions, totalLpSupply, reserveA, reserveB, selectedPool, aquaPrice, blubPrice]);

  const formatPositionUsd = (n: number) =>
    n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Pool APY from Aquarius
  const [poolApy, setPoolApy] = useState<string>("--");
  const [compoundApy, setCompoundApy] = useState<string>("--");
  const [iceBoost, setIceBoost] = useState<IceBoostInfo | null>(null);

  const [singleAsset, setSingleAsset] = useState<boolean>(false);
  const [singleAssetToken, setSingleAssetToken] = useState<"a" | "b">("a");

  // Slippage tolerance in percentage (e.g., 0.5 = 0.5%)
  const [slippageTolerance, setSlippageTolerance] = useState<number>(0.5);
  const [showSlippageSettings, setShowSlippageSettings] = useState<boolean>(false);
  const [customSlippage, setCustomSlippage] = useState<string>("");

  const [dialogMsg, setDialogMsg] = useState<string>("");
  const [dialogTitle, setDialogTitle] = useState<string>("");
  const [openDialog, setOptDialog] = useState<boolean>(false);

  const dispatch = useAppDispatch();
  const user = useSelector((state: RootState) => state.user);
  const userWalletAddress = user?.userWalletAddress;

  // Create vaultService only once
  const vaultService = useMemo(() => new SorobanVaultService(), []);

  const loadPools = useCallback(async () => {
    try {
      setIsLoadingPools(true);
      console.log("[AddLiquidity] Loading pools from contract...");

      const poolCount = await vaultService.getPoolCount();
      console.log("[AddLiquidity] Pool count:", poolCount);

      if (poolCount === 0) {
        console.log("[AddLiquidity] No pools configured in contract");
        setPools([]);
        setSelectedPool(null);
        return;
      }

      const loadedPools: PoolInfo[] = [];
      // Only load pool 0 (BLUB-AQUA) — other pools are hidden
      try {
        const poolInfo = await vaultService.getPoolInfo(0);
        console.log(`[AddLiquidity] Pool 0:`, poolInfo);
        if (poolInfo.active) {
          loadedPools.push(poolInfo);
        }
      } catch (poolError) {
        console.error(`[AddLiquidity] Failed to load pool 0:`, poolError);
      }

      setPools(loadedPools);
      if (loadedPools.length > 0) {
        setSelectedPool((prev) => prev ?? loadedPools[0]);
      }
    } catch (error) {
      console.error("[AddLiquidity] Failed to load pools:", error);
      toast.error("Failed to load pools. Please check your connection.");
    } finally {
      setIsLoadingPools(false);
    }
  }, [vaultService]);

  const loadUserPosition = useCallback(async (poolId: number, totalLpTokens?: string) => {
    if (!userWalletAddress) return;

    try {
      const [position, poolStats, gains] = await Promise.all([
        vaultService.getUserVaultPosition(userWalletAddress, poolId, totalLpTokens),
        vaultService.getPoolCompoundStats(poolId),
        vaultService.getUserCompoundGains(userWalletAddress, poolId),
      ]);

      if (position) {
        setUserPositions([position]);
      } else {
        setUserPositions([]);
      }
      setCompoundStats(poolStats);
      setUserCompoundGains(gains);
    } catch (error) {
      console.error("Failed to load user position:", error);
      setUserPositions([]);
    }
  }, [vaultService, userWalletAddress]);

  const loadBalances = useCallback(async (pool: PoolInfo) => {
    if (!userWalletAddress) {
      setBalanceA("0");
      setBalanceB("0");
      return;
    }

    setIsLoadingBalances(true);
    try {
      const [balA, balB] = await Promise.all([
        vaultService.getTokenBalance(pool.token_a, userWalletAddress),
        vaultService.getTokenBalance(pool.token_b, userWalletAddress),
      ]);
      setBalanceA(balA);
      setBalanceB(balB);
    } catch (error) {
      console.error("Failed to load balances:", error);
      setBalanceA("0");
      setBalanceB("0");
    } finally {
      setIsLoadingBalances(false);
    }
  }, [vaultService, userWalletAddress]);

  const loadPoolReserves = useCallback(async (pool: PoolInfo) => {
    try {
      const data = await vaultService.getPoolReserves(
        pool.pool_address,
        pool.share_token,
        pool.token_a,
        pool.token_b,
      );
      setReserveA(data.reserveA);
      setReserveB(data.reserveB);
      setTotalLpSupply(data.totalLpSupply);
    } catch (error) {
      console.error("Failed to load pool reserves:", error);
      setReserveA("0");
      setReserveB("0");
      setTotalLpSupply("0");
    }
  }, [vaultService]);

  const loadPoolApy = useCallback(async (pool: PoolInfo) => {
    const { poolApy: apy, compoundApy: cApy, totalShare } = await vaultService.getAquariusPoolApy(pool.pool_address);
    setPoolApy(apy);
    setCompoundApy(cApy);
    // Override on-chain totalLpSupply with Aquarius API value — avoids inflated on-chain values
    // that would cause min_shares to be too high (error #2006)
    if (totalShare && parseFloat(totalShare) > 0) {
      setTotalLpSupply(totalShare);
    }
    // Fetch ICE boost info (non-blocking — don't delay APY display)
    vaultService.getIceBoostInfo(pool.pool_address, pool.share_token, totalShare)
      .then(setIceBoost)
      .catch(() => setIceBoost(null));
  }, [vaultService]);

  // Refresh wallet balances and update Redux state (like other sections do)
  const refreshWalletAndBalances = useCallback(async () => {
    if (!userWalletAddress || !selectedPool) return;

    try {
      // Update Redux state with fresh Horizon data
      const stellarService = new StellarService();
      const wrappedAccount = await stellarService.loadAccount(userWalletAddress);
      dispatch(getAccountInfo(userWalletAddress));
      dispatch(storeAccountBalance(wrappedAccount.balances));

      // Also refresh local token balances
      await loadBalances(selectedPool);
      await loadUserPosition(selectedPool.pool_id, selectedPool.total_lp_tokens);
      await loadPoolReserves(selectedPool);
    } catch (error) {
      console.error("Failed to refresh wallet balances:", error);
    }
  }, [userWalletAddress, selectedPool, dispatch, loadBalances, loadUserPosition, loadPoolReserves]);

  // Load pools on mount
  useEffect(() => {
    loadPools();
  }, [loadPools]);

  // Retry pool loading when wallet connects and pools are empty (handles reconnect case)
  useEffect(() => {
    if (userWalletAddress && pools.length === 0 && !isLoadingPools) {
      loadPools();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userWalletAddress]);

  // Load pool reserves and APY when pool is selected
  useEffect(() => {
    if (selectedPool) {
      loadPoolReserves(selectedPool);
      loadPoolApy(selectedPool);
    }
  }, [selectedPool?.pool_id, loadPoolReserves, loadPoolApy]);

  // Load user position and balances when pool or wallet changes
  useEffect(() => {
    if (selectedPool && userWalletAddress) {
      loadUserPosition(selectedPool.pool_id, selectedPool.total_lp_tokens);
      loadBalances(selectedPool);
    } else {
      // Reset balances if no wallet connected
      setBalanceA("0");
      setBalanceB("0");
      setUserPositions([]);
    }
  }, [selectedPool?.pool_id, userWalletAddress, loadUserPosition, loadBalances]);

  // Auto-refresh balances every 30 seconds (like Yield.tsx does)
  useEffect(() => {
    if (userWalletAddress && selectedPool) {
      // Set up auto-refresh every 30 seconds for real-time updates
      const refreshInterval = setInterval(() => {
        refreshWalletAndBalances();
      }, 30000);

      // Cleanup interval on unmount
      return () => clearInterval(refreshInterval);
    }
  }, [userWalletAddress, selectedPool, refreshWalletAndBalances]);

  // Normalize user input: replace commas with dots so European locale keyboards work correctly
  const normalizeDecimal = (value: string) => value.replace(/,/g, ".");

  // Auto-fill second field from pool ratio
  const handleAmount1Change = (value: string) => {
    const normalized = normalizeDecimal(value);
    setDepositAmount1(normalized);
    if (singleAsset) return;
    const amt = parseFloat(normalized);
    const resA = parseFloat(reserveA);
    const resB = parseFloat(reserveB);
    if (!isNaN(amt) && amt > 0 && resA > 0 && resB > 0) {
      setDepositAmount2((amt * (resB / resA)).toFixed(7));
    } else if (!normalized) {
      setDepositAmount2("");
    }
  };

  const handleAmount2Change = (value: string) => {
    const normalized = normalizeDecimal(value);
    setDepositAmount2(normalized);
    if (singleAsset) return;
    const amt = parseFloat(normalized);
    const resA = parseFloat(reserveA);
    const resB = parseFloat(reserveB);
    if (!isNaN(amt) && amt > 0 && resA > 0 && resB > 0) {
      setDepositAmount1((amt * (resA / resB)).toFixed(7));
    } else if (!normalized) {
      setDepositAmount1("");
    }
  };

  // Calculate estimated LP shares for deposit based on pool reserves
  const calculateExpectedShares = (amountA: number, amountB: number): string => {
    const resA = parseFloat(reserveA);
    const resB = parseFloat(reserveB);
    const totalLp = parseFloat(totalLpSupply);

    if (totalLp <= 0 || resA <= 0 || resB <= 0) {
      // First deposit - shares equal to sqrt(amountA * amountB)
      return Math.sqrt(amountA * amountB).toString();
    }

    // Calculate shares based on the smaller ratio to prevent manipulation
    const sharesFromA = (amountA / resA) * totalLp;
    const sharesFromB = (amountB / resB) * totalLp;

    // Use the minimum to be conservative
    return Math.min(sharesFromA, sharesFromB).toString();
  };

  // Apply slippage tolerance to get minimum acceptable amount (human-readable)
  const applySlippage = (amount: string | number): string => {
    const value = typeof amount === "string" ? parseFloat(amount) : amount;
    if (isNaN(value) || value <= 0) return "0";

    const minAmount = value * (1 - slippageTolerance / 100);
    return minAmount.toString();
  };

  // Handle slippage preset selection
  const handleSlippagePreset = (value: number) => {
    setSlippageTolerance(value);
    setCustomSlippage("");
  };

  // Handle custom slippage input
  const handleCustomSlippageChange = (value: string) => {
    setCustomSlippage(value);
    const parsed = parseFloat(value);
    if (!isNaN(parsed) && parsed > 0 && parsed <= 50) {
      setSlippageTolerance(parsed);
    }
  };

  // Calculate estimated withdrawal amounts
  const getEstimatedWithdrawAmounts = () => {
    if (!userPosition || !selectedPool) {
      return { estimatedA: "0.00", estimatedB: "0.00" };
    }

    const userLp = parseFloat(userPosition.user_lp_amount || "0");
    const poolTotalLp = parseFloat(totalLpSupply);
    const resA = parseFloat(reserveA);
    const resB = parseFloat(reserveB);

    if (poolTotalLp <= 0 || userLp <= 0) {
      return { estimatedA: "0.00", estimatedB: "0.00" };
    }

    // User's share of the entire Aquarius pool
    const userShareOfPool = userLp / poolTotalLp;
    // Apply withdrawal percentage
    const withdrawShare = (withdrawPercent / 100) * userShareOfPool;

    const estimatedA = (withdrawShare * resA).toFixed(4);
    const estimatedB = (withdrawShare * resB).toFixed(4);

    return { estimatedA, estimatedB };
  };

  const handleDeposit = async () => {
    if (!selectedPool) {
      return toast.warn("Please select a pool");
    }

    if (!user?.userWalletAddress) {
      return toast.warn("Please connect your wallet");
    }

    if (!user?.walletName) {
      return toast.warn("Please connect your wallet");
    }

    const amount1 = parseFloat(depositAmount1);
    let amount2 = parseFloat(depositAmount2);

    // In single-asset mode, validate against the selected token's balance
    if (singleAsset) {
      const selectedCode = singleAssetToken === "a" ? selectedPool.token_a_code : selectedPool.token_b_code;
      const selectedBal = parseFloat(singleAssetToken === "a" ? balanceA : balanceB);

      if (!amount1 || amount1 <= 0) {
        return toast.warn(`Please enter ${selectedCode} amount`);
      }
      if (amount1 > selectedBal) {
        return toast.warn(
          `Insufficient ${selectedCode} balance. You have ${selectedBal.toFixed(4)}`
        );
      }
      amount2 = 0;
    } else {
      if (!amount1 || amount1 <= 0) {
        return toast.warn(`Please enter ${selectedPool.token_a_code} amount`);
      }

      // If the second field is empty/zero, auto-calculate from pool ratio
      if (!amount2 || amount2 <= 0) {
        const resA = parseFloat(reserveA);
        const resB = parseFloat(reserveB);
        if (resA > 0 && resB > 0) {
          amount2 = amount1 * (resB / resA);
          setDepositAmount2(amount2.toFixed(7));
        } else {
          return toast.warn(`Please enter ${selectedPool.token_b_code} amount`);
        }
      }

      // Balance validation
      const balA = parseFloat(balanceA);
      const balB = parseFloat(balanceB);

      if (amount1 > balA) {
        return toast.warn(
          `Insufficient ${selectedPool.token_a_code} balance. You have ${balA.toFixed(4)}`
        );
      }

      if (amount2 > 0 && amount2 > balB) {
        return toast.warn(
          `Insufficient ${selectedPool.token_b_code} balance. You have ${balB.toFixed(4)}`
        );
      }
    }

    // Minimum $1 deposit validation
    setIsDepositing(true);

    try {
      const usdTokenACode = singleAsset && singleAssetToken === "b" ? selectedPool.token_b_code : selectedPool.token_a_code;
      const usdAmountA = singleAsset && singleAssetToken === "b" ? 0 : amount1;
      const usdTokenBCode = singleAsset && singleAssetToken === "b" ? selectedPool.token_a_code : selectedPool.token_b_code;
      const usdAmountB = singleAsset ? (singleAssetToken === "b" ? amount1 : 0) : amount2;
      const totalUsdValue = await TokenPriceService.calculateTotalUsdValue(
        usdTokenACode,
        usdAmountA,
        usdTokenBCode,
        usdAmountB,
        parseFloat(reserveA),
        parseFloat(reserveB)
      );

      // Only enforce minimum if we successfully got a price (0 means price unavailable)
      if (totalUsdValue > 0 && totalUsdValue < 1) {
        setIsDepositing(false);
        return toast.error(
          `Minimum deposit amount is $1. Your deposit is worth $${totalUsdValue.toFixed(2)}`
        );
      }
    } catch (priceError) {
      console.warn("Could not verify USD value, proceeding with deposit:", priceError);
      // Continue with deposit if price check fails (graceful degradation)
    }

    try {
      let result;

      if (singleAsset) {
        const tokenIn = singleAssetToken === "a" ? selectedPool.token_a : selectedPool.token_b;
        result = await vaultService.vaultDepositSingle({
          userAddress: user.userWalletAddress,
          poolId: selectedPool.pool_id,
          tokenIn,
          amountIn: amount1.toString(),
          minShares: "0",
          walletName: user.walletName,
        });
      } else {
        result = await vaultService.vaultDeposit({
          userAddress: user.userWalletAddress,
          poolId: selectedPool.pool_id,
          desiredA: amount1.toString(),
          desiredB: amount2.toString(),
          minShares: "0",
          walletName: user.walletName,
        });
      }

      if (result.success) {
        toast.success("Deposit successful!");
        setDepositAmount1("");
        setDepositAmount2("");
        // Refresh all balances including Redux state
        await refreshWalletAndBalances();
      } else {
        toast.error(result.error || "Deposit failed");
      }
    } catch (error: any) {
      console.error("Deposit error:", error);
      toast.error(error.message || "Deposit failed");
    } finally {
      setIsDepositing(false);
    }
  };

  const handleWithdraw = async () => {
    if (!selectedPool) {
      return toast.warn("Please select a pool");
    }

    if (!user?.userWalletAddress) {
      return toast.warn("Please connect your wallet");
    }

    if (userPositions.length === 0) {
      return toast.warn("No position to withdraw");
    }

    if (withdrawPercent <= 0 || withdrawPercent > 100) {
      return toast.warn("Invalid withdrawal percentage");
    }

    if (!user?.walletName) {
      return toast.warn("Please connect your wallet");
    }

    setIsWithdrawing(true);

    try {
      // Calculate minimum amounts with slippage protection
      const { estimatedA, estimatedB } = getEstimatedWithdrawAmounts();
      const minAWithSlippage = applySlippage(estimatedA);
      const minBWithSlippage = applySlippage(estimatedB);

      console.log("[Withdraw] Slippage protection:", {
        estimatedA,
        estimatedB,
        slippageTolerance: `${slippageTolerance}%`,
        minAWithSlippage,
        minBWithSlippage,
      });

      const result = await vaultService.vaultWithdraw({
        userAddress: user.userWalletAddress,
        poolId: selectedPool.pool_id,
        sharePercent: withdrawPercent * 100, // Convert to basis points
        minA: minAWithSlippage,
        minB: minBWithSlippage,
        walletName: user.walletName,
      });

      if (result.success) {
        toast.success("Withdrawal successful!");
        setWithdrawPercent(100);
        // Refresh all balances including Redux state
        await refreshWalletAndBalances();
      } else {
        toast.error(result.error || "Withdrawal failed");
      }
    } catch (error: any) {
      console.error("Withdrawal error:", error);
      toast.error(error.message || "Withdrawal failed");
    } finally {
      setIsWithdrawing(false);
    }
  };

  const onDialogOpen = (msg: string, title: string) => {
    setOptDialog(true);
    setDialogMsg(msg);
    setDialogTitle(title);
  };

  const closeModal = () => {
    setOptDialog(false);
  };

  const userPosition = userPositions[0];

  if (isLoadingPools) {
    return (
      <div className="bg-[#0E111BCC] p-10 rounded-[16px] flex justify-center items-center min-h-[400px]">
        <TailSpin
          height="40"
          width="40"
          color="#00CC99"
          ariaLabel="tail-spin-loading"
          radius="1"
          visible={true}
        />
      </div>
    );
  }

  return (
    <div>
      <div className="bg-[#0E111BCC] p-6 md:p-8 rounded-[16px]">
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base md:text-xl font-semibold text-white">AQUA-BLUB Liquidity Vault</h2>
          <div className="flex items-center gap-2 shrink-0">
            <InformationCircleIcon
              className="h-4 w-4 text-[#6B7280] cursor-pointer hover:text-white transition-colors"
              onClick={() =>
                onDialogOpen(
                  "You're joining a crowdfunded liquidity pool. Every backer contributes both AQUA and BLUB, and everyone earns a proportional share of what the pool generates.\n\nWhen traders swap AQUA and BLUB, the pool keeps a small fee. Your LP tokens are your backer share. The more you contribute, the bigger your slice of those fees.\n\nOn top of that, the pool earns rewards from Aquarius. Both fees and rewards are automatically reinvested into your position every hour. No buttons to press, no manual claiming.\n\nWithdraw your share anytime. No lockups.",
                  "AQUA-BLUB Liquidity Vault"
                )
              }
            />
            <button
              onClick={async () => {
                await loadPools();
                if (selectedPool && userWalletAddress) await refreshWalletAndBalances();
              }}
              disabled={isLoadingPools}
              title="Refresh"
              className="text-[#6B7280] hover:text-white transition-colors disabled:opacity-40"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 ${isLoadingPools ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
            <button
              className="flex items-center space-x-1.5 text-xs text-[#6B7280] hover:text-white transition-colors border border-[#2A3050] rounded-[6px] px-2.5 py-1.5"
              onClick={() => setShowSlippageSettings(!showSlippageSettings)}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span>Slippage: {slippageTolerance}%</span>
            </button>
          </div>
        </div>

        {/* Slippage panel */}
        {showSlippageSettings && (
          <div className="mt-3 p-4 bg-[#0A0D14] border border-[#1C2235] rounded-[10px]">
            <div className="flex items-center space-x-2 mb-3">
              <span className="text-xs text-[#B1B3B8]">Max price impact you're willing to accept</span>
              <InformationCircleIcon
                className="h-3.5 w-3.5 text-[#6B7280] cursor-pointer"
                onClick={() => onDialogOpen(
                  "The maximum price difference you'll accept between when you click deposit and when the transaction completes.\n\nLower setting = more protection but higher chance the transaction fails. Higher setting = transaction succeeds more often but you might pay slightly more than expected.\n\nDefault 0.5% is fine for most deposits.",
                  "Slippage Tolerance"
                )}
              />
            </div>
            <div className="flex items-center space-x-2">
              {[0.5, 1, 2, 3].map((preset) => (
                <button
                  key={preset}
                  className={clsx(
                    "px-3 py-1.5 rounded-[6px] text-xs font-medium transition-colors",
                    slippageTolerance === preset && !customSlippage
                      ? "bg-[#00CC99] text-white"
                      : "bg-[#1C2235] text-[#B1B3B8] hover:bg-[#2A3050]"
                  )}
                  onClick={() => handleSlippagePreset(preset)}
                >
                  {preset}%
                </button>
              ))}
              <div className="flex items-center bg-[#1C2235] rounded-[6px] px-2 border border-[#2A3050]">
                <input
                  type="number"
                  placeholder="Custom"
                  value={customSlippage}
                  onChange={(e) => handleCustomSlippageChange(e.target.value)}
                  className="w-14 bg-transparent text-white text-xs py-1.5 focus:outline-none"
                  min="0.1" max="50" step="0.1"
                />
                <span className="text-[#6B7280] text-xs">%</span>
              </div>
            </div>
            {slippageTolerance > 5 && (
              <div className="mt-2 text-[#FF9900] text-xs">High slippage may result in an unfavorable rate</div>
            )}
            {slippageTolerance < 0.1 && (
              <div className="mt-2 text-[#FF9900] text-xs">Low slippage may cause transaction to fail</div>
            )}
          </div>
        )}

        {/* Pool Selection — only BLUB-AQUA, no dropdown needed */}
        <div className="mt-5">
          {pools.length === 0 ? (
            <div className="w-full bg-[#0A0D14] text-[#6B7280] p-6 rounded-[10px] text-center border border-[#1C2235]">
              <span className="text-sm">No liquidity pools available</span>
            </div>
          ) : (
            <div className="w-full bg-[#0A0D14] text-white p-3 rounded-[10px] border border-[#1C2235] text-sm flex items-center gap-3">
              <div className="flex items-center -space-x-1">
                <img src={TOKEN_LOGOS["BLUB"]} alt="BLUB" className="w-5 h-5 rounded-full" />
                <img src={TOKEN_LOGOS["AQUA"]} alt="AQUA" className="w-5 h-5 rounded-full" />
              </div>
              <span>BLUB / AQUA</span>
            </div>
          )}
        </div>

        {/* APY Cards + Reserves */}
        {selectedPool && (
          <div className="mt-5 space-y-3">
            {/* Banner */}
            <div className="bg-teal-500/10 border border-teal-500/30 rounded-lg p-3 mb-4 text-sm text-gray-200">
              💡 You're a backer in a crowdfunded liquidity pool. Every trade and reward earns you a cut, automatically. Reinvested for you, 24x a day.
            </div>

            {/* APY Row — two cards side by side */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-[#0A0D14] border border-[#00CC99]/20 rounded-[10px] p-4">
                <div className="flex items-center gap-1 mb-1">
                  <div className="text-xs text-[#6B7280]">Pool APY</div>
                  <InformationCircleIcon
                    className="h-[13px] w-[13px] text-[#6B7280] cursor-pointer flex-shrink-0"
                    onClick={() => onDialogOpen(
                      "The base earnings rate of the AQUA-BLUB pool on Aquarius. This is what you'd get providing liquidity manually, without WhaleHub.\n\nThe raw return before reinvestment.\n\nSource: trading fees from every swap, plus AQUA rewards distributed to active liquidity pools.",
                      "Pool APY"
                    )}
                  />
                </div>
                <div className="text-xl font-bold text-[#00CC99]">
                  {poolApy === "--" ? "--" : `${poolApy}%`}
                </div>
                <div className="text-[10px] text-[#6B7280] mt-0.5">via Aquarius</div>
              </div>
              <div className="bg-[#0A0D14] border border-[#3B82F6]/20 rounded-[10px] p-4">
                <div className="flex items-center gap-1 mb-1">
                  <div className="text-xs text-[#6B7280]">Compounded APY</div>
                  <InformationCircleIcon
                    className="h-[13px] w-[13px] text-[#6B7280] cursor-pointer flex-shrink-0"
                    onClick={() => onDialogOpen(
                      "Your actual return through WhaleHub's vault. Higher than the base Pool APY because earnings are automatically reinvested into your position 24 times a day.\n\nEach reinvestment grows your backer share a tiny bit, and those tiny bits compound into a meaningfully higher annual return.\n\nDoing this manually would mean claiming and re-depositing every hour, 24/7. The vault does it for you, automatically.",
                      "Compounded APY"
                    )}
                  />
                </div>
                <div className="text-xl font-bold text-[#3B82F6]">
                  {compoundApy === "--" ? "--" : `${compoundApy}%`}
                </div>
                <div className="text-[10px] text-[#6B7280] mt-0.5">24× daily auto-compound · <span className="text-[#3B82F6]/80">via Whalehub</span></div>
              </div>
            </div>

            {/* ICE Boost Info — hidden until boost is routed through admin
            {iceBoost && iceBoost.ourLp > 0 && (
              <div className="bg-[#0A0D14] border border-[#8B5CF6]/20 rounded-[10px] p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-[#6B7280] mb-1">ICE Boost</div>
                    <div className={`text-xl font-bold ${iceBoost.boost >= 2.49 ? "text-[#8B5CF6]" : iceBoost.boost > 1.01 ? "text-[#A78BFA]" : "text-[#6B7280]"}`}>
                      {iceBoost.boost.toFixed(2)}x
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] text-[#6B7280]">
                      Pool share: {iceBoost.lpSharePct < 0.01 ? "<0.01" : iceBoost.lpSharePct.toFixed(2)}%
                    </div>
                    <div className="text-[10px] text-[#6B7280]">
                      ICE: {(iceBoost.myIce / 1e6).toFixed(1)}M / {(iceBoost.totalIce / 1e9).toFixed(0)}B
                    </div>
                    {iceBoost.boost >= 2.49 ? (
                      <div className="text-[10px] text-[#8B5CF6] mt-0.5">Max boost active</div>
                    ) : (
                      <div className="text-[10px] text-[#6B7280] mt-0.5">
                        2.5x up to {iceBoost.maxLpFor2_5x.toFixed(0)} LP
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
            */}

            {/* Pool Reserves */}
            <div className="bg-[#0A0D14] border border-[#1C2235] rounded-[10px] p-4">
              <div className="text-xs text-[#6B7280] uppercase tracking-wider mb-2">Pool Reserves</div>
              <div className="flex justify-between text-sm">
                <div className="flex items-center space-x-1.5">
                  {TOKEN_LOGOS[selectedPool.token_a_code] && (
                    <img src={TOKEN_LOGOS[selectedPool.token_a_code]} alt={selectedPool.token_a_code} className="w-4 h-4 rounded-full" />
                  )}
                  <span className="text-[#B1B3B8]">{selectedPool.token_a_code}</span>
                </div>
                <span className="text-white font-medium">
                  {parseFloat(reserveA) > 0
                    ? <>
                        {parseFloat(reserveA).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        {(() => {
                          const p = selectedPool.token_a_code === "BLUB" ? blubPrice : selectedPool.token_a_code === "AQUA" ? aquaPrice : 0;
                          return parseFloat(reserveA) > 0 ? <span className="text-[#6B7280] text-xs ml-1">{formatUsd(reserveA, p)}</span> : null;
                        })()}
                      </>
                    : <span className="text-[#6B7280]">Loading...</span>}
                </span>
              </div>
              <div className="flex justify-between text-sm mt-2">
                <div className="flex items-center space-x-1.5">
                  {TOKEN_LOGOS[selectedPool.token_b_code] && (
                    <img src={TOKEN_LOGOS[selectedPool.token_b_code]} alt={selectedPool.token_b_code} className="w-4 h-4 rounded-full" />
                  )}
                  <span className="text-[#B1B3B8]">{selectedPool.token_b_code}</span>
                </div>
                <span className="text-white font-medium">
                  {parseFloat(reserveB) > 0
                    ? <>
                        {parseFloat(reserveB).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        {(() => {
                          const p = selectedPool.token_b_code === "BLUB" ? blubPrice : selectedPool.token_b_code === "AQUA" ? aquaPrice : 0;
                          return parseFloat(reserveB) > 0 ? <span className="text-[#6B7280] text-xs ml-1">{formatUsd(reserveB, p)}</span> : null;
                        })()}
                      </>
                    : <span className="text-[#6B7280]">Loading...</span>}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* User Position */}
        {userPosition && userPosition.active && (
          <div className="mt-4 bg-[#0A0D14] border border-[#00CC99]/20 rounded-[10px] p-4">
            {/* Header */}
            <div className="flex items-center gap-1 mb-2">
              <div className="text-xs text-[#6B7280]">Your Position</div>
              <InformationCircleIcon
                className="h-[13px] w-[13px] text-[#6B7280] cursor-pointer flex-shrink-0"
                onClick={() => onDialogOpen(
                  "Your share of the crowdfunded vault. The LP tokens you hold represent your contribution.\n\nBigger contribution = bigger cut of every trade fee + bigger share of AQUA rewards. All reinvested for you, every hour.\n\nWithdraw anytime. No lockups.",
                  "Your Position"
                )}
              />
            </div>

            {/* LP + USD inline */}
            <div className="text-base font-semibold text-white mb-2">
              {parseFloat(userPosition.user_lp_amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} LP{" "}
              <span className="text-[#6B7280] text-xs font-normal">
                {positionValueUsd === null ? "" : positionValueUsd > 0 ? `($${formatPositionUsd(positionValueUsd)})` : "(...)"}
              </span>
              {" "}<span className="text-[#6B7280] text-xs font-normal">your slice of the pool</span>
            </div>

            {userCompoundGains && parseFloat(userCompoundGains.compoundGainLp) > 0 && (
              <div className="text-xs text-[#00CC99] mb-2">
                +{fmtNum(userCompoundGains.compoundGainLp)} LP from compounding
              </div>
            )}

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <div className="text-xs text-[#00CC99] font-medium">✅ Earning Boosted Rewards</div>
                <InformationCircleIcon
                  className="h-[13px] w-[13px] text-[#6B7280] cursor-pointer flex-shrink-0"
                  onClick={() => onDialogOpen(
                    "Your position is currently earning the maximum reward tier the pool qualifies for, thanks to WhaleHub's pooled ICE voting power.\n\nSolo, you'd earn the base rate. Together with every other backer in the vault, the pool unlocks higher reward tiers individuals can't reach alone.",
                    "Earning Boosted Rewards"
                  )}
                />
              </div>
              {compoundStats && compoundStats.compoundCount > 0 && (
                <div className="flex items-center gap-1">
                  <div className="text-[10px] text-[#6B7280]">
                    Auto-compounded {compoundStats.compoundCount.toLocaleString()}x since you deposited
                  </div>
                  <InformationCircleIcon
                    className="h-[13px] w-[13px] text-[#6B7280] cursor-pointer flex-shrink-0"
                    onClick={() => onDialogOpen(
                      "Every hour, the vault takes the fees and rewards it earned and instantly puts them back into your position.\n\nEach reinvestment grows your backer share a tiny bit, and those tiny bits add up.\n\nDoing this manually would mean claiming, swapping, and re-depositing every hour, 24/7. The vault does it for you, for free.",
                      "Auto-Compounded"
                    )}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex mt-6 space-x-1 bg-[#0A0D14] p-1 rounded-[10px] border border-[#1C2235]">
          <button
            className={clsx(
              "flex-1 py-2 rounded-[8px] text-sm font-medium transition-colors",
              activeTab === "deposit"
                ? "bg-[#00CC99] text-white shadow-sm"
                : "text-[#6B7280] hover:text-white"
            )}
            onClick={() => setActiveTab("deposit")}
          >
            Deposit
          </button>
          <button
            className={clsx(
              "flex-1 py-2 rounded-[8px] text-sm font-medium transition-colors",
              activeTab === "withdraw"
                ? "bg-[#00CC99] text-white shadow-sm"
                : "text-[#6B7280] hover:text-white"
            )}
            onClick={() => setActiveTab("withdraw")}
          >
            Withdraw
          </button>
        </div>

        {/* Deposit Tab */}
        {activeTab === "deposit" && selectedPool && (
          <div className="mt-5 space-y-4">
            <div className="text-xs text-[#B1B3B8] italic mb-1">
              Auto-compounded every hour. Your share of pool fees and AQUA rewards are reinvested for you automatically. No claiming, no manual work.
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-1">
                  <span className="text-sm text-[#B1B3B8]">Single asset deposit</span>
                  <InformationCircleIcon
                    className="h-[13px] w-[13px] text-[#6B7280] cursor-pointer flex-shrink-0"
                    onClick={() => onDialogOpen(
                      "Deposit just AQUA or just BLUB. The vault automatically splits and pairs your token to enter the pool.\n\nYou don't need both tokens to become a backer.",
                      "Single Asset Deposit"
                    )}
                  />
                </div>
                <div className="text-[10px] text-[#6B7280]">Deposit only one token, vault handles the rest</div>
              </div>
              <button
                onClick={() => {
                  setSingleAsset(!singleAsset);
                  setDepositAmount1("");
                  setDepositAmount2("");
                }}
                className={clsx(
                  "relative inline-flex h-5 w-10 items-center rounded-full transition-colors focus:outline-none",
                  singleAsset ? "bg-[#00CC99]" : "bg-[#2A3050]"
                )}
              >
                <span
                  className={clsx(
                    "inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform",
                    singleAsset ? "translate-x-5" : "translate-x-1"
                  )}
                />
              </button>
            </div>

            {singleAsset ? (
              /* Single-asset mode: token selector + single input */
              <div>
                {/* Token selector */}
                <div className="flex items-center gap-2 mb-2">
                  {[
                    { key: "a" as const, code: selectedPool.token_a_code, bal: balanceA },
                    { key: "b" as const, code: selectedPool.token_b_code, bal: balanceB },
                  ].map((t) => (
                    <button
                      key={t.key}
                      onClick={() => {
                        setSingleAssetToken(t.key);
                        setDepositAmount1("");
                      }}
                      className={clsx(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-sm font-medium transition-colors border",
                        singleAssetToken === t.key
                          ? "border-[#00CC99] bg-[#00CC99]/10 text-white"
                          : "border-[#1C2235] bg-[#0A0D14] text-[#6B7280] hover:border-[#2A3050]"
                      )}
                    >
                      {TOKEN_LOGOS[t.code] && (
                        <img src={TOKEN_LOGOS[t.code]} alt={t.code} className="w-4 h-4 rounded-full" />
                      )}
                      {t.code}
                    </button>
                  ))}
                </div>

                <div className="flex justify-between items-center mb-1.5">
                  <label className="text-xs text-[#6B7280] uppercase tracking-wider">
                    {singleAssetToken === "a" ? selectedPool.token_a_code : selectedPool.token_b_code}
                  </label>
                  <span className="text-xs text-[#6B7280]">
                    Balance: {isLoadingBalances ? "..." : fmtNum(singleAssetToken === "a" ? balanceA : balanceB)}
                  </span>
                </div>
                <div className="flex items-center bg-[#0A0D14] border border-[#1C2235] rounded-[10px] px-3 py-2 focus-within:border-[#00CC99] transition-colors">
                  {TOKEN_LOGOS[singleAssetToken === "a" ? selectedPool.token_a_code : selectedPool.token_b_code] && (
                    <img
                      src={TOKEN_LOGOS[singleAssetToken === "a" ? selectedPool.token_a_code : selectedPool.token_b_code]}
                      alt={singleAssetToken === "a" ? selectedPool.token_a_code : selectedPool.token_b_code}
                      className="w-5 h-5 rounded-full mr-2 flex-shrink-0"
                    />
                  )}
                  <Input
                    placeholder="0"
                    value={depositAmount1}
                    type="text"
                    inputMode="decimal"
                    className="flex-1 bg-transparent text-white text-sm focus:outline-none focus:ring-0 border-none min-w-0"
                    onChange={(e) => handleAmount1Change(e.target.value)}
                  />
                  <button
                    className="ml-2 text-xs text-[#00CC99] hover:text-white transition-colors font-medium flex-shrink-0"
                    onClick={() => handleAmount1Change(singleAssetToken === "a" ? balanceA : balanceB)}
                  >
                    MAX
                  </button>
                </div>
              </div>
            ) : (
              /* Dual-asset mode: Token A + Token B inputs */
              <>
                {/* Token A */}
                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="text-xs text-[#6B7280] uppercase tracking-wider">{selectedPool.token_a_code}</label>
                    <span className="text-xs text-[#6B7280]">
                      Balance: {isLoadingBalances ? "..." : fmtNum(balanceA)}
                    </span>
                  </div>
                  <div className="flex items-center bg-[#0A0D14] border border-[#1C2235] rounded-[10px] px-3 py-2 focus-within:border-[#00CC99] transition-colors">
                    {TOKEN_LOGOS[selectedPool.token_a_code] && (
                      <img src={TOKEN_LOGOS[selectedPool.token_a_code]} alt={selectedPool.token_a_code} className="w-5 h-5 rounded-full mr-2 flex-shrink-0" />
                    )}
                    <Input
                      placeholder="0"
                      value={depositAmount1}
                      type="text"
                      inputMode="decimal"
                      className="flex-1 bg-transparent text-white text-sm focus:outline-none focus:ring-0 border-none min-w-0"
                      onChange={(e) => handleAmount1Change(e.target.value)}
                    />
                    <button
                      className="ml-2 text-xs text-[#00CC99] hover:text-white transition-colors font-medium flex-shrink-0"
                      onClick={() => handleAmount1Change(balanceA)}
                    >
                      MAX
                    </button>
                  </div>
                </div>

                {/* Token B */}
                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="text-xs text-[#6B7280] uppercase tracking-wider">{selectedPool.token_b_code}</label>
                    <span className="text-xs text-[#6B7280]">
                      Balance: {isLoadingBalances ? "..." : fmtNum(balanceB)}
                    </span>
                  </div>
                  <div className="flex items-center bg-[#0A0D14] border border-[#1C2235] rounded-[10px] px-3 py-2 focus-within:border-[#00CC99] transition-colors">
                    {TOKEN_LOGOS[selectedPool.token_b_code] && (
                      <img src={TOKEN_LOGOS[selectedPool.token_b_code]} alt={selectedPool.token_b_code} className="w-5 h-5 rounded-full mr-2 flex-shrink-0" />
                    )}
                    <Input
                      placeholder="0"
                      value={depositAmount2}
                      type="text"
                      inputMode="decimal"
                      className="flex-1 bg-transparent text-white text-sm focus:outline-none focus:ring-0 border-none min-w-0"
                      onChange={(e) => handleAmount2Change(e.target.value)}
                    />
                    <button
                      className="ml-2 text-xs text-[#00CC99] hover:text-white transition-colors font-medium flex-shrink-0"
                      onClick={() => handleAmount2Change(balanceB)}
                    >
                      MAX
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* Transaction Summary */}
            {depositAmount1 && parseFloat(depositAmount1) > 0 && (singleAsset || (depositAmount2 && parseFloat(depositAmount2) > 0)) && (
              <div className="bg-[#070910] border border-[#1C2235] rounded-[10px] p-4">
                <div className="text-xs text-[#6B7280] uppercase tracking-wider mb-3">Transaction Summary</div>
                <div className="space-y-2.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-[#B1B3B8]">You deposit</span>
                    <div className="text-right">
                      {singleAsset ? (
                        <div className="text-white">
                          {fmtNum(depositAmount1)} {singleAssetToken === "a" ? selectedPool.token_a_code : selectedPool.token_b_code}
                        </div>
                      ) : (
                        <>
                          <div className="text-white">{fmtNum(depositAmount1)} {selectedPool.token_a_code}</div>
                          {depositAmount2 && parseFloat(depositAmount2) > 0 && (
                            <div className="text-white">{fmtNum(depositAmount2)} {selectedPool.token_b_code}</div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  <div className="border-t border-[#1C2235]" />
                  <div className="flex justify-between">
                    <span className="text-[#B1B3B8]">Expected LP tokens</span>
                    <span className="text-white font-medium">
                      ~{fmtNum(calculateExpectedShares(
                        parseFloat(depositAmount1 || "0"),
                        parseFloat(depositAmount2 || "0")
                      ))}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#B1B3B8]">Min LP ({slippageTolerance}% slippage)</span>
                    <span className="text-[#00CC99] font-medium">
                      ~{fmtNum(parseFloat(calculateExpectedShares(
                        parseFloat(depositAmount1 || "0"),
                        parseFloat(depositAmount2 || "0")
                      )) * (1 - slippageTolerance / 100))}
                    </span>
                  </div>
                </div>
              </div>
            )}

            <Button
              className="rounded-[12px] py-5 px-4 text-white w-full bg-[linear-gradient(180deg,_#00CC99_0%,_#005F99_100%)] text-base font-semibold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleDeposit}
              disabled={isDepositing || !selectedPool}
            >
              {isDepositing ? (
                <div className="flex justify-center items-center gap-2">
                  <span>Depositing...</span>
                  <TailSpin height="18" width="18" color="#ffffff" ariaLabel="loading" radius="1" visible={true} />
                </div>
              ) : (
                <span>Deposit & Earn</span>
              )}
            </Button>
          </div>
        )}

        {/* Withdraw Tab */}
        {activeTab === "withdraw" && selectedPool && (
          <div className="mt-5 space-y-4">
            {!userPosition || !userPosition.active ? (
              <div className="text-center py-10 text-[#6B7280] text-sm">
                No position to withdraw
              </div>
            ) : (
              <>
                {/* Position card */}
                <div className="bg-[#0A0D14] border border-[#1C2235] rounded-[10px] p-4 space-y-2 text-sm">
                  <div className="text-xs text-[#6B7280] uppercase tracking-wider mb-2">Your Position</div>
                  <div className="flex justify-between text-white">
                    <span className="text-[#B1B3B8]">LP Tokens</span>
                    <span className="font-medium">
                      {parseFloat(userPosition.user_lp_amount || "0").toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      <span className="text-[#6B7280] text-xs font-normal ml-1">
                        {positionValueUsd === null ? "" : positionValueUsd > 0 ? `($${formatPositionUsd(positionValueUsd)})` : "(...)"}
                      </span>
                    </span>
                  </div>
                  <div className="flex justify-between text-white">
                    <span className="text-[#B1B3B8]">Pool Share</span>
                    <span>{fmtNum(userPosition.percentage || "0", 2)}%</span>
                  </div>
                  {userCompoundGains && parseFloat(userCompoundGains.compoundGainLp) > 0 && (
                    <div className="flex justify-between text-[#00CC99]">
                      <span>Compound Gains</span>
                      <span>+{fmtNum(userCompoundGains.compoundGainLp)} LP</span>
                    </div>
                  )}
                  {compoundStats && compoundStats.compoundCount > 0 && (
                    <div className="pt-2 border-t border-[#1C2235] text-xs text-[#6B7280]">
                      Auto-compounded {compoundStats.compoundCount.toLocaleString()}×
                      {compoundStats.lastCompoundTime > 0 && (
                        <span className="ml-1.5">(last: {new Date(compoundStats.lastCompoundTime * 1000).toLocaleDateString()})</span>
                      )}
                    </div>
                  )}
                </div>

                {/* Withdrawal % */}
                <div>
                  <label className="text-xs text-[#6B7280] uppercase tracking-wider mb-2 block">Withdrawal Amount</label>
                  <div className="flex items-center bg-[#0A0D14] border border-[#1C2235] rounded-[10px] px-3 py-2 focus-within:border-[#00CC99] transition-colors">
                    <Input
                      type="number"
                      min="1" max="100"
                      value={withdrawPercent}
                      className="flex-1 bg-transparent text-white text-sm focus:outline-none focus:ring-0 border-none"
                      onChange={(e) => setWithdrawPercent(Math.min(100, Math.max(0, parseInt(e.target.value) || 0)))}
                    />
                    <span className="text-[#6B7280] text-sm ml-1">%</span>
                  </div>
                  <div className="flex items-center space-x-2 mt-2">
                    {[25, 50, 75, 100].map((preset) => (
                      <button
                        key={preset}
                        className={clsx(
                          "flex-1 py-1.5 rounded-[6px] text-xs font-medium transition-colors",
                          withdrawPercent === preset
                            ? "bg-[#00CC99] text-white"
                            : "bg-[#1C2235] text-[#B1B3B8] hover:bg-[#2A3050]"
                        )}
                        onClick={() => setWithdrawPercent(preset)}
                      >
                        {preset}%
                      </button>
                    ))}
                  </div>
                </div>

                {/* Receipt summary */}
                <div className="bg-[#070910] border border-[#1C2235] rounded-[10px] p-4">
                  <div className="text-xs text-[#6B7280] uppercase tracking-wider mb-3">You will receive</div>
                  <div className="space-y-2.5 text-sm">
                    <div className="flex justify-between text-white">
                      <span className="text-[#B1B3B8]">{selectedPool.token_a_code}</span>
                      <span>~{fmtNum(getEstimatedWithdrawAmounts().estimatedA)}</span>
                    </div>
                    <div className="flex justify-between text-white">
                      <span className="text-[#B1B3B8]">{selectedPool.token_b_code}</span>
                      <span>~{fmtNum(getEstimatedWithdrawAmounts().estimatedB)}</span>
                    </div>
                    <div className="border-t border-[#1C2235] pt-2.5">
                      <div className="text-xs text-[#6B7280] mb-2">Minimum ({slippageTolerance}% slippage)</div>
                      <div className="flex justify-between text-[#00CC99]">
                        <span>{selectedPool.token_a_code}</span>
                        <span>{fmtNum(parseFloat(getEstimatedWithdrawAmounts().estimatedA) * (1 - slippageTolerance / 100))}</span>
                      </div>
                      <div className="flex justify-between text-[#00CC99] mt-1">
                        <span>{selectedPool.token_b_code}</span>
                        <span>{fmtNum(parseFloat(getEstimatedWithdrawAmounts().estimatedB) * (1 - slippageTolerance / 100))}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <Button
                  className="rounded-[12px] py-5 px-4 text-white w-full bg-[linear-gradient(180deg,_#00CC99_0%,_#005F99_100%)] text-base font-semibold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={handleWithdraw}
                  disabled={isWithdrawing}
                >
                  {isWithdrawing ? (
                    <div className="flex justify-center items-center gap-2">
                      <span>Withdrawing...</span>
                      <TailSpin height="18" width="18" color="#ffffff" ariaLabel="loading" radius="1" visible={true} />
                    </div>
                  ) : (
                    <span>Withdraw {withdrawPercent}%</span>
                  )}
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      <DialogC
        msg={dialogMsg}
        openDialog={openDialog}
        dialogTitle={dialogTitle}
        closeModal={closeModal}
      />
    </div>
  );
}

export default AddLiquidity;
