import React, { useEffect, useState } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  InputAdornment,
  InputBase,
} from "@mui/material";
import aquaLogo from "../../assets/images/aqua_logo.png";
import { toast } from "react-toastify";
import {
  KeyboardArrowDown as KeyboardArrowDownIcon,
  KeyboardArrowUp as KeyboardArrowUpIcon,
} from "@mui/icons-material";
import { TailSpin } from "react-loader-spinner";
import { useSelector } from "react-redux";
import { RootState } from "../../lib/store";
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
  mint,
  resetStateValues,
  storeAccountBalance,
} from "../../lib/slices/userSlice";
import { useAppDispatch } from "../../lib/hooks";
import { StellarService } from "../../services/stellar.service";
import {
  Asset,
  BASE_FEE,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import {
  blubAssetCode,
  blubIssuer,
  blubSignerPublicKey,
} from "../../utils/constants";
import { Balance } from "../../utils/interfaces";
import { MIN_DEPOSIT_AMOUNT } from "../../config";
import { walletTypes } from "../../enums";
import { signTransaction } from "@lobstrco/signer-extension-api";
import { kit as walletConnectKit } from "../Navbar";
import { WALLET_CONNECT_ID } from "../../lib/walletKit";

const aquaAssetCode = "AQUA";
const aquaAssetIssuer =
  "GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA";

function StakeAqua() {
  const dispatch = useAppDispatch();
  const user = useSelector((state: RootState) => state.user);
  const [isAquaStakeExpanded, setIsAquaStakeExpanded] = useState<boolean>(true);
  const [aquaDepositAmount, setAquaDepositAmount] = useState<number | null>();

  //get user aqua record
  const aquaRecord = user?.userRecords?.balances?.find(
    (balance) =>
      balance.asset_code === "AQUA" && balance.asset_issuer === aquaAssetIssuer
  );

  const userAquaBalance = aquaRecord?.balance;

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

  const handleSetMaxDeposit = () => {
    setAquaDepositAmount(Number(userAquaBalance));
  };

  const handleAddTrustline = async () => {
    if (!user?.userWalletAddress) {
      return toast.warn("Please connect wallet.");
    }

    const stellarService = new StellarService();
    const senderAccount = await stellarService.loadAccount(user.userWalletAddress);

    const transactionBuilder = new TransactionBuilder(senderAccount, {
      fee: BASE_FEE,
      networkPassphrase: Networks.PUBLIC,
    });

    const trustlineOperation = Operation.changeTrust({
      asset: new Asset(blubAssetCode, blubIssuer),
      limit: "1000000000",
    });

    const transactionXDR = transactionBuilder
      .addOperation(trustlineOperation)
      .setTimeout(30)
      .build()
      .toXDR();

    // Sign transaction with user's wallet
    let signedTxXdr: string = "";
    if (user?.walletName === walletTypes.LOBSTR) {
      signedTxXdr = await signTransaction(transactionXDR);
    } else if (user?.walletName === walletTypes.WALLETCONNECT || user?.walletName === ("wallet_connect" as any)) {
      // Use shared WalletConnect kit from Navbar
      await walletConnectKit.setWallet(WALLET_CONNECT_ID);
      const { signedTxXdr: signed } = await walletConnectKit.signTransaction(
        transactionXDR,
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
        transactionXDR,
        {
          address: user.userWalletAddress,
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
    dispatch(lockingAqua(true));

    if (!user?.userWalletAddress) {
      dispatch(lockingAqua(false));
      return toast.warn("Please connect wallet.");
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
    const senderAccount = await stellarService.loadAccount(user.userWalletAddress);
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

      // Sign transaction with user's wallet
      let signedTxXdr: string = "";
      if (user?.walletName === walletTypes.LOBSTR) {
        signedTxXdr = await signTransaction(transactionXDR);
      } else if (user?.walletName === walletTypes.WALLETCONNECT || user?.walletName === ("wallet_connect" as any)) {
        // Use shared WalletConnect kit from Navbar
        const { signedTxXdr: signed } = await walletConnectKit.signTransaction(
          transactionXDR,
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
          transactionXDR,
          {
            address: user.userWalletAddress,
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
          senderPublicKey: user.userWalletAddress,
        })
      );

      dispatch(lockingAqua(true));
      toast.success("Transaction sent!");
    } catch (err) {
      console.error("Transaction failed:", err);
      dispatch(lockingAqua(false));
    }
  };

  useEffect(() => {
    if (user?.lockedAqua) {
      updateWalletRecords();
      toast.success("Aqua locked successfully!");
      setAquaDepositAmount(0);
      dispatch(lockingAqua(false));
      dispatch(resetStateValues());
    }

    if (user?.lockedAqua) {
      updateWalletRecords();
      toast.success("Aqua locked successfully!");
      setAquaDepositAmount(0);
      dispatch(lockingAqua(false));
      dispatch(resetStateValues());
    }
  }, [user?.lockedAqua, user?.lockedAqua]);

  return (
    <div className="w-full bg-[rgb(18,18,18)] bg-[linear-gradient(rgba(255,255,255,0.05),rgba(255,255,255,0.05))] rounded-[4px]">
      <Accordion expanded={isAquaStakeExpanded}>
        <AccordionSummary
          id="panel1a-header"
          aria-controls="panel1a-content"
          className="w-full !cursor-default"
        >
          <div className="grid grid-cols-12 w-full text-[12.6px] px-[10.5px]">
            <div className="col-span-12 md:col-span-3 flex items-center md:px-[10.5px] mb-2">
              <div className="flex items-center">
                <div className="flex justify-center items-center w-[50px] h-[50px] mx-[7px]">
                  <img src={aquaLogo} alt="sol-logo" className="w-full" />
                </div>
                <div>AQUA</div>
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
                onClick={() => setIsAquaStakeExpanded(!isAquaStakeExpanded)}
              >
                <span>Stake</span>
                {isAquaStakeExpanded ? (
                  <KeyboardArrowUpIcon className="text-white" />
                ) : (
                  <KeyboardArrowDownIcon className="text-white" />
                )}
              </button>
            </div>
          </div>
        </AccordionSummary>

        <AccordionDetails sx={{ padding: "0px 16px 16px" }}>
          <div className="grid mt-[14px] px-4">
            Mint BLUB token by locking AQUA token and receive the share of AQUA
            governance and yield farming rewards. BLUB is automatically staked
            with an option to unstake and add liquidity in AQUA-BLUB pool.
          </div>
          <div className="grid grid-cols-12 gap-[20px] md:gap-0 w-full mt-[20px]">
            <div className="col-span-12 md:col-span-6">
              <div className="grid grid-cols-12 gap-[10px] md:gap-0 w-full">
                <div className="col-span-12 md:col-span-6 flex flex-col px-[10.5px]">
                  <div>
                    {`Avail AQUA Balance: ${
                      isNaN(Number(userAquaBalance))
                        ? 0
                        : Number(userAquaBalance).toFixed(2)
                    } AQUA`}
                  </div>

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
                        onClick={handleSetMaxDeposit}
                      >
                        Max
                      </InputAdornment>
                    }
                    type="number"
                    placeholder="0.00"
                    disabled={user?.lockingAqua}
                    value={aquaDepositAmount != null ? aquaDepositAmount : ""}
                    className="mt-[3.5px]"
                    onChange={(e) =>
                      setAquaDepositAmount(
                        e.target.value ? Number(e.target.value) : null
                      )
                    }
                  />
                  <div className="flex space-x-4">
                    <button
                      disabled={user?.lockingAqua || !user?.userWalletAddress}
                      className="flex justify-center items-center w-fit p-[7px_21px] mt-[7px] border-radius-1 rounded-md bg-[rgba(16,197,207,0.6)]"
                      onClick={handleLockAqua}
                    >
                      {!user?.lockingAqua ? (
                        <span>Convert & Stake</span>
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

                <div className="col-span-12 md:col-span-4 px-[10.5px]">
                  <div className="flex justify-start md:justify-center relative group">
                    <div>Your Earned Rewards</div>
                    <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 max-w-xs bg-gray-700 text-white text-sm rounded px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity break-words">
                      A total accumulated BLUB rewards, distributed
                      automatically for all stakers of WhaleHub
                    </div>
                  </div>
                  <div className="flex justify-start md:justify-center mt-[5px] md:mt-[21px]">
                    <div>{user?.userLockedRewardsAmount}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </AccordionDetails>
      </Accordion>
    </div>
  );
}

export default StakeAqua;
