import AquaLogo from "../../assets/images/aqua_logo.png";
import { Button, Input } from "@headlessui/react";
import clsx from "clsx";
import { useAppDispatch } from "../../lib/hooks";
import { useSelector } from "react-redux";
import { RootState } from "../../lib/store";
import { useEffect, useMemo, useState } from "react";
import { TailSpin } from "react-loader-spinner";
import {
  FREIGHTER_ID,
  FreighterModule,
  LOBSTR_ID,
  StellarWalletsKit,
  WalletNetwork,
} from "@creit.tech/stellar-wallets-kit";
import { StellarService } from "../../services/stellar.service";
import {
  getAccountInfo,
  lockingAqua,
  mint,
  resetStateValues,
  storeAccountBalance,
} from "../../lib/slices/userSlice";
// Import new Soroban functionality
import {
  clearError,
  clearTransaction,
  fetchComprehensiveStakingData,
} from "../../lib/slices/stakingSlice";
import { useStakingApy } from "../../hooks/useStakingApy";
import { sorobanService } from "../../services/soroban.service";
import { apiService } from "../../services/api.service";
import { SOROBAN_CONFIG, isFeatureEnabled } from "../../config/soroban.config";
import {
  Asset,
  BASE_FEE,
  Networks,
  Operation,
  TransactionBuilder,
  Keypair,
} from "@stellar/stellar-sdk";
import {
  aquaAssetCode,
  aquaAssetIssuer,
  blubAssetCode,
  blubIssuer,
  blubSignerPublicKey,
} from "../../utils/constants";
import { toast } from "react-toastify";
import { Balance } from "../../utils/interfaces";
import { MIN_DEPOSIT_AMOUNT } from "../../config";
import { InformationCircleIcon } from "@heroicons/react/16/solid";
import { walletTypes } from "../../enums";
import DialogC from "./Dialog";
import { signTransaction } from "@lobstrco/signer-extension-api";
import {
  WALLET_CONNECT_ID,
  WalletConnectAllowedMethods,
  WalletConnectModule,
} from "@creit.tech/stellar-wallets-kit/modules/walletconnect.module";
import { kit } from "../Navbar";
import { enhancedBalanceRefresh } from "../../utils/helpers";
import { useTokenPrice, formatUsd } from "../../hooks/useTokenPrice";

function STKAqua() {
  const dispatch = useAppDispatch();
  const user = useSelector((state: RootState) => state.user);
  const staking = useSelector((state: RootState) => state.staking);
  const { apy: stakingAPY, source: stakingAPYSource } = useStakingApy(staking.rewardState, 7);
  const blubPrice = useTokenPrice("BLUB");
  const aquaPrice = useTokenPrice("AQUA");

  // Daily BLUB rewards estimate: activeStakedBlub * apy / 100 / 365.25.
  // Shown alongside the APY % so users can see the concrete number (like AQUA dex).
  // Falls back to "--" when APY is unknown or the user has nothing staked.
  const userStakedBlub = parseFloat(staking.userStats?.activeAmount ?? "0");
  const dailyBlubEstimate = useMemo(() => {
    if (stakingAPY === "--" || userStakedBlub <= 0) return null;
    const rate = parseFloat(stakingAPY);
    if (!Number.isFinite(rate) || rate <= 0) return null;
    return (userStakedBlub * rate) / 100 / 365.25;
  }, [stakingAPY, userStakedBlub]);

  const [aquaDepositAmount, setAquaDepositAmount] = useState<number | null>(0);
  const [dialogMsg, setDialogMsg] = useState<string>("");
  const [dialogTitle, setDialogTitle] = useState<string>("");
  const [openDialog, setOptDialog] = useState<boolean>(false);
  const [useSoroban, setUseSoroban] = useState<boolean>(
    isFeatureEnabled("useSoroban")
  );

  // BLUB token balance state
  const [blubBalance, setBlubBalance] = useState<string>("0.00");
  const [blubBalanceLoading, setBlubBalanceLoading] = useState<boolean>(false);

  // Local loading state for Soroban staking
  const [isSorobanStaking, setIsSorobanStaking] = useState<boolean>(false);

  // Lock entries expandable state
  const [locksExpanded, setLocksExpanded] = useState<boolean>(false);

  // Contract balance state
  const [contractBalance, setContractBalance] = useState<string>("0.00");
  const [balanceLoading, setBalanceLoading] = useState<boolean>(false);

  // Reward claim state
  const [pendingRewards, setPendingRewards] = useState<string>("0.00");
  const [rewardInfo, setRewardInfo] = useState<any>(null);
  const [claimingRewards, setClaimingRewards] = useState<boolean>(false);

  //get user aqua record
  const aquaRecord = user?.userRecords?.balances?.find(
    (balance) =>
      balance.asset_code === "AQUA" && balance.asset_issuer === aquaAssetIssuer
  );

  const userAquaBalance = aquaRecord?.balance;


  const updateWalletRecords = async () => {
    if (!user.userWalletAddress) return;
    const address = user.userWalletAddress;
    const stellarService = new StellarService();
    const wrappedAccount = await stellarService.loadAccount(address);

    dispatch(getAccountInfo(address));
    dispatch(storeAccountBalance(wrappedAccount.balances));
  };

  // Soroban staking functionality
  const handleSorobanStake = async () => {
    if (!user.userWalletAddress || !aquaDepositAmount) {
      toast.error("Please connect wallet and enter amount");
      return;
    }

    if (aquaDepositAmount < MIN_DEPOSIT_AMOUNT) {
      toast.error(`Minimum deposit amount is ${MIN_DEPOSIT_AMOUNT} AQUA`);
      return;
    }

    setIsSorobanStaking(true);

    try {
      // Use the soroban service
      const { sorobanService } = await import("../../services/soroban.service");
      const { SOROBAN_CONFIG } = await import("../../config/soroban.config");
      const soroban = sorobanService;

      // Build Soroban contract invocation transaction
      // stake() function: user, amount, duration_periods (minimal value for time-based rewards)
      const amountInStroops = Math.floor(
        aquaDepositAmount * 10000000
      ).toString(); // Convert to 7 decimal places
      const aquaTokenContract = SOROBAN_CONFIG.assets.aqua.sorobanContract;
      const durationPeriods = 1; // Minimal value - actual rewards calculated by elapsed time

      // Pass raw values - the sorobanService will convert them properly to ScVal
      const { transaction } = await soroban.buildContractTransaction(
        "staking",
        "lock", // Function that transfers AQUA tokens and records lock
        [
          user.userWalletAddress, // String address - will be converted to Address ScVal
          amountInStroops, // String amount - will be converted to i128 ScVal
          durationPeriods, // Number duration - will be converted to u64 ScVal
        ],
        user.userWalletAddress
      );

      // Sign transaction with user's wallet
      let signedTxXdr: string = "";
      if (user?.walletName === (LOBSTR_ID as any) || user?.walletName === (walletTypes.LOBSTR as any)) {
        // LOBSTR - use direct extension API
        signedTxXdr = await signTransaction(transaction.toXDR());
      } else if (user?.walletName === walletTypes.WALLETCONNECT || user?.walletName === (WALLET_CONNECT_ID as any) || user?.walletName === ("wallet_connect" as any)) {
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
        throw new Error(result.error || "Transaction failed");
      }

      // Reset form
      setAquaDepositAmount(0);

      // Refresh all balances immediately after successful transaction
      try {
        // First, update wallet records to get fresh Horizon data
        await updateWalletRecordsWithDelay(2000);

        // Then fetch all other data (which may depend on updated wallet balances)
        await Promise.all([
          dispatch(fetchComprehensiveStakingData(user.userWalletAddress)),
          fetchBlubBalance(),
          fetchContractBalance(),
        ]);
      } catch (refreshError) {
        console.error("[STKAqua] Refresh failed:", refreshError);
      }

      // Show success message after refresh
      toast.success(
        `Successfully staked ${aquaDepositAmount} AQUA via Soroban smart contract!`
      );
      setDialogTitle("Staking Successful!");
      setDialogMsg(
        `Transaction Hash: ${result.transactionHash}\n\nYour AQUA has been staked. Rewards increase the longer you keep it staked. You can unstake after a 10-day cooldown.`
      );
      setOptDialog(true);
      setIsSorobanStaking(false);
    } catch (error: any) {
      console.error("❌ [STKAqua] Soroban staking failed:", error);
      toast.error(`Staking failed: ${error.message}`);
      setDialogTitle("Staking Failed");
      setDialogMsg(
        `Error: ${error.message}\n\nPlease try again or contact support.`
      );
      setOptDialog(true);
      setIsSorobanStaking(false);
    }
  };

  // Load user staking data on component mount
  useEffect(() => {
    if (user.userWalletAddress && useSoroban) {
      // Initial data fetch
      const fetchAllData = async () => {
        if (!user.userWalletAddress) return;
        await dispatch(fetchComprehensiveStakingData(user.userWalletAddress));
        await fetchContractBalance();
        await fetchBlubBalance();
        await fetchPendingRewards();
      };

      fetchAllData();

      // Set up auto-refresh every 30 seconds for real-time updates
      const refreshInterval = setInterval(() => {
        fetchAllData();
      }, 30000);

      // Cleanup interval on unmount
      return () => clearInterval(refreshInterval);
    }
  }, [user.userWalletAddress, useSoroban, dispatch]);

  // Function to fetch BLUB balance from contract
  const fetchBlubBalance = async () => {
    if (!user.userWalletAddress) return;

    setBlubBalanceLoading(true);
    try {
      // Fetch fresh account data directly from Horizon API
      const stellarService = new StellarService();
      const wrappedAccount = await stellarService.loadAccount(
        user.userWalletAddress
      );

      // Get BLUB balance from fresh Horizon data (source of truth)
      const blubRecord = wrappedAccount.balances?.find(
        (balance: any) =>
          balance.asset_code === "BLUB" && balance.asset_issuer === blubIssuer
      );

      if (blubRecord?.balance) {
        const horizonBalance = parseFloat(blubRecord.balance);
        setBlubBalance(horizonBalance.toFixed(2));
      } else {
        // Fallback to Soroban if Horizon is not available
        const { sorobanService } = await import("../../services/soroban.service");
        const { SOROBAN_CONFIG } = await import("../../config/soroban.config");
        const blubTokenContract = SOROBAN_CONFIG.assets.blub.sorobanContract;

        const server = sorobanService.getServer();
        const { Contract, Address, TransactionBuilder, Networks } = await import(
          "@stellar/stellar-sdk"
        );

        const blubContract = new Contract(blubTokenContract);
        const account = await server.getAccount(user.userWalletAddress);

        const tx = new TransactionBuilder(account, {
          fee: "100",
          networkPassphrase: Networks.PUBLIC,
        })
          .addOperation(
            blubContract.call(
              "balance",
              Address.fromString(user.userWalletAddress).toScVal()
            )
          )
          .setTimeout(30)
          .build();

        const simulation: any = await server.simulateTransaction(tx);

        if (simulation && "result" in simulation && simulation.result) {
          const { scValToNative } = await import("@stellar/stellar-sdk");
          const balance = scValToNative(simulation.result.retval);
          const balanceValue =
            typeof balance === "bigint" ? balance : BigInt(balance || 0);
          const blubAmount = Number(balanceValue) / 10000000;
          setBlubBalance(blubAmount.toFixed(2));
        } else {
          setBlubBalance("0.00");
        }
      }
    } catch (error: any) {
      console.error("❌ [STKAqua] Error fetching BLUB balance:", error);
      setBlubBalance("0.00");
    } finally {
      setBlubBalanceLoading(false);
    }
  };

  // Function to fetch AQUA balance from contract directly
  const fetchContractBalance = async () => {
    if (!user.userWalletAddress) return;

    setBalanceLoading(true);
    try {
      const { sorobanService } = await import("../../services/soroban.service");
      const { SOROBAN_CONFIG } = await import("../../config/soroban.config");

      const stakingContractId = SOROBAN_CONFIG.contracts.staking;
      const aquaTokenContract = SOROBAN_CONFIG.assets.aqua.sorobanContract;

      // Read the AQUA token balance of the staking contract
      const server = sorobanService.getServer();
      const { Contract, Address } = await import("@stellar/stellar-sdk");

      // Create AQUA token contract instance
      const aquaContract = new Contract(aquaTokenContract);

      // Build a simulation transaction to read balance
      const account = await server.getAccount(user.userWalletAddress);
      const { TransactionBuilder, Networks } = await import(
        "@stellar/stellar-sdk"
      );

      // Call balance method on AQUA token contract for staking contract
      const operation = aquaContract.call(
        "balance",
        Address.fromString(stakingContractId).toScVal()
      );

      const tx = new TransactionBuilder(account, {
        fee: "100000",
        networkPassphrase: Networks.PUBLIC,
      })
        .addOperation(operation)
        .setTimeout(30)
        .build();

      const simResult = await server.simulateTransaction(tx);

      if ("result" in simResult && simResult.result?.retval) {
        const { scValToNative } = await import("@stellar/stellar-sdk");
        const balance = scValToNative(simResult.result.retval);
        const aquaBalance = (BigInt(balance) / BigInt(10000000)).toString();
        setContractBalance(aquaBalance);
      }
    } catch (error) {
      console.error("❌ [STKAqua] Failed to fetch contract balance:", error);
    } finally {
      setBalanceLoading(false);
    }
  };


  // Fetch pending rewards from contract
  const fetchPendingRewards = async () => {
    if (!user.userWalletAddress) return;

    try {
      const { sorobanService } = await import("../../services/soroban.service");

      // Query user reward info (includes pending rewards and cooldown status)
      const rewardInfoData = await sorobanService.queryUserRewardInfo(
        user.userWalletAddress
      );

      if (rewardInfoData) {
        setPendingRewards(rewardInfoData.pending_rewards || "0");
        setRewardInfo(rewardInfoData);
      }
    } catch (error: any) {
      console.error("❌ [STKAqua] Error fetching pending rewards:", error);
      setPendingRewards("0");
    }
  };

  // Handle claim rewards
  const handleClaimRewards = async () => {
    if (!user.userWalletAddress) {
      return toast.error("Please connect your wallet");
    }

    const pendingAmount = parseFloat(pendingRewards);
    if (pendingAmount <= 0) {
      return toast.warn("No rewards to claim");
    }

    // Check cooldown
    if (rewardInfo && !rewardInfo.can_claim && rewardInfo.last_claim_time > 0) {
      const cooldownEnd = new Date(rewardInfo.claim_available_at * 1000);
      return toast.warn(`Claim available at ${cooldownEnd.toLocaleString()}`);
    }

    setClaimingRewards(true);

    try {
      // Ensure BLUB trustline exists before claiming
      const stellarService = new StellarService();
      const senderAccount = await stellarService.loadAccount(user.userWalletAddress);
      const existingTrustlines = senderAccount.balances.map(
        (balance: Balance) => balance.asset_code
      );

      if (!existingTrustlines.includes(blubAssetCode)) {
        try {
          await handleAddTrustline();
          toast.success("BLUB trustline added successfully.");
          await new Promise((resolve) => setTimeout(resolve, 2000));
        } catch (error) {
          throw new Error("Failed to add BLUB trustline");
        }
      }

      // Import Soroban service
      const { sorobanService } = await import("../../services/soroban.service");
      const soroban = sorobanService;

      // Build Soroban contract invocation transaction
      // claim_rewards(user: Address) -> i128
      const { transaction } = await soroban.buildContractTransaction(
        "staking",
        "claim_rewards",
        [user.userWalletAddress],
        user.userWalletAddress
      );

      // Sign transaction with user's wallet
      let signedTxXdr: string = "";
      if (user?.walletName === (LOBSTR_ID as any) || user?.walletName === (walletTypes.LOBSTR as any)) {
        signedTxXdr = await signTransaction(transaction.toXDR());
      } else if (
        user?.walletName === walletTypes.WALLETCONNECT ||
        user?.walletName === (WALLET_CONNECT_ID as any) ||
        user?.walletName === ("wallet_connect" as any)
      ) {
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

      // Submit the signed transaction
      const result = await soroban.submitSignedTransaction(signedTxXdr);

      if (!result.success) {
        throw new Error(result.error || "Claim rewards transaction failed");
      }

      // Refresh balances
      await updateWalletRecordsWithDelay(2000);
      await Promise.all([
        fetchBlubBalance(),
        fetchPendingRewards(),
      ]);

      toast.success(`Successfully claimed ${pendingRewards} BLUB rewards!`);
      setDialogTitle("Rewards Claimed!");
      setDialogMsg(
        `Transaction Hash: ${result.transactionHash}\n\n${pendingRewards} BLUB has been transferred to your wallet.`
      );
      setOptDialog(true);
    } catch (err: any) {
      console.error("[STKAqua] Claim rewards failed:", err);
      toast.error(`Claim failed: ${err.message || "Please try again"}`);
      setDialogTitle("Claim Failed");
      setDialogMsg(
        `Error: ${err.message}\n\nPlease try again or contact support.`
      );
      setOptDialog(true);
    } finally {
      setClaimingRewards(false);
    }
  };

  // Clear errors when component unmounts
  useEffect(() => {
    return () => {
      dispatch(clearError());
      dispatch(clearTransaction());
    };
  }, [dispatch]);

  // Add delay-based balance refresh for better sync with backend
  const updateWalletRecordsWithDelay = async (delayMs: number = 3000) => {
    if (!user.userWalletAddress) return;
    // Wait for backend to complete BLUB minting
    await new Promise((resolve) => setTimeout(resolve, delayMs));

    try {
      const address = user.userWalletAddress;
      const stellarService = new StellarService();
      const wrappedAccount = await stellarService.loadAccount(address);

      dispatch(getAccountInfo(address));
      dispatch(storeAccountBalance(wrappedAccount.balances));

      // Double-check after another short delay to ensure BLUB tokens are visible
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

const handleAddTrustline = async () => {
    const stellarService = new StellarService();

    // Load sender's Stellar account
    const senderAccount = await stellarService.loadAccount(
      user?.userWalletAddress as string
    );

    // Build transaction
    const transactionBuilder = new TransactionBuilder(senderAccount, {
      fee: BASE_FEE,
      networkPassphrase: Networks.PUBLIC,
    });

    // Add trustline operation
    transactionBuilder.addOperation(
      Operation.changeTrust({
        asset: new Asset(blubAssetCode, blubIssuer),
        limit: "1000000000",
      })
    );

    // Set timeout and build transaction
    const transaction = transactionBuilder.setTimeout(3000).build();

    // Sign transaction based on wallet type
    let signedTxXdr: string = "";

    if (user?.walletName === (LOBSTR_ID as any) || user?.walletName === (walletTypes.LOBSTR as any)) {
      // LOBSTR - use direct extension API
      signedTxXdr = await signTransaction(transaction.toXDR());
    } else if (user?.walletName === walletTypes.WALLETCONNECT || user?.walletName === (WALLET_CONNECT_ID as any) || user?.walletName === ("wallet_connect" as any)) {
      // Use shared WalletConnect kit from Navbar
      await kit.setWallet(WALLET_CONNECT_ID);
      const { signedTxXdr: signed } = await kit.signTransaction(
        transaction.toXDR(),
        {
          address: user?.userWalletAddress || "",
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
          address: user?.userWalletAddress || "",
          networkPassphrase: WalletNetwork.PUBLIC,
        }
      );
      signedTxXdr = signed;
    }

    const HORIZON_SERVER = "https://horizon.stellar.org";
    const transactionToSubmit = TransactionBuilder.fromXDR(
      signedTxXdr,
      HORIZON_SERVER
    );

    await stellarService?.server?.submitTransaction(transactionToSubmit);
  };

  const handleLockAqua = async () => {
    if (!user?.userWalletAddress) {
      dispatch(lockingAqua(false));
      return toast.warn("Please connect wallet.");
    }

    if (!userAquaBalance) {
      dispatch(lockingAqua(false));
      return toast.warn("Balance is low");
    }

    if (!user) {
      dispatch(lockingAqua(false));
      return toast.warn("Global state not initialized.");
    }

    if (!aquaDepositAmount) {
      dispatch(lockingAqua(false));
      return toast.warn("Please input amount to stake.");
    }

    if (aquaDepositAmount < MIN_DEPOSIT_AMOUNT) {
      dispatch(lockingAqua(false));
      return toast.warn(
        `Deposit amount should be higher than ${MIN_DEPOSIT_AMOUNT}.`
      );
    }

    const stellarService = new StellarService();

    // toast.warn("Gloading account");
    const senderAccount = await stellarService.loadAccount(
      user?.userWalletAddress
    );
    const existingTrustlines = senderAccount.balances.map(
      (balance: Balance) => balance.asset_code
    );

    if (!existingTrustlines.includes(blubAssetCode)) {
      try {
        await handleAddTrustline();
        toast.success("Trustline added successfully.");
      } catch (error) {
        dispatch(lockingAqua(false));
        return toast.error("Failed to add trustline.");
      }
    }

    try {
      const customAsset = new Asset(aquaAssetCode, aquaAssetIssuer);
      const stakeAmount = aquaDepositAmount.toFixed(7);

      const paymentOperation = Operation.payment({
        destination: blubSignerPublicKey,
        asset: customAsset,
        amount: stakeAmount,
      });

      const transactionBuilder = new TransactionBuilder(senderAccount, {
        fee: BASE_FEE,
        networkPassphrase: Networks.PUBLIC,
      });

      transactionBuilder.addOperation(paymentOperation).setTimeout(180);

      const transaction = transactionBuilder.build();
      const transactionXDR = transaction.toXDR();

      let signedTxXdr: string = "";

      if (user?.walletName === (LOBSTR_ID as any) || user?.walletName === (walletTypes.LOBSTR as any)) {
        // LOBSTR - use direct extension API
        signedTxXdr = await signTransaction(transactionXDR);
      } else if (user?.walletName === walletTypes.WALLETCONNECT || user?.walletName === (WALLET_CONNECT_ID as any) || user?.walletName === ("wallet_connect" as any)) {
        // Use shared WalletConnect kit from Navbar
        await kit.setWallet(WALLET_CONNECT_ID);
        const { signedTxXdr: signed } = await kit.signTransaction(
          transactionXDR,
          {
            address: user?.userWalletAddress || "",
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
          transactionXDR,
          {
            address: user?.userWalletAddress || "",
            networkPassphrase: WalletNetwork.PUBLIC,
          }
        );
        signedTxXdr = signed;
      }

      dispatch(
        mint({
          assetCode: aquaAssetCode,
          assetIssuer: aquaAssetIssuer,
          amount: stakeAmount,
          signedTxXdr,
          senderPublicKey: user?.userWalletAddress,
        })
      );

      dispatch(lockingAqua(true));
      toast.success("Transaction sent!");
    } catch (err) {
      console.error("Transaction failed:", err);
      dispatch(lockingAqua(false));
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

  useEffect(() => {
    if (user?.lockedAqua && user?.userWalletAddress) {
      // Use the enhanced balance refresh utility for better reliability
      enhancedBalanceRefresh(user.userWalletAddress, dispatch, 1000, 4000);
      toast.success("Aqua locked successfully!");
      setAquaDepositAmount(0);
      dispatch(lockingAqua(false));
      dispatch(resetStateValues());
    }
  }, [user?.lockedAqua]);

  return (
    <div id="reward_section">
      <div className="mx-auto">
        <div className="text-white text-xl md:text-4xl-custom1 font-medium text-center">
          Daily Growth Staking on Aquarius
        </div>
        <div className="text-[#B1B3B8] text-base font-medium text-center max-w-[720px] mx-auto mt-2">
          Convert AQUA to BLUB 1 : 1 and start earning now
        </div>
        <div className="text-[#B1B3B8] text-sm font-normal text-center max-w-[720px] mx-auto mt-1 italic">
          No lockups, no vote management, no hassle
        </div>
      </div>
      <div className="mt-10 md:grid gap-5 grid-cols-1 md:grid-cols-2 mb-10">
        <div>
          <div className="bg-[#0E111BCC] p-10 rounded-[16px]">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <img
                  src={AquaLogo}
                  alt="Aqua"
                  className="w-8 h-8 rounded-full"
                />
                <span className="text-lg">Aqua</span>
              </div>
              <i className="fa fa-arrow-right" aria-hidden="true"></i>
              <div className="flex items-center space-x-2">
                <img
                  src={"/Blub_logo2.svg"}
                  alt="Aqua"
                  className="w-8 h-8 rounded-full"
                />
                <span className="text-lg">BLUB</span>
              </div>
            </div>
            <div className="flex items-center space-x-2 mt-5">
              <div className="font-medium text-white text-lg md:text-2xl tracking-wide">
                Deposit AQUA → Get BLUB
              </div>
              <div className="relative group">
                <InformationCircleIcon
                  className="h-[15px] w-[15px] text-white cursor-pointer"
                  onClick={() =>
                    onDialogOpen(
                      "You're joining a crowdfunded staking pool. Drop in AQUA, receive BLUB at a 1-to-1 rate. BLUB is your liquid receipt token, proving how much you contributed.\n\nWhile your AQUA is in the pool, it earns rewards for you automatically. Every backer earns a proportional share of what the pool generates.\n\n1 AQUA = 1 BLUB. Same value, but BLUB is liquid and earning. Withdraw 10 days after you request it. No fees, no penalties, no slashing.",
                      "Deposit AQUA → Get BLUB"
                    )
                  }
                />
              </div>
            </div>

            <div className="flex items-center bg-[#0E111B] py-2 space-x-2 mt-2 rounded-[8px]">
              <Input
                placeholder="0 AQUA"
                className={clsx(
                  "block w-full rounded-lg border-none bg-[#0E111B] px-3 text-sm/6 text-white",
                  "focus:outline-none data-[focus]:outline-2 data-[focus]:-outline-offset-2 data-[focus]:outline-[#3C404D]",
                  "w-full p-3 bg-none"
                )}
                onChange={(e) =>
                  setAquaDepositAmount(
                    e.target.value ? Number(e.target.value) : null
                  )
                }
                value={`${aquaDepositAmount ?? ""}`}
              />
            </div>
            <div className="flex items-center space-x-2 mt-2">
              {[25, 50, 75, 100].map((pct) => (
                <button
                  key={pct}
                  className="flex-1 bg-[#3C404D] hover:bg-[#4C5060] text-white text-xs py-1.5 rounded-[4px] transition-colors"
                  onClick={() => {
                    const bal = typeof userAquaBalance === "string"
                      ? parseFloat(userAquaBalance)
                      : (userAquaBalance ?? 0);
                    setAquaDepositAmount(parseFloat(((bal * pct) / 100).toFixed(7)));
                  }}
                >
                  {pct === 100 ? "Max" : `${pct}%`}
                </button>
              ))}
            </div>

            {/* Time-based rewards info */}
            {useSoroban && (
              <div className="mt-4 p-3 bg-[#1A1E2E] rounded-[8px]">
                <div className="flex items-center space-x-2 mb-1">
                  <InformationCircleIcon className="h-[15px] w-[15px] text-[#00CC99]" />
                  <div className="text-sm font-medium text-white">
                    Time-weighted rewards
                  </div>
                </div>
                <div className="text-xs text-[#B1B3B8]">
                  The longer you stay a backer, the larger your share of each reward distribution. Loyalty earns you a bigger slice over time. Unstake anytime after the 10-day cooldown. No penalties for leaving.
                </div>
              </div>
            )}

            {/* Soroban/Legacy Toggle — temporarily hidden */}
            {false && <div className="mt-4 flex items-center justify-between p-3 bg-[#1A1E2E] rounded-[8px]">
              <div className="flex items-center space-x-2">
                <div className="text-sm font-medium text-white">
                  {useSoroban ? "Soroban Staking" : "Legacy Staking"}
                </div>
                <div className="relative group">
                  <InformationCircleIcon
                    className="h-[15px] w-[15px] text-white cursor-pointer"
                    onClick={() =>
                      onDialogOpen(
                        useSoroban
                          ? "Soroban staking provides time-based rewards - the longer you stake, the more you earn. You can unstake after a 10-day cooldown."
                          : "Legacy staking uses the original BLUB conversion system without time-based rewards or governance features.",
                        useSoroban ? "Soroban Staking" : "Legacy Staking"
                      )
                    }
                  />
                </div>
              </div>
              {/* <button
                className={clsx(
                  "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                  useSoroban ? "bg-[#00CC99]" : "bg-[#3C404D]"
                )}
                onClick={() => setUseSoroban(!useSoroban)}
              >
                <span
                  className={clsx(
                    "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                    useSoroban ? "translate-x-6" : "translate-x-1"
                  )}
                />
              </button> */}
            </div>}

            <div className="flex items-center text-normal mt-6 space-x-1">
              <div className="font-normal text-[#B1B3B8]">Your balance:</div>
              <div className="font-medium">
                {isNaN(parseFloat(`${userAquaBalance}`))
                  ? "0.00"
                  : parseFloat(`${userAquaBalance}`).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
                AQUA{" "}
                <span className="text-[#6B7280] text-xs font-normal">{formatUsd(isNaN(parseFloat(`${userAquaBalance}`)) ? "0" : `${userAquaBalance}`, aquaPrice)}</span>
              </div>
            </div>

            <Button
              className="rounded-[12px] py-5 px-4 text-white mt-10 w-full bg-[linear-gradient(180deg,_#00CC99_0%,_#005F99_100%)] text-base font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={useSoroban ? handleSorobanStake : handleLockAqua}
              disabled={useSoroban ? isSorobanStaking : user?.lockingAqua}
            >
              {useSoroban ? (
                isSorobanStaking ? (
                  <div className="flex justify-center items-center gap-[10px]">
                    <span className="text-white">Staking...</span>
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
                ) : (
                  "Deposit AQUA"
                )
              ) : user?.lockingAqua ? (
                <div className="flex justify-center items-center gap-[10px]">
                  <span className="text-white">Converting...</span>
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
              ) : (
                "Convert & Stake"
              )}
            </Button>


            {/* Display current staking stats for Soroban — temporarily hidden */}
            {false && useSoroban && user.userWalletAddress && (
              <div className="mt-4 p-3 bg-[#1A1E2E] rounded-[8px]">
                <div className="text-sm font-medium text-white mb-2 flex items-center justify-between">
                  <div>
                    Your Staking Stats
                    {staking.isLoading && (
                      <span className="ml-2 text-xs text-[#00CC99]">
                        (Loading on-chain data...)
                      </span>
                    )}
                  </div>
                  <button
                    onClick={async () => {
                      if (!user.userWalletAddress) return;
                      await dispatch(
                        fetchComprehensiveStakingData(user.userWalletAddress)
                      );
                      await fetchBlubBalance();
                      await fetchContractBalance();
                      await fetchPendingRewards();
                    }}
                    className="text-[#00CC99] hover:text-[#00AA77] text-lg"
                    title="Refresh on-chain data"
                  >
                    ⟳
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-4 text-xs">
                  <div>
                    <div className="text-[#B1B3B8] flex items-center">
                      <span>Staked BLUB</span>
                      <span className="ml-1 text-[10px] text-[#00CC99]">
                        🔒 Staked
                      </span>
                    </div>
                    <div className="text-white font-medium text-base">
                      {staking.isLoading ? (
                        <span className="text-[#B1B3B8]">Loading...</span>
                      ) : (
                        <span className="text-[#00CC99]">
                          {staking.userStats?.activeAmount
                            ? parseFloat(
                                staking.userStats?.activeAmount ?? "0"
                              ).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                            : "0.00"}{" "}
                          BLUB
                          <span className="text-[#6B7280] text-xs ml-1">{formatUsd(staking.userStats?.activeAmount ?? "0", blubPrice)}</span>
                        </span>
                      )}
                    </div>
                    {staking.lockEntries?.length > 0 && (
                      <button
                        onClick={() => setLocksExpanded(!locksExpanded)}
                        className="text-[10px] text-[#00CC99] mt-1 hover:underline cursor-pointer"
                      >
                        {locksExpanded ? "▾ Hide" : "▸ Show"} {staking.lockEntries?.filter(e => parseFloat(e.blubAmount) > 0).length ?? 0} lock{staking.lockEntries?.filter(e => parseFloat(e.blubAmount) > 0).length !== 1 ? "s" : ""}
                      </button>
                    )}
                    {!staking.lockEntries?.length && (
                      <div className="text-[10px] text-[#B1B3B8] mt-1">
                        10-day cooldown before unstake
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="text-[#B1B3B8] flex items-center">
                      <span>BLUB Balance</span>
                      <span className="ml-1 text-[10px] text-[#4169E1]">
                        💎 Wallet
                      </span>
                    </div>
                    <div className="text-white font-medium text-base">
                      {blubBalanceLoading ? (
                        <span className="text-[#B1B3B8]">Loading...</span>
                      ) : (
                        <span className="text-[#4169E1]">
                          {parseFloat(blubBalance).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} BLUB
                          <span className="text-[#6B7280] text-xs ml-1">{formatUsd(blubBalance, blubPrice)}</span>
                        </span>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="text-[#B1B3B8] flex items-center">
                      <span>Unstakeable BLUB</span>
                      <span className="ml-1 text-[10px] text-[#FFA500]">
                        🔓 Ready
                      </span>
                    </div>
                    <div className="text-white font-medium">
                      {staking.isLoading
                        ? "..."
                        : parseFloat(
                            staking.userStats?.unstakingAvailable || "0"
                          ).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
                      BLUB
                      {!staking.isLoading && <span className="text-[#6B7280] text-xs ml-1">{formatUsd(staking.userStats?.unstakingAvailable || "0", blubPrice)}</span>}
                    </div>
                  </div>
                  <div>
                    <div className="text-[#B1B3B8] flex items-center">
                      <span>Pending Rewards</span>
                      <span className="ml-1 text-[10px] text-[#FFD700]">
                        🎁 Earned
                      </span>
                    </div>
                    <div className="text-white font-medium">
                      {staking.isLoading ? "..." : parseFloat(pendingRewards).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} BLUB
                      {!staking.isLoading && <span className="text-[#6B7280] text-xs ml-1">{formatUsd(pendingRewards, blubPrice)}</span>}
                    </div>
                  </div>
                </div>

                {/* Expandable Lock Entries */}
                {locksExpanded && staking.lockEntries?.length > 0 && (
                  <div className="mt-3 border-t border-[#2A2E3E] pt-3">
                    <div className="text-[11px] text-[#B1B3B8] mb-2 font-medium">Lock Entries</div>
                    <div className="space-y-2 max-h-[200px] overflow-y-auto">
                      {staking.lockEntries
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
                                {entry.isBlubStake && (
                                  <span className="text-[9px] text-[#4169E1] bg-[#4169E1]/10 px-1 rounded">
                                    restake
                                  </span>
                                )}
                              </div>
                              <div className="text-right">
                                {isReady ? (
                                  <span className="text-[#00CC99]">Ready to unstake</span>
                                ) : (
                                  <div>
                                    <span className="text-[#B1B3B8]">
                                      {Math.floor(remaining / 86400)}d{" "}
                                      {Math.floor((remaining % 86400) / 3600)}h{" "}
                                      {Math.floor((remaining % 3600) / 60)}m
                                    </span>
                                    <span className="text-[#666] ml-1">
                                      ({unlockDate.toLocaleDateString()})
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        <div>
          <div className="bg-[#0E111BCC] p-10 rounded-[16px]">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <img
                  src={"/Blub_logo2.svg"}
                  alt="BLUB"
                  className="w-8 h-8 rounded-full"
                />
                <span className="text-lg">BLUB</span>
              </div>
            </div>

            <div className="text-lg md:text-2xl font-medium text-white mt-5 flex items-center space-x-2">
              <div>Your Earned Rewards</div>
              <div className="relative group">
                <InformationCircleIcon
                  className="h-[15px] w-[15px] text-white cursor-pointer"
                  onClick={() =>
                    onDialogOpen(
                      "The BLUB you've accrued as a backer of the staking pool. New rewards are added on a rolling schedule.\n\nClaim them anytime, or leave them in to compound by re-staking.",
                      "Your Earned Rewards"
                    )
                  }
                />
              </div>
            </div>

            {/* Current APY — rolling 7-day rate from the backend indexer, with
                a live "~X BLUB/day" estimate based on the user's active stake. */}
            <div className="flex items-center bg-[#0E111B] px-3 sm:px-5 py-4 mt-4 rounded-[8px] justify-between gap-2">
              <div className="text-sm font-normal text-white flex items-center space-x-1 shrink-0">
                <span>Current APY</span>
                <InformationCircleIcon
                  className="h-[14px] w-[14px] text-[#B1B3B8] cursor-pointer"
                  onClick={() =>
                    onDialogOpen(
                      "Your annual return rate, calculated from real BLUB rewards distributed over the last 7 days (not a marketing estimate or lifetime average).\n\nFloats with actual protocol activity. Higher when more rewards flow in, lower during quieter periods.\n\nYour share of those rewards is proportional to your staked BLUB. The bigger your stake, the bigger your slice.",
                      "Current APY"
                    )
                  }
                />
              </div>
              <div className="flex flex-col items-end min-w-0">
                <div className="text-base sm:text-xl font-semibold text-right truncate min-w-0">
                  {staking.isLoading ? (
                    "..."
                  ) : (
                    <span className="text-[#00CC99]">
                      {stakingAPY === "--" ? "--" : `${stakingAPY}%`}
                    </span>
                  )}
                </div>
                {dailyBlubEstimate !== null && (
                  <div className="text-[11px] text-[#6B7280] mt-0.5">
                    ~{dailyBlubEstimate.toLocaleString("en-US", { maximumFractionDigits: 2 })} BLUB/day
                    {blubPrice > 0 && (
                      <span className="ml-1">{formatUsd(dailyBlubEstimate, blubPrice)}</span>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center bg-[#0E111B] px-3 sm:px-5 py-4 mt-3 rounded-[8px] justify-between gap-2">
              <div className="text-sm font-normal text-white shrink-0">Pending Rewards</div>
              <div className="flex flex-col items-end min-w-0">
                <div className="flex items-center space-x-2">
                  <img src={"/Blub_logo2.svg"} alt="BLUB" className="w-4 h-4 rounded-full shrink-0" />
                  <span className="text-sm sm:text-base font-normal truncate">
                    {parseFloat(pendingRewards).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} BLUB
                  </span>
                </div>
                <span className="text-[11px] text-[#6B7280]">{formatUsd(pendingRewards, blubPrice)}</span>
              </div>
            </div>

            <div className="flex items-center bg-[#0E111B] px-3 sm:px-5 py-4 mt-3 rounded-[8px] justify-between gap-2">
              <div className="text-sm font-normal text-white shrink-0">Total Claimed</div>
              <div className="flex flex-col items-end min-w-0">
                <span className="text-sm sm:text-base font-normal truncate">
                  {rewardInfo ? parseFloat(rewardInfo.total_claimed || "0").toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00"} BLUB
                </span>
                <span className="text-[11px] text-[#6B7280]">{formatUsd(rewardInfo?.total_claimed || "0", blubPrice)}</span>
              </div>
            </div>

            {rewardInfo && rewardInfo.last_claim_time > 0 && !rewardInfo.can_claim && (
              <div className="flex items-center text-sm mt-4 space-x-1">
                <div className="font-normal text-[#B1B3B8]">
                  Next claim available:
                </div>
                <div className="font-medium text-yellow-400">
                  {new Date(rewardInfo.claim_available_at * 1000).toLocaleString()}
                </div>
              </div>
            )}

            <Button
              className="rounded-[12px] py-5 px-4 text-white mt-6 w-full bg-[linear-gradient(180deg,_#00CC99_0%,_#005F99_100%)] text-base font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleClaimRewards}
              disabled={claimingRewards || parseFloat(pendingRewards) <= 0 || (rewardInfo && !rewardInfo.can_claim && rewardInfo.last_claim_time > 0)}
            >
              {!claimingRewards ? (
                <span>Claim BLUB</span>
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

      <DialogC
        msg={dialogMsg}
        openDialog={openDialog}
        dialogTitle={dialogTitle}
        closeModal={closeModal}
      />
    </div>
  );
}

export default STKAqua;
