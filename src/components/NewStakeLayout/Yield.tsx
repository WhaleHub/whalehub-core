import clsx from "clsx";
import { Button, Input } from "@headlessui/react";
import { useEffect, useState, useMemo } from "react";
import { useAppDispatch } from "../../lib/hooks";
import { useSelector } from "react-redux";
import { RootState } from "../../lib/store";
import {
  FREIGHTER_ID,
  FreighterModule,
  LOBSTR_ID,
  LobstrModule,
  StellarWalletsKit,
  WalletNetwork,
} from "@creit.tech/stellar-wallets-kit";
import { toast } from "react-toastify";
import {
  getAccountInfo,
  lockingAqua,
  resetStateValues,
  restaking,
  storeAccountBalance,
  unStakingAqua,
} from "../../lib/slices/userSlice";
// Note: Backend API calls (lockAqua, unlockAqua, restakeBlub) are deprecated for Soroban
// We now query data directly from smart contracts using fetchComprehensiveStakingData
import { StellarService } from "../../services/stellar.service";
import { Balance } from "../../utils/interfaces";
import {
  blubAssetCode,
  blubIssuer,
  blubIssuerPublicKey,
  lpSignerPublicKey,
} from "../../utils/constants";
// calculateAPY no longer needed in this component
import {
  Asset,
  BASE_FEE,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { TailSpin } from "react-loader-spinner";
import { InformationCircleIcon } from "@heroicons/react/16/solid";
import { walletTypes } from "../../enums";
import { signTransaction } from "@lobstrco/signer-extension-api";
import DialogC from "./Dialog";
import { kit } from "../Navbar";
import { WALLET_CONNECT_ID } from "@creit.tech/stellar-wallets-kit/modules/walletconnect.module";
import { ensureTrustline } from "../../utils/trustline.helper";
import { useTokenPrice, formatUsd } from "../../hooks/useTokenPrice";

function Yield() {
  const dispatch = useAppDispatch();
  const [blubStakeAmount, setBlubStakeAmount] = useState<number | null>(0);
  const [blubUnstakeAmount, setBlubUnstakeAmount] = useState<number | null>(0);
  const [dialogMsg, setDialogMsg] = useState<string>("");
  const [openDialog, setOptDialog] = useState<boolean>(false);
  const [dialogTitle, setDialogTitle] = useState<string>("");

  // Reward state
  const [, setPendingRewards] = useState<string>("0.00");
  const [rewardInfo, setRewardInfo] = useState<any>(null);

  // Soroban BLUB balance state
  const [sorobanBlubBalance, setSorobanBlubBalance] = useState<string>("0");
  const [blubStakedBalance, setBlubStakedBalance] = useState<string>("0.00");
  const [lpPositionData, setLpPositionData] = useState<any>(null);
  const [polData, setPolData] = useState<any>(null);
  const [blubBalanceLoading, setBlubBalanceLoading] = useState<boolean>(false);
  const [locksExpanded, setLocksExpanded] = useState<boolean>(false);


  const user = useSelector((state: RootState) => state.user);
  const staking = useSelector((state: RootState) => state.staking);
  const blubPrice = useTokenPrice("BLUB");

  const blubRecord = user?.userRecords?.balances?.find(
    (balance) =>
      balance.asset_code === "BLUB" && balance.asset_issuer === blubIssuer
  );

  // //get user aqua record
  // const aquaRecord = user?.userRecords?.balances?.find(
  //   (balance) => balance.asset_code === "AQUA"
  // );

  // Add defensive programming for claimable balance calculation
  const claimableBalance = useMemo(() => {
    try {
      if (!user?.userRecords?.account?.claimableRecords) {
        console.warn("💎 [Yield] No claimable records found, returning 0");
        return 0;
      }

      const filtered = user.userRecords.account.claimableRecords.filter(
        (item: any) => item && item.claimed === "UNCLAIMED"
      );

      if (filtered.length === 0) {
        return 0;
      }

      const total = filtered.reduce((total: any, item: any) => {
        const amount = parseFloat(item.amount) || 0;
        return total + amount;
      }, 0);

      return total;
    } catch (error) {
      console.error("💎 [Yield] Error calculating claimable balance:", error);
      return 0;
    }
  }, [user?.userRecords?.account?.claimableRecords]);

  // Use Soroban BLUB balance instead of Horizon API balance.
  // Defense-in-depth: the BLUB SAC returns i64::MAX (~922B) as the ISSUER's
  // "unlimited" balance (BLUB issuer = project/manager wallet). Cap any value far
  // above the real BLUB supply (~44M) to 0 so the issuer/manager wallet never shows
  // a bogus ~922B BLUB / $339M balance. queryBlubBalance already guards this; this
  // also protects the Horizon path and every consumer of blubBalance below.
  const blubBalance = (() => {
    const n = parseFloat(sorobanBlubBalance || "0");
    return Number.isFinite(n) && n <= 1_000_000_000 ? sorobanBlubBalance : "0";
  })();

  // Calculate accountClaimableRecords with defensive programming
  const accountClaimableRecords = useMemo(() => {
    try {
      if (!user?.userRecords?.account?.claimableRecords) {
        console.warn(
          "💎 [Yield] No claimable records found for accountClaimableRecords"
        );
        return 0;
      }

      const result = user.userRecords.account.claimableRecords
        .filter((record: any) => record && record.claimed === "UNCLAIMED")
        .reduce((total, record: any) => {
          const amount = Number(record.amount) || 0;
          return Number(total) + amount;
        }, 0);

      return result || 0;
    } catch (error) {
      console.error(
        "💎 [Yield] Error calculating accountClaimableRecords:",
        error
      );
      return 0;
    }
  }, [user?.userRecords?.account?.claimableRecords]);

  const userPoolBalances = useMemo(() => {
    try {
      if (!user?.userRecords?.account?.pools) {
        console.warn("💎 [Yield] No pools found for userPoolBalances");
        return 0;
      }

      const result = user.userRecords.account.pools
        .filter((pool: any) => pool && pool.claimed === "UNCLAIMED")
        .filter((pool: any) => pool.depositType === "LOCKER")
        .filter((pool: any) => pool.assetB && pool.assetB.code === "AQUA")
        .reduce((total, record: any) => {
          const amount = Number(record.assetBAmount) || 0;
          return Number(total) + amount;
        }, 0);

      return result || 0;
    } catch (error) {
      console.error("💎 [Yield] Error calculating userPoolBalances:", error);
      return 0;
    }
  }, [user?.userRecords?.account?.pools]);

  // Calculate unstakable BLUB from lock entries directly.
  // Contract v1.6.0+: unstake() checks blub_locked > 0 only (ignores unlocked flag),
  // so we match that logic here — any entry with BLUB remaining and cooldown passed is unstakeable.
  const poolAndClaimBalance = useMemo(() => {
    if (staking.lockEntries?.length > 0) {
      const now = Math.floor(Date.now() / 1000);
      const available = staking.lockEntries
        .filter(e => parseFloat(e.blubAmount) > 0 && e.unlockTime <= now)
        .reduce((sum, e) => sum + parseFloat(e.blubAmount), 0);
      if (available > 0) return available;
    }
    // Fallback to contract-reported value (may be 0 due to above issue)
    const unstakingAvailable = staking.userStats?.unstakingAvailable || "0";
    return Math.max(0, parseFloat(unstakingAvailable));
  }, [staking.lockEntries, staking.userStats?.unstakingAvailable]);

  // Fetch BLUB balance from Soroban contract
  const fetchSorobanBlubBalance = async () => {
    if (!user.userWalletAddress) return;

    setBlubBalanceLoading(true);
    try {
      const { sorobanService } = await import("../../services/soroban.service");
      const { fetchComprehensiveStakingData } = await import(
        "../../lib/slices/stakingSlice"
      );

      // Fetch comprehensive staking data to update Redux state (includes unstaking_available)
      await dispatch(fetchComprehensiveStakingData(user.userWalletAddress));

      // Fetch comprehensive user staking info (replaces deprecated queryAllBlubRestakes)
      const stakingInfo = await sorobanService.queryUserStakingInfo(
        user.userWalletAddress
      );

      // Fetch BLUB balance (wallet balance - unstaked)
      const balance = await sorobanService.queryBlubBalance(
        user.userWalletAddress
      );

      // Fetch LP position
      const poolId = "AQUA-BLUB";
      const lpPosition = await sorobanService
        .queryUserLpPosition(user.userWalletAddress, poolId)
        .catch(() => null);

      // Fetch POL info
      const polInfo = await sorobanService.queryPolInfo();

      // Set wallet balance (unstaked BLUB)
      const blubBalanceNumber = parseFloat(balance);

      // Fetch fresh account data directly from Horizon API
      const stellarService = new StellarService();
      const wrappedAccount = await stellarService.loadAccount(
        user.userWalletAddress
      );

      // Get BLUB balance from fresh Horizon data (source of truth)
      const freshBlubRecord = wrappedAccount.balances?.find(
        (balance: any) =>
          balance.asset_code === "BLUB" && balance.asset_issuer === blubIssuer
      );

      // PRIORITIZE Horizon API balance over Soroban contract balance
      // Horizon API is the source of truth for actual wallet balance
      // Store full 7-decimal precision — .toFixed(2) rounds UP and can exceed
      // the real on-chain balance, causing "InsufficientBalance" (#6) when
      // the user clicks Max and the contract tries to transfer the full amount.
      if (freshBlubRecord?.balance) {
        setSorobanBlubBalance(freshBlubRecord.balance);
      } else if (blubBalanceNumber > 0) {
        // Only use Soroban if Horizon is not available
        setSorobanBlubBalance(blubBalanceNumber.toFixed(7));
      } else {
        setSorobanBlubBalance("0");
      }

      // Set staked BLUB amount from the comprehensive staking info
      // Include BOTH locked positions AND unlockable positions (expired but not yet unstaked)
      if (stakingInfo) {
        const totalStaked =
          parseFloat(stakingInfo.total_staked_blub || "0") +
          parseFloat(stakingInfo.unstaking_available || "0");
        setBlubStakedBalance(totalStaked.toFixed(2));
      } else {
        setBlubStakedBalance("0.00");
      }

      // Set LP position data
      setLpPositionData(lpPosition);

      // Set POL data
      setPolData(polInfo);
    } catch (error: any) {
      console.error("❌ [Yield] Error fetching BLUB data:", error);

      // Fallback: Try to fetch from Horizon API directly
      try {
        const stellarService = new StellarService();
        const wrappedAccount = await stellarService.loadAccount(
          user.userWalletAddress
        );
        const freshBlubRecord = wrappedAccount.balances?.find(
          (balance: any) =>
            balance.asset_code === "BLUB" && balance.asset_issuer === blubIssuer
        );

        if (freshBlubRecord?.balance) {
          setSorobanBlubBalance(freshBlubRecord.balance);
        } else {
          setSorobanBlubBalance("0");
        }
      } catch (horizonError) {
        console.error("❌ [Yield] Horizon fallback failed:", horizonError);
        setSorobanBlubBalance("0");
      }

      // Don't reset blubStakedBalance to "0.00" on error - keep previous value
      // Redux state (staking.userStats) is already updated by fetchComprehensiveStakingData
      // which runs before the queries that may have failed
    } finally {
      setBlubBalanceLoading(false);
    }
  };

  // Fetch pending rewards from contract
  const fetchPendingRewards = async () => {
    if (!user.userWalletAddress) return;

    try {
      const { sorobanService } = await import("../../services/soroban.service");
      const rewardInfoData = await sorobanService.queryUserRewardInfo(
        user.userWalletAddress
      );

      if (rewardInfoData) {
        setPendingRewards(rewardInfoData.pending_rewards || "0");
        setRewardInfo(rewardInfoData);
      }
    } catch (error: any) {
      console.error("❌ [Yield] Error fetching pending rewards:", error);
      setPendingRewards("0");
    }
  };

  const handleSetMaxStakeBlub = () => {
    // Floor to 7 decimals (stroops) to never exceed on-chain balance
    const raw = parseFloat(blubBalance || "0");
    const floored = Math.floor(raw * 1e7) / 1e7;
    setBlubStakeAmount(floored);
  };

  const handleSetMaxDepositForUnstakeBlub = () => {
    // Use poolAndClaimBalance which correctly computes from lock entries
    setBlubUnstakeAmount(poolAndClaimBalance);
  };

  const handleUnstakeAqua = async () => {
    if (poolAndClaimBalance < 1 || Number(blubUnstakeAmount) < 1)
      return toast.warn("Nothing to unstake");

    if (Number(blubUnstakeAmount) > poolAndClaimBalance)
      return toast.warn("Unstake amount exceeds the pool balance");

    if (!user.userWalletAddress) {
      return toast.error("Please connect your wallet");
    }

    // Set loading state
    dispatch(unStakingAqua(true));

    try {
      // Ensure BLUB trustline exists before unstaking
      const trustlineResult = await ensureTrustline(
        user.userWalletAddress,
        blubAssetCode,
        blubIssuer,
        user.walletName || walletTypes.FREIGHTER,
        WalletNetwork.PUBLIC
      );

      if (!trustlineResult.hasTrustline && trustlineResult.error) {
        throw new Error(
          `Failed to setup BLUB trustline: ${trustlineResult.error}`
        );
      }

      if (trustlineResult.trustlineCreated) {
        toast.success("BLUB trustline created successfully!");
        // Add a small delay to ensure the trustline is propagated
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      // Import Soroban service
      const { sorobanService } = await import("../../services/soroban.service");
      const soroban = sorobanService;

      // Convert amount to stroops (7 decimals)
      const amountInStroops = Math.floor(
        Number(blubUnstakeAmount) * 10000000
      ).toString();

      // Build Soroban contract invocation transaction
      // unstake(user: Address, amount: i128)
      // Pass raw values - the sorobanService will convert them properly to ScVal
      const { transaction } = await soroban.buildContractTransaction(
        "staking",
        "unstake",
        [
          user.userWalletAddress, // String address - will be converted to Address ScVal
          amountInStroops, // String amount - will be converted to i128 ScVal
        ],
        user.userWalletAddress
      );

      // Sign transaction with user's wallet
      let signedTxXdr: string = "";
      if (user?.walletName === walletTypes.LOBSTR) {
        signedTxXdr = await signTransaction(transaction.toXDR());
      } else if (user?.walletName === walletTypes.WALLETCONNECT || user?.walletName === ("wallet_connect" as any)) {
        // Use shared WalletConnect kit from Navbar
        await kit.setWallet(WALLET_CONNECT_ID);
        const { signedTxXdr: signed } = await kit.signTransaction(
          transaction.toXDR(),
          {
            address: user.userWalletAddress,
            networkPassphrase: WalletNetwork.PUBLIC,
          }
        );
        signedTxXdr = signed;
      } else {
        // Freighter or default
        const freighterKit = new StellarWalletsKit({
          network: WalletNetwork.PUBLIC,
          selectedWalletId: FREIGHTER_ID,
          modules: [new FreighterModule()],
        });
        const { signedTxXdr: signed } = await freighterKit.signTransaction(
          transaction.toXDR(),
          {
            address: user.userWalletAddress,
            networkPassphrase: WalletNetwork.PUBLIC,
          }
        );
        signedTxXdr = signed;
      }

      // Submit the signed Soroban contract transaction
      const result = await soroban.submitSignedTransaction(signedTxXdr);

      if (!result.success) {
        throw new Error(result.error || "Unstaking transaction failed");
      }

      // Reset form
      setBlubUnstakeAmount(0);

      // Refresh all balances immediately after successful transaction
      try {
        await updateWalletRecordsWithDelay(2000);
        await fetchSorobanBlubBalance();
      } catch (refreshError) {
        console.error("[Yield] Refresh failed:", refreshError);
      }

      // Show success message after refresh
      toast.success(`Successfully unstaked ${blubUnstakeAmount} BLUB!`);
      setDialogTitle("Unstaking Successful!");

      // Secondary Soroban refresh after 7s — Soroban RPC can return stale data
      // for a few seconds after a tx confirms. This ensures the UI shows the
      // correct balance even if the first refresh hit a stale node.
      setTimeout(() => fetchSorobanBlubBalance().catch(() => {}), 7000);
      setDialogMsg(
        `Transaction Hash: ${result.transactionHash}\n\nYour BLUB has been unstaked and transferred to your wallet.`
      );
      setOptDialog(true);
    } catch (err: any) {
      console.error("[Yield] Unstaking failed:", err);
      toast.error(`Unstaking failed: ${err.message || "Please try again"}`);
      setDialogTitle("Unstaking Failed");
      setDialogMsg(
        `Error: ${err.message}\n\nPlease try again or contact support.`
      );
      setOptDialog(true);
    } finally {
      // Always reset the loading state
      dispatch(unStakingAqua(false));
    }
  };

  const updateWalletRecords = async () => {
    if (!user.userWalletAddress) return;
    const address = user.userWalletAddress;
    const stellarService = new StellarService();
    const wrappedAccount = await stellarService.loadAccount(address);
    dispatch(getAccountInfo(address));
    dispatch(storeAccountBalance(wrappedAccount.balances));
  };

  // Add delay-based balance refresh for better sync with backend
  // Uses user.userWalletAddress directly so it works for all wallet types
  // (Freighter, LOBSTR, WalletConnect).
  const updateWalletRecordsWithDelay = async (delayMs: number = 3000) => {
    if (!user.userWalletAddress) return;
    await new Promise((resolve) => setTimeout(resolve, delayMs));

    try {
      const address = user.userWalletAddress;
      const stellarService = new StellarService();
      const wrappedAccount = await stellarService.loadAccount(address);
      dispatch(getAccountInfo(address));
      dispatch(storeAccountBalance(wrappedAccount.balances));

      // Double-check after another short delay to ensure balance changes are visible
      setTimeout(async () => {
        try {
          const freshAccount = await stellarService.loadAccount(address);
          dispatch(storeAccountBalance(freshAccount.balances));
        } catch (error) {
          console.warn("Secondary balance refresh failed:", error);
        }
      }, 2000);
    } catch (error) {
      console.error("Error updating wallet records:", error);
    }
  };

  const handleRestake = async () => {
    if (!user?.userWalletAddress) {
      return toast.warn("Please connect wallet.");
    }

    if (!blubStakeAmount) {
      return toast.warn("Please input amount to stake.");
    }

    if (Number(blubBalance) < blubStakeAmount || !blubBalance) {
      return toast.warn(`Your balance is low`);
    }

    // Set loading state
    dispatch(restaking(true));

    try {
      // Ensure BLUB trustline exists before restaking
      const trustlineResult = await ensureTrustline(
        user.userWalletAddress,
        blubAssetCode,
        blubIssuer,
        user.walletName || walletTypes.FREIGHTER,
        WalletNetwork.PUBLIC
      );

      if (!trustlineResult.hasTrustline && trustlineResult.error) {
        throw new Error(
          `Failed to setup BLUB trustline: ${trustlineResult.error}`
        );
      }

      if (trustlineResult.trustlineCreated) {
        toast.success("BLUB trustline created successfully!");
        // Add a small delay to ensure the trustline is propagated
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      // Import Soroban service and config
      const { sorobanService } = await import("../../services/soroban.service");
      const { SOROBAN_CONFIG } = await import("../../config/soroban.config");

      // Build Soroban transaction for staking BLUB
      const stakeAmountStroops = Math.floor(blubStakeAmount * 10000000); // Convert to stroops
      const durationPeriods = 1; // Minimal value - rewards based on actual time staked

      // Build contract transaction with raw parameters
      // Pass raw values - the sorobanService will convert them properly to ScVal
      const { transaction } = await sorobanService.buildContractTransaction(
        "staking",
        "stake", // Contract function for BLUB staking (restaking)
        [
          user.userWalletAddress, // String address - will be converted to Address ScVal
          stakeAmountStroops.toString(), // String amount - will be converted to i128 ScVal
          durationPeriods, // Number duration - will be converted to u64 ScVal
        ],
        user.userWalletAddress
      );

      // Sign transaction with user's wallet
      let signedTxXdr: string = "";
      if (user?.walletName === walletTypes.LOBSTR) {
        signedTxXdr = await signTransaction(transaction.toXDR());
      } else if (user?.walletName === walletTypes.WALLETCONNECT || user?.walletName === ("wallet_connect" as any)) {
        // Use shared WalletConnect kit from Navbar
        await kit.setWallet(WALLET_CONNECT_ID);
        const { signedTxXdr: signed } = await kit.signTransaction(
          transaction.toXDR(),
          {
            address: user.userWalletAddress,
            networkPassphrase: WalletNetwork.PUBLIC,
          }
        );
        signedTxXdr = signed;
      } else {
        // Freighter or default
        const freighterKit = new StellarWalletsKit({
          network: WalletNetwork.PUBLIC,
          selectedWalletId: FREIGHTER_ID,
          modules: [new FreighterModule()],
        });
        const { signedTxXdr: signed } = await freighterKit.signTransaction(
          transaction.toXDR(),
          {
            address: user.userWalletAddress,
            networkPassphrase: WalletNetwork.PUBLIC,
          }
        );
        signedTxXdr = signed;
      }

      // Submit transaction
      const txResponse = await sorobanService
        .getServer()
        .sendTransaction(
          TransactionBuilder.fromXDR(signedTxXdr, Networks.PUBLIC)
        );

      // Wait for transaction confirmation
      let confirmed = false;
      let attempts = 0;
      const maxAttempts = 30;

      while (!confirmed && attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        try {
          const statusResponse = await sorobanService
            .getServer()
            .getTransaction(txResponse.hash);
          if (statusResponse.status === "SUCCESS") {
            confirmed = true;
            break;
          } else if (statusResponse.status === "FAILED") {
            throw new Error("Transaction failed on-chain");
          }
        } catch (error: any) {
          // Transaction still pending
          if (error?.message?.includes("Bad union switch")) {
            confirmed = true;
            break;
          }
        }
        attempts++;
      }

      if (!confirmed) {
        throw new Error("Transaction confirmation timeout");
      }

      const transactionHash = txResponse.hash;

      // Reset form
      setBlubStakeAmount(0);

      // Refresh all balances immediately after successful transaction
      try {
        // First, update wallet records to get fresh Horizon data
        await updateWalletRecordsWithDelay(2000);

        // Then fetch all staking data (fetchSorobanBlubBalance already calls
        // fetchComprehensiveStakingData internally, so no need to dispatch it separately)
        await fetchSorobanBlubBalance();
      } catch (refreshError) {
        console.error("[Yield] Refresh failed:", refreshError);
      }

      // Show success message after refresh
      toast.success(`Successfully restaked ${blubStakeAmount} BLUB!`);
      setDialogTitle("Restaking Successful!");
      setDialogMsg(
        `Transaction Hash: ${transactionHash}\n\nYour BLUB has been restaked.`
      );
      setOptDialog(true);
    } catch (err: any) {
      console.error("[Yield] Restaking failed:", err);
      toast.error(`Restaking failed: ${err.message || "Please try again"}`);
      setDialogTitle("Restaking Failed");
      setDialogMsg(
        `Error: ${err.message}\n\nPlease try again or contact support.`
      );
      setOptDialog(true);
    } finally {
      // Always reset the loading state
      dispatch(restaking(false));
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

  // Close modal on ESC key press or click outside
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      setOptDialog(false);
    }
  };

  useEffect(() => {
    if (openDialog) {
      window.addEventListener("keydown", handleKeyDown);
    } else {
      window.removeEventListener("keydown", handleKeyDown);
    }

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [openDialog]);

  // Fetch Soroban BLUB balance on component mount and when user changes
  useEffect(() => {
    if (user?.userWalletAddress) {
      // Initial fetch
      fetchSorobanBlubBalance();
      fetchPendingRewards();

      // Set up auto-refresh every 30 seconds for real-time updates
      const refreshInterval = setInterval(() => {
        fetchSorobanBlubBalance();
        fetchPendingRewards();
      }, 30000);

      // Cleanup interval on unmount
      return () => clearInterval(refreshInterval);
    }
  }, [user?.userWalletAddress]);

  useEffect(() => {
    if (user?.restaked) {
      updateWalletRecordsWithDelay(3000); // Add delay for backend processing
      fetchSorobanBlubBalance(); // Refresh BLUB balance
      toast.success("BLUB Locked successfully!");
      dispatch(resetStateValues());
      dispatch(restaking(false));
    }

    if (user?.unStakedAqua) {
      updateWalletRecordsWithDelay(3000); // Add delay for backend processing
      fetchSorobanBlubBalance(); // Refresh BLUB balance
      toast.success("Blub unstaked successfully!");
      dispatch(resetStateValues());
      dispatch(unStakingAqua(false));
    }
  }, [user?.restaked, user?.unStakedAqua]);

  return (
    <div id="Yield_section">
      <div className="max-w-[912px] mx-auto">
        <div className="text-white text-xl md:text-4xl-custom1 font-medium text-center">
          Reinvest Your Earnings
        </div>
        <div className="text-[#B1B3B8] text-base font-normal text-center max-w-[720px] mx-auto">
          Re-stake for compounding or provide liquidity for extra yield.
        </div>
      </div>
      <div className="mt-10 md:grid gap-5 grid-cols-1 max-w-[450px] mx-auto mb-10">
        <div>
          <div className="bg-[#0E111BCC] p-10 rounded-[16px] space-y-10">
            <div>
              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-2">
                  <img
                    src={"/Blub_logo2.svg"}
                    alt="Aqua"
                    className="w-8 h-8 rounded-full"
                  />
                  <span className="text-lg">BLUB</span>
                </div>
              </div>
              <div className="text-lg md:text-2xl font-medium text-white mt-5 flex items-center space-x-2">
                <div>Re-stake & Compound</div>
                <InformationCircleIcon
                  className="h-[15px] w-[15px] text-white cursor-pointer"
                  onClick={() =>
                    onDialogOpen(
                      "Instead of withdrawing your earned BLUB, you can put it back into the pool. Now your rewards earn rewards too.\n\nEvery BLUB you re-stake increases your backer share, which means your next reward payout is bigger than your last. The earlier and more often you re-stake, the faster your position snowballs.",
                      "Re-stake & Compound"
                    )
                  }
                />
              </div>
              <div className="text-xs text-[#B1B3B8] mt-2">
                Re-stake your earned BLUB. Bigger position = bigger share of next reward.
              </div>

              <div className="flex items-center bg-[#0E111B] py-2 space-x-2 mt-2 rounded-[8px]">
                <Input
                  placeholder="0 BLUB"
                  className={clsx(
                    "block w-full rounded-lg border-none bg-[#0E111B] px-3 text-sm/6 text-white",
                    "focus:outline-none data-[focus]:outline-2 data-[focus]:-outline-offset-2 data-[focus]:outline-[#3C404D]",
                    "w-full p-3 bg-none"
                  )}
                  value={blubStakeAmount !== null ? blubStakeAmount : ""}
                  onChange={(e) =>
                    setBlubStakeAmount(
                      e.target.value ? Number(e.target.value) : null
                    )
                  }
                />
                <button
                  className="bg-[#3C404D] p-2 rounded-[4px]"
                  onClick={handleSetMaxStakeBlub}
                >
                  Max
                </button>
              </div>

              <div className="flex items-center text-normal mt-6 space-x-1">
                <div className="font-normal text-[#B1B3B8]">Your BLUB Balance:</div>
                <div className="font-medium">
                  {`${
                    isNaN(Number(blubBalance))
                      ? "0.00"
                      : Number(blubBalance).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                  } BLUB`}
                  {blubPrice > 0 && Number(blubBalance) > 0 && (
                    <span className="text-[#6B7280] text-sm ml-1">{formatUsd(blubBalance, blubPrice)}</span>
                  )}
                </div>
              </div>

              {rewardInfo && parseFloat(rewardInfo.pending_rewards) > 0 && (
                <div className="mt-3 bg-[#0A0D14] rounded-[8px] px-3 py-2 flex flex-col">
                  <span className="text-[11px] text-[#B1B3B8] leading-tight">Rewards to be distributed</span>
                  <span className="text-[12px] font-medium text-[#00CC99] leading-tight mt-1">
                    {parseFloat(rewardInfo.pending_rewards).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} BLUB
                  </span>
                  <span className="text-[11px] text-[#6B7280] leading-tight">
                    {formatUsd(rewardInfo.pending_rewards, blubPrice)}
                  </span>
                </div>
              )}

              <Button
                className="rounded-[12px] py-5 px-4 text-white mt-10 w-full bg-[linear-gradient(180deg,_#00CC99_0%,_#005F99_100%)] text-base font-semibold"
                onClick={handleRestake}
              >
                {!user?.restaking ? (
                  <span>Re-stake</span>
                ) : (
                  <div className="flex justify-center items-center gap-[10px]">
                    <span className="text-white">Processing...</span>
                    <TailSpin
                      height="18"
                      width="18"
                      color="#ffffff"
                      ariaLabel="tail-spin-loading"
                      radius="1"
                      wrapperStyle={{}}
                      wrapperClass=""
                      visible={true}
                    />
                  </div>
                )}
              </Button>
            </div>

            <hr className="border-[1px] border-solid border-[#3C404D]" />

            <div>
              <div className="flex items-center bg-[#0E111B] py-2 space-x-2 mt-2 rounded-[8px]">
                <Input
                  placeholder="0 BLUB"
                  className={clsx(
                    "block w-full rounded-lg border-none bg-[#0E111B] px-3 text-sm/6 text-white",
                    "focus:outline-none data-[focus]:outline-2 data-[focus]:-outline-offset-2 data-[focus]:outline-[#3C404D]",
                    "w-full p-3 bg-none"
                  )}
                  onChange={(e) =>
                    setBlubUnstakeAmount(
                      e.target.value ? Number(e.target.value) : null
                    )
                  }
                  value={blubUnstakeAmount !== null ? blubUnstakeAmount : ""}
                />
                <button
                  className="bg-[#3C404D] p-2 rounded-[4px]"
                  onClick={handleSetMaxDepositForUnstakeBlub}
                >
                  Max{" "}
                </button>
              </div>

              <div className="flex items-center text-normal mt-6 space-x-1">
                <div className="font-normal text-[#B1B3B8]">
                  Available to Unstake:
                </div>
                {blubBalanceLoading ? (
                  <TailSpin
                    height="14"
                    width="14"
                    color="#B1B3B8"
                    ariaLabel="loading"
                    radius="1"
                    visible={true}
                  />
                ) : (
                  <div className="font-medium">
                    {`${poolAndClaimBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} BLUB`}
                    {blubPrice > 0 && poolAndClaimBalance > 0 && (
                      <span className="text-[#6B7280] text-sm ml-1">{formatUsd(poolAndClaimBalance, blubPrice)}</span>
                    )}
                  </div>
                )}
              </div>
              {(parseFloat(staking.userStats?.totalAmount || "0") > 0 || parseFloat(blubStakedBalance) > 0) && staking.lockEntries?.length > 0 && (
                <div className="mt-2">
                  <button
                    onClick={() => setLocksExpanded(!locksExpanded)}
                    className="text-[11px] text-[#00CC99] hover:underline cursor-pointer"
                  >
                    {locksExpanded ? "▾ Hide" : "▸ Show"} lock details ({staking.lockEntries?.filter(e => parseFloat(e.blubAmount) > 0).length ?? 0} entries)
                  </button>
                  {locksExpanded && (
                    <div className="mt-2 space-y-1 max-h-[180px] overflow-y-auto">
                      {(staking.lockEntries ?? [])
                        .filter(e => parseFloat(e.blubAmount) > 0)
                        .sort((a, b) => a.unlockTime - b.unlockTime)
                        .map((entry) => {
                          const now = Math.floor(Date.now() / 1000);
                          const remaining = entry.unlockTime - now;
                          const isReady = remaining <= 0;
                          const unlockDate = new Date(entry.unlockTime * 1000);

                          return (
                            <div
                              key={entry.index}
                              className="flex items-center justify-between bg-[#0E111B] rounded-[6px] px-3 py-2 text-[11px]"
                            >
                              <div className="flex items-center space-x-2">
                                <span className={isReady ? "text-[#00CC99]" : "text-[#FFA500]"}>
                                  {isReady ? "🔓" : "🔒"}
                                </span>
                                <span className="text-white font-medium">
                                  {entry.blubAmount} BLUB
                                  {blubPrice > 0 && parseFloat(entry.blubAmount) > 0 && (
                                    <span className="text-[#6B7280] text-[10px] ml-1">{formatUsd(entry.blubAmount, blubPrice)}</span>
                                  )}
                                </span>
                              </div>
                              <div className="text-right">
                                {isReady ? (
                                  <span className="text-[#00CC99]">Ready</span>
                                ) : (
                                  <span className="text-[#B1B3B8]">
                                    {Math.floor(remaining / 86400)}d{" "}
                                    {Math.floor((remaining % 86400) / 3600)}h{" "}
                                    {Math.floor((remaining % 3600) / 60)}m
                                    <span className="text-[#666] ml-1">
                                      ({unlockDate.toLocaleDateString()})
                                    </span>
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  )}
                </div>
              )}
              {(parseFloat(staking.userStats?.totalAmount || "0") > 0 || parseFloat(blubStakedBalance) > 0) && poolAndClaimBalance === 0 && !staking.lockEntries?.length && (
                <div className="text-[10px] text-[#FFA500] mt-1">
                  {staking.nextUnlockTime ? (() => {
                    const now = Math.floor(Date.now() / 1000);
                    const remaining = staking.nextUnlockTime - now;
                    if (remaining <= 0) return "Cooldown complete! Refresh to unstake.";
                    const days = Math.floor(remaining / 86400);
                    const hours = Math.floor((remaining % 86400) / 3600);
                    const mins = Math.floor((remaining % 3600) / 60);
                    return `${parseFloat(blubStakedBalance).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} BLUB unstakeable in ${days}d ${hours}h ${mins}m (${new Date(staking.nextUnlockTime * 1000).toLocaleDateString()})`;
                  })() : "10-day cooldown active."}
                </div>
              )}

              <Button
                className="rounded-[12px] py-5 px-4 text-white mt-10 w-full bg-[linear-gradient(180deg,_#00CC99_0%,_#005F99_100%)] text-base font-semibold"
                onClick={handleUnstakeAqua}
              >
                {!user?.unStakingAqua ? (
                  <span>Unstake</span>
                ) : (
                  <div className="flex justify-center items-center gap-[10px]">
                    <span className="text-white">Processing...</span>
                    <TailSpin
                      height="18"
                      width="18"
                      color="#ffffff"
                      ariaLabel="tail-spin-loading"
                      radius="1"
                      wrapperStyle={{}}
                      wrapperClass=""
                      visible={true}
                    />
                  </div>
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>


      <DialogC
        msg={dialogMsg}
        dialogTitle={dialogTitle}
        openDialog={openDialog}
        closeModal={closeModal}
      />
    </div>
  );
}

export default Yield;
