import React, { useEffect, useState, useMemo } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  InputAdornment,
  InputBase,
} from "@mui/material";
import { TailSpin } from "react-loader-spinner";
import {
  KeyboardArrowDown as KeyboardArrowDownIcon,
  KeyboardArrowUp as KeyboardArrowUpIcon,
} from "@mui/icons-material";
import { RootState } from "../../lib/store";
import { useSelector } from "react-redux";
import { useAppDispatch } from "../../lib/hooks";
import { toast } from "react-toastify";
import {
  FREIGHTER_ID,
  FreighterModule,
  LOBSTR_ID,
  LobstrModule,
  StellarWalletsKit,
  WalletNetwork,
} from "../../lib/walletKit";
import {
  getAccountInfo,
  lockingAqua,
  resetStateValues,
  restaking,
  storeAccountBalance,
  unStakingAqua,
} from "../../lib/slices/userSlice";
import {
  unlockAqua,
  restakeBlub as restakeBlubSoroban,
  optimisticUnstakeUpdate,
  optimisticRestakeUpdate,
  fetchComprehensiveStakingData,
} from "../../lib/slices/stakingSlice";
import {
  Asset,
  BASE_FEE,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import {
  blubIssuerPublicKey,
  lpSignerPublicKey,
  blubIssuer,
  blubAssetCode,
  aquaAssetIssuer,
} from "../../utils/constants";
import { StellarService } from "../../services/stellar.service";
import { Balance } from "../../utils/interfaces";
import { walletTypes } from "../../enums";
import { signTransaction } from "@lobstrco/signer-extension-api";
import { ensureTrustline } from "../../utils/trustline.helper";
import { kit as walletConnectKit } from "../Navbar";
import { WALLET_CONNECT_ID } from "../../lib/walletKit";

function Restake() {
  const [isBlubStakeExpanded, setIsBlubStakeExpanded] =
    useState<boolean>(false);
  const [blubStakeAmount, setBlubStakeAmount] = useState<number | null>(0);
  const dispatch = useAppDispatch();
  const [blubUnstakeAmount, setBlubUnstakeAmount] = useState<number | null>(0);

  const user = useSelector((state: RootState) => state.user);

  // Get BLUB token balance (checking both asset code and issuer for security)
  const blubRecord = user?.userRecords?.balances?.find(
    (balance) =>
      balance.asset_code === "BLUB" && balance.asset_issuer === blubIssuer
  );

  //get user aqua record
  const aquaRecord = user?.userRecords?.balances?.find(
    (balance) =>
      balance.asset_code === "AQUA" && balance.asset_issuer === aquaAssetIssuer
  );

  const userAquaBalance = aquaRecord?.balance;
  const blubBalance = blubRecord?.balance;

  // Calculate accountClaimableRecords with defensive programming
  const accountClaimableRecords = useMemo(() => {
    try {
      if (!user?.userRecords?.account?.claimableRecords) {
        console.warn(
          "🔄 [Restake] No claimable records found for accountClaimableRecords"
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
        "🔄 [Restake] Error calculating accountClaimableRecords:",
        error
      );
      return 0;
    }
  }, [user?.userRecords?.account?.claimableRecords]);

  const userPoolBalances = useMemo(() => {
    try {
      if (!user?.userRecords?.account?.pools) {
        console.warn("🔄 [Restake] No pools found for userPoolBalances");
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
      console.error("🔄 [Restake] Error calculating userPoolBalances:", error);
      return 0;
    }
  }, [user?.userRecords?.account?.pools]);

  // Add the two calculated values
  const poolAndClaimBalance = useMemo(() => {
    return Number(userPoolBalances) + Number(accountClaimableRecords);
  }, [userPoolBalances, accountClaimableRecords]);

  const handleSetMaxDepositForBlub = () => {
    setBlubUnstakeAmount(Number(accountClaimableRecords));
  };

  const handleUnstakeAqua = async () => {
    if (poolAndClaimBalance < 1 || Number(blubUnstakeAmount) < 1)
      return toast.warn("Nothing to unstake");

    if (Number(blubUnstakeAmount) > poolAndClaimBalance)
      return toast.warn("Unstake amount exceeds the pool balance");

    if (!user?.userWalletAddress) {
      return toast.error("Please connect your wallet");
    }

    try {
      console.log("[Restake] Starting unstaking:", {
        userAddress: user.userWalletAddress,
        amount: blubUnstakeAmount,
      });

      // Ensure BLUB trustline exists before unstaking
      console.log("[Restake] Checking BLUB trustline...");
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

      const stellarService = new StellarService();
      const senderAccount = await stellarService.loadAccount(
        user.userWalletAddress
      );

      // Create validation transaction (minimal self-payment)
      const validationOperation = Operation.payment({
        destination: user.userWalletAddress,
        asset: Asset.native(),
        amount: "0.0000001",
      });

      const transaction = new TransactionBuilder(senderAccount, {
        fee: BASE_FEE,
        networkPassphrase: Networks.PUBLIC,
      })
        .addOperation(validationOperation)
        .setTimeout(180)
        .build();

      // Sign transaction
      let signedTxXdr: string = "";
      if (user?.walletName === walletTypes.LOBSTR) {
        signedTxXdr = await signTransaction(transaction.toXDR());
      } else if (user?.walletName === walletTypes.WALLETCONNECT || user?.walletName === ("wallet_connect" as any)) {
        // Use shared WalletConnect kit from Navbar
        await walletConnectKit.setWallet(WALLET_CONNECT_ID);
        const { signedTxXdr: signed } = await walletConnectKit.signTransaction(
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

      console.log("[Restake] Transaction signed, submitting...");

      // Submit transaction
      if (!stellarService.server) {
        throw new Error("Horizon server is not initialized");
      }

      const txResponse = await stellarService.server.submitTransaction(
        TransactionBuilder.fromXDR(signedTxXdr, Networks.PUBLIC)
      );

      console.log("[Restake] Transaction successful:", txResponse.hash);

      console.log(
        "[Restake] Applying optimistic unstake update for immediate UI feedback..."
      );
      dispatch(
        optimisticUnstakeUpdate({ amount: (blubUnstakeAmount || 0).toFixed(7) })
      );

      toast.success(`Successfully unstaked ${blubUnstakeAmount} BLUB!`);
      setBlubUnstakeAmount(0);
      dispatch(unStakingAqua(false));

      dispatch(
        unlockAqua({
          userAddress: user.userWalletAddress,
          lockId: 0,
          amount: (blubUnstakeAmount || 0).toString(),
          txHash: txResponse.hash,
        })
      );

      // Refresh data in the background to confirm the update
      console.log("[Restake] Refreshing on-chain data in background...");
      Promise.all([
        dispatch(fetchComprehensiveStakingData(user.userWalletAddress)),
        updateWalletRecords(),
      ])
        .then(() => {
          console.log("[Restake] Background refresh completed!");
        })
        .catch((error) => {
          console.error("[Restake] Background refresh failed:", error);
        });
    } catch (err: any) {
      console.error("[Restake] Unstaking failed:", err);
      toast.error(`Unstaking failed: ${err.message || "Please try again"}`);
      dispatch(unStakingAqua(false));
    }
  };

  const handleSetRestakeMaxDeposit = () => {
    setBlubStakeAmount(Number(blubBalance));
  };

  const updateWalletRecords = async () => {
    const selectedModule =
      user?.walletName === LOBSTR_ID
        ? new LobstrModule()
        : new FreighterModule();

    const kit: StellarWalletsKit = new StellarWalletsKit({
      network: WalletNetwork.PUBLIC,
      selectedWalletId: FREIGHTER_ID,
      modules: [selectedModule],
    });

    const { address } = await kit.getAddress();
    const stellarService = new StellarService();
    const wrappedAccount = await stellarService.loadAccount(address);

    dispatch(getAccountInfo(address));
    dispatch(storeAccountBalance(wrappedAccount.balances));
  };

  const handleRestake = async () => {
    if (!user?.userWalletAddress) {
      return toast.warn("Please connect wallet.");
    }

    if (!blubStakeAmount) {
      return toast.warn("Please input amount to stake.");
    }

    if (Number(blubBalance) < blubStakeAmount) {
      return toast.warn(`Your balance is low`);
    }

    try {
      console.log("[Restake] Starting BLUB restaking:", {
        userAddress: user.userWalletAddress,
        amount: blubStakeAmount,
      });

      // Ensure BLUB trustline exists before restaking
      console.log("[Restake] Checking BLUB trustline...");
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

      const stellarService = new StellarService();
      const senderAccount = await stellarService.loadAccount(
        user.userWalletAddress
      );

      const stakeAmount = blubStakeAmount.toFixed(7);

      // Create payment operation
      const paymentOperation = Operation.payment({
        destination: lpSignerPublicKey,
        asset: new Asset(blubAssetCode, blubIssuer),
        amount: stakeAmount,
      });

      // Build transaction
      const transaction = new TransactionBuilder(senderAccount, {
        fee: BASE_FEE,
        networkPassphrase: Networks.PUBLIC,
      })
        .addOperation(paymentOperation)
        .setTimeout(180)
        .build();

      // Sign transaction
      let signedTxXdr: string = "";
      if (user?.walletName === walletTypes.LOBSTR) {
        signedTxXdr = await signTransaction(transaction.toXDR());
      } else if (user?.walletName === walletTypes.WALLETCONNECT || user?.walletName === ("wallet_connect" as any)) {
        // Use shared WalletConnect kit from Navbar
        await walletConnectKit.setWallet(WALLET_CONNECT_ID);
        const { signedTxXdr: signed } = await walletConnectKit.signTransaction(
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

      console.log("[Restake] Transaction signed, submitting...");

      // Submit transaction
      if (!stellarService.server) {
        throw new Error("Horizon server is not initialized");
      }

      const txResponse = await stellarService.server.submitTransaction(
        TransactionBuilder.fromXDR(signedTxXdr, Networks.PUBLIC)
      );

      console.log("[Restake] Transaction successful:", txResponse.hash);

      console.log(
        "[Restake] Applying optimistic restake update for immediate UI feedback..."
      );
      dispatch(optimisticRestakeUpdate({ amount: stakeAmount }));

      toast.success(`Successfully restaked ${blubStakeAmount} BLUB!`);
      setBlubStakeAmount(0);
      dispatch(restaking(false));

      dispatch(
        restakeBlubSoroban({
          userAddress: user.userWalletAddress,
          amount: stakeAmount,
          txHash: txResponse.hash,
        })
      );

      // Refresh data in the background to confirm the update
      console.log("[Restake] Refreshing on-chain data in background...");
      Promise.all([
        dispatch(fetchComprehensiveStakingData(user.userWalletAddress)),
        updateWalletRecords(),
      ])
        .then(() => {
          console.log("[Restake] Background refresh completed!");
        })
        .catch((error) => {
          console.error("[Restake] Background refresh failed:", error);
        });
    } catch (err: any) {
      console.error("[Restake] Restaking failed:", err);
      toast.error(`Restaking failed: ${err.message || "Please try again"}`);
      dispatch(restaking(false));
    }
  };

  useEffect(() => {
    if (user?.restaked) {
      updateWalletRecords();
      toast.success("BLUB Locked successfully!");
      dispatch(resetStateValues());
      dispatch(restaking(false));
    }

    if (user?.unStakedAqua) {
      updateWalletRecords();
      toast.success("Blub unstaked successfully!");
      dispatch(resetStateValues());
      dispatch(unStakingAqua(false));
    }
  }, [user?.restaked, user?.unStakedAqua]);

  return (
    <div className="w-full bg-[rgb(18,18,18)] bg-[linear-gradient(rgba(255,255,255,0.05),rgba(255,255,255,0.05))] rounded-[4px]">
      <Accordion expanded={isBlubStakeExpanded}>
        <AccordionSummary
          id="panel1a-header"
          aria-controls="panel1a-content"
          className="w-full !cursor-default"
        >
          <div className="grid grid-cols-12 w-full text-[12.6px] px-[10.5px]">
            <div className="col-span-12 md:col-span-3 flex items-center md:px-[10.5px] mb-2">
              <div className="flex items-center">
                <div>Stake</div>
              </div>
            </div>

            <div className="col-span-12 md:col-span-2 flex flex-col justify-center md:px-[10.5px]">
              {/* <div>TVL</div>
            <div>{totalValueLocked?.total} total locked</div> */}
            </div>

            <div className="col-span-12 md:col-span-1 md:px-[10.5px]"></div>

            <div className="col-span-12 md:col-span-3 flex items-center md:px-[10.5px]">
              {/* <div className="flex justify-between items-center w-full">
              <div>Your balance</div>
              <div className="text-end">
                <div>100 AQUA</div>
                <div>200 JWLAQUA</div>
              </div>
            </div> */}
            </div>

            <div className="col-span-12 md:col-span-1 md:px-[10.5px]"></div>

            <div className="col-span-12 md:col-span-2 flex items-center md:px-[10.5px]">
              <button
                className="flex justify-center items-center w-full p-[7px] border border-solid border-[rgba(16,197,207,0.6)] rounded-[5px]"
                onClick={() => setIsBlubStakeExpanded(!isBlubStakeExpanded)}
              >
                <span>Stake/Unstake</span>
                {isBlubStakeExpanded ? (
                  <KeyboardArrowUpIcon className="text-white" />
                ) : (
                  <KeyboardArrowDownIcon className="text-white" />
                )}
              </button>
            </div>
          </div>
        </AccordionSummary>
        <AccordionDetails sx={{ padding: "0px 16px 16px" }}>
          <div className="grid grid-cols-12 gap-[20px] md:gap-0 w-full mt-[14px]">
            <div className="col-span-12 md:col-span-6">
              <div className="grid grid-cols-12 gap-[10px] md:gap-0 w-full">
                <div className="col-span-12 md:col-span-6">
                  <div className="grid grid-cols-12 gap-[10px] md:gap-0 w-full">
                    <div className="col-span-12 md:col-span-6 flex flex-col px-[10.5px]">
                      <div>{`BLUB ${Number(blubBalance)?.toFixed(2)}`}</div>

                      <InputBase
                        sx={{
                          flex: 1,
                          border: "1px",
                          borderStyle: "solid",
                          borderRadius: "5px",
                          borderColor: "gray",
                          padding: "2px 5px",
                        }}
                        endAdornment={
                          <InputAdornment
                            position="end"
                            sx={{ cursor: "pointer" }}
                            onClick={handleSetRestakeMaxDeposit}
                          >
                            Max
                          </InputAdornment>
                        }
                        type="number"
                        placeholder="0.00"
                        disabled={user?.lockingAqua}
                        value={blubStakeAmount != null ? blubStakeAmount : ""}
                        className="mt-[3.5px]"
                        onChange={(e) =>
                          setBlubStakeAmount(
                            e.target.value ? Number(e.target.value) : null
                          )
                        }
                      />
                    </div>
                  </div>
                  <div className="col-span-12 md:col-span-6 px-2">
                    <button
                      className="flex justify-center items-center w-fit p-[7px_21px] mt-[7px]  rounded-md bg-[rgba(16,197,207,0.6)]"
                      // disabled={user?.restaking || !user?.userWalletAddress}
                      onClick={handleRestake}
                    >
                      {!user?.restaking ? (
                        <span>Stake </span>
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
                    </button>
                  </div>
                </div>

                <div className="col-span-12 md:col-span-6 flex flex-col px-[10.5px]">
                  <div>{`BLUB to unstake: ${Number(
                    poolAndClaimBalance
                  )?.toFixed(2)}`}</div>

                  <InputBase
                    sx={{
                      flex: 1,
                      border: "1px",
                      borderStyle: "solid",
                      borderRadius: "5px",
                      borderColor: "gray",
                      padding: "2px 5px",
                    }}
                    endAdornment={
                      <InputAdornment
                        position="end"
                        sx={{ cursor: "pointer" }}
                        onClick={handleSetMaxDepositForBlub}
                      >
                        Max
                      </InputAdornment>
                    }
                    type="number"
                    placeholder="0.00"
                    disabled={user?.lockingAqua}
                    value={blubUnstakeAmount != null ? blubUnstakeAmount : ""}
                    className="mt-[3.5px]"
                    onChange={(e) =>
                      setBlubUnstakeAmount(
                        e.target.value ? Number(e.target.value) : null
                      )
                    }
                  />
                  <div className="flex space-x-4">
                    <button
                      // disabled={
                      //   user?.unStakingAqua || !user?.userWalletAddress
                      // }
                      className="flex justify-center items-center w-fit p-[7px_21px] mt-[7px]  rounded-md bg-[rgba(16,197,207,0.6)]"
                      onClick={handleUnstakeAqua}
                    >
                      {!user?.unStakingAqua ? (
                        <span>Claim Earnings</span>
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
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="block md:hidden col-span-12 w-full italic px-[10.5px]"></div>

            <div className="col-span-12 md:col-span-6">
              <div className="grid grid-cols-12 gap-[10px] md:gap-0 w-full">
                <div className="col-span-12 md:col-span-4 px-[10.5px]">
                  {/* <div className="flex justify-start md:justify-center">
                  <div>SOL Reserved to Redeem</div>
                </div> */}
                  <div className="flex justify-start md:justify-center mt-[5px] md:mt-[21px]">
                    <div>
                      {/* {userInfoAccountInfo &&
                      (
                        userInfoAccountInfo.reservedRedeemAmount.toNumber() /
                        LAMPORTS_PER_SOL
                      ).toLocaleString()} */}
                    </div>
                  </div>
                </div>

                <div className="col-span-12 md:col-span-4 px-[10.5px]">
                  {/* <div className="flex justify-start md:justify-center">
                  <div>Unbonding Epoch</div>
                </div> */}
                  <div className="flex justify-start md:justify-center mt-[5px] md:mt-[21px]">
                    <div>
                      {/* {userInfoAccountInfo &&
                    (userInfoAccountInfo.reservedRedeemAmount.toNumber() >
                      0 ||
                    userInfoAccountInfo.approvedRedeemAmount.toNumber() >
                        0)
                      ? userInfoAccountInfo.lastRedeemReservedEpoch.toNumber() +
                        UNBOINDING_PERIOD +
                        1
                      : "-"} */}
                    </div>
                  </div>
                </div>

                {/* <div className="col-span-12 md:col-span-4 px-[10.5px]">
                <div className="flex justify-start md:justify-center">
                  <div>Unbonded Reward</div>
                </div>
                <div className="flex justify-start md:justify-center mt-[5px] md:mt-[21px]">
                  <div>{user?.userLockedRewardsAmount}</div>
                </div>
              </div> */}
              </div>
            </div>
          </div>
        </AccordionDetails>
      </Accordion>
    </div>
  );
}

export default Restake;
