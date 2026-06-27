import { createAsyncThunk, createSlice, PayloadAction } from "@reduxjs/toolkit";
import axios from "axios";
import { BACKEND_API } from "../../utils/constants";
import { CustomError } from "../../utils/interfaces";
import {
  SummarizedAssets,
  TransactionData,
  UserRecords,
} from "../../interfaces";
import { FREIGHTER_ID, LOBSTR_ID } from "../walletKit";
import { WALLET_CONNECT_ID } from "../walletKit";

export interface User {
  userRecords: UserRecords;
  walletConnected: boolean;
  walletSelectionOpen: boolean;
  userWalletAddress: string | null;
  connectingWallet: boolean;
  walletName:
    | typeof LOBSTR_ID
    | typeof FREIGHTER_ID
    | typeof WALLET_CONNECT_ID
    | null;
  fetchingWalletInfo: boolean;
  lockingAqua: boolean;
  unStakingAqua: boolean;
  restaking: boolean;
  restaked: boolean;
  providingLp: boolean;
  providedLp: boolean;
  lockedAqua: boolean;
  unStakedAqua: boolean;
  userLockedRewardsAmount: number;
}

const initialState: User = {
  userRecords: {
    balances: null,
    account: null,
  },
  walletConnected: false,
  walletSelectionOpen: false,
  userWalletAddress: null,
  connectingWallet: false,
  walletName: null,
  fetchingWalletInfo: false,
  lockingAqua: false,
  unStakingAqua: false,
  restaking: false,
  restaked: false,
  providingLp: false,
  providedLp: false,
  lockedAqua: false,
  unStakedAqua: false,
  userLockedRewardsAmount: 0,
};

export const mint = createAsyncThunk(
  "lock/stake",
  async (
    values: {
      assetCode: string;
      assetIssuer: string;
      amount: string;
      signedTxXdr: string;
      senderPublicKey: string;
    },
    { rejectWithValue }
  ) => {
    try {
      // Convert amount to number and validate
      const numericAmount = parseFloat(values.amount);

      // Validate amount is a valid number and meets minimum requirement
      if (isNaN(numericAmount) || numericAmount < 0.0000001) {
        console.error("❌ [userSlice] Invalid amount:", values.amount);
        return rejectWithValue(
          "Amount must be a valid number and at least 0.0000001"
        );
      }

      // Validate required fields
      if (
        !values.assetCode ||
        !values.assetIssuer ||
        !values.signedTxXdr ||
        !values.senderPublicKey
      ) {
        console.error("❌ [userSlice] Missing required fields:", values);
        return rejectWithValue("All fields are required");
      }

      const requestData = {
        assetCode: values.assetCode.trim(),
        assetIssuer: values.assetIssuer.trim(),
        amount: numericAmount, // Send as number, not string
        signedTxXdr: values.signedTxXdr.trim(),
        senderPublicKey: values.senderPublicKey.trim(),
        // Do not send treasuryAmount - let backend calculate it
      };

      console.log(
        "ℹ️ [userSlice] Backend disabled - skipping mint API call:",
        requestData
      );

      // Return success without backend call
      return {
        success: true,
        message: "Transaction submitted (backend disabled)",
        data: requestData,
      };
    } catch (error: any) {
      console.error("❌ [userSlice] Mint request failed:", {
        error: error.response?.data || error.message,
        status: error.response?.status,
        requestData: values,
      });

      // Handle axios errors which have a different structure than CustomError
      if (error.response) {
        const { status, data } = error.response;

        // Handle validation errors (400)
        if (status === 400) {
          const errorMessage =
            data?.message || data?.error?.message || "Validation failed";
          console.error("❌ [userSlice] Validation error:", errorMessage);
          return rejectWithValue(errorMessage);
        }

        // Handle service unavailable (503)
        if (status === 503) {
          const errorMessage =
            data?.message ||
            "Service temporarily unavailable. Please try again later.";
          console.error("❌ [userSlice] Service error:", errorMessage);
          return rejectWithValue(errorMessage);
        }

        // Handle other HTTP errors
        const errorMessage =
          data?.message ||
          data?.error?.message ||
          `Request failed with status ${status}`;
        return rejectWithValue(errorMessage);
      }

      // Handle network/other errors
      const errorMessage =
        error.message ||
        "Network error occurred. Please check your connection and try again.";
      return rejectWithValue(errorMessage);
    }
  }
);

export const unStakeAqua = createAsyncThunk(
  "lock/unlock-aqua",
  async (
    values: {
      senderPublicKey: string;
      amountToUnstake: number;
      signedTxXdr: string;
    },
    { rejectWithValue }
  ) => {
    try {
      // Validate amount
      if (isNaN(values.amountToUnstake) || values.amountToUnstake <= 0) {
        console.error(
          "❌ [userSlice] Invalid unstake amount:",
          values.amountToUnstake
        );
        return rejectWithValue(
          "Amount to unstake must be a valid positive number"
        );
      }

      // Validate required fields
      if (!values.senderPublicKey || !values.signedTxXdr) {
        console.error(
          "❌ [userSlice] Missing required fields for unStakeAqua:",
          values
        );
        return rejectWithValue(
          "Sender public key and signed transaction are required"
        );
      }

      // Validate signed transaction XDR length (basic validation)
      if (values.signedTxXdr.trim().length < 10) {
        console.error(
          "❌ [userSlice] Invalid signed transaction XDR:",
          values.signedTxXdr
        );
        return rejectWithValue("Signed transaction XDR appears to be invalid");
      }

      const requestData = {
        senderPublicKey: values.senderPublicKey.trim(),
        amountToUnstake: values.amountToUnstake, // Already a number
        signedTxXdr: values.signedTxXdr.trim(),
      };

      console.log(
        "ℹ️ [userSlice] Backend disabled - skipping unStakeAqua API call:",
        requestData
      );

      // Return success without backend call
      return {
        success: true,
        message: "Transaction submitted (backend disabled)",
        data: requestData,
      };
    } catch (error: any) {
      console.error("❌ [userSlice] UnStakeAqua request failed:", {
        error: error.response?.data || error.message,
        status: error.response?.status,
        requestData: values,
      });

      // Handle axios errors properly
      if (error.response) {
        const { status, data } = error.response;

        // Handle validation errors (400)
        if (status === 400) {
          const errorMessage =
            data?.message || data?.error?.message || "Validation failed";
          console.error(
            "❌ [userSlice] UnStakeAqua validation error:",
            errorMessage
          );
          return rejectWithValue(errorMessage);
        }

        // Handle other HTTP errors
        const errorMessage =
          data?.message ||
          data?.error?.message ||
          `Request failed with status ${status}`;
        return rejectWithValue(errorMessage);
      }

      // Handle network/other errors
      const errorMessage =
        error.message ||
        "Network error occurred. Please check your connection and try again.";
      return rejectWithValue(errorMessage);
    }
  }
);

export const restakeBlub = createAsyncThunk(
  "lock/restake-blub",
  async (
    values: {
      assetCode: string;
      assetIssuer: string;
      amount: string;
      signedTxXdr: string;
      senderPublicKey: string;
    },
    { rejectWithValue }
  ) => {
    try {
      // Validate and convert amount to number
      const numericAmount = parseFloat(values.amount);

      if (isNaN(numericAmount) || numericAmount <= 0) {
        console.error("❌ [userSlice] Invalid restake amount:", values.amount);
        return rejectWithValue("Amount must be a valid positive number");
      }

      // Validate required fields
      if (!values.signedTxXdr || !values.senderPublicKey) {
        console.error(
          "❌ [userSlice] Missing required fields for restakeBlub:",
          values
        );
        return rejectWithValue(
          "Sender public key and signed transaction are required"
        );
      }

      // Backend only expects: senderPublicKey, amount (number), signedTxXdr
      // assetCode and assetIssuer are optional per the DTO
      const requestData = {
        senderPublicKey: values.senderPublicKey.trim(),
        amount: numericAmount, // Send as number
        signedTxXdr: values.signedTxXdr.trim(),
        // Include optional fields if provided (for compatibility)
        ...(values.assetCode && { assetCode: values.assetCode.trim() }),
        ...(values.assetIssuer && { assetIssuer: values.assetIssuer.trim() }),
      };

      console.log(
        "ℹ️ [userSlice] Backend disabled - skipping restakeBlub API call:",
        requestData
      );

      // Return success without backend call
      return {
        success: true,
        message: "Transaction submitted (backend disabled)",
        data: requestData,
      };
    } catch (error: any) {
      console.error("❌ [userSlice] RestakeBlub request failed:", {
        error: error.response?.data || error.message,
        status: error.response?.status,
        requestData: values,
      });

      // Handle axios errors properly
      if (error.response) {
        const { status, data } = error.response;

        // Handle validation errors (400)
        if (status === 400) {
          const errorMessage =
            data?.message || data?.error?.message || "Validation failed";
          console.error(
            "❌ [userSlice] RestakeBlub validation error:",
            errorMessage
          );
          return rejectWithValue(errorMessage);
        }

        // Handle other HTTP errors
        const errorMessage =
          data?.message ||
          data?.error?.message ||
          `Request failed with status ${status}`;
        return rejectWithValue(errorMessage);
      }

      // Handle network/other errors
      const errorMessage =
        error.message ||
        "Network error occurred. Please check your connection and try again.";
      return rejectWithValue(errorMessage);
    }
  }
);

export const getAccountInfo = createAsyncThunk(
  "user/info",
  async (account: string, { rejectWithValue }) => {
    try {
      // Validate account address format
      if (!account || typeof account !== "string") {
        console.error("❌ [userSlice] Invalid account parameter:", account);
        return rejectWithValue("Invalid account address provided");
      }

      const trimmedAccount = account.trim();
      if (trimmedAccount.length !== 56 || !trimmedAccount.startsWith("G")) {
        console.error("❌ [userSlice] Invalid account format:", {
          account: trimmedAccount,
          length: trimmedAccount.length,
          startsWithG: trimmedAccount.startsWith("G"),
        });
        return rejectWithValue("Invalid Stellar account address format");
      }

      console.log(
        "ℹ️ [userSlice] Backend disabled - returning empty account data for:",
        trimmedAccount
      );

      const emptyData = {
        id: "",
        account: trimmedAccount,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        claimableRecords: [],
        pools: [],
        stakes: [],
        treasuryDeposits: [],
        lpBalances: [],
      };

      return emptyData;
    } catch (error: any) {
      console.error("❌ [userSlice] Error in getAccountInfo:", {
        account: account,
        error: error,
        errorMessage: error?.message,
      });

      // Return empty data instead of throwing
      return {
        id: "",
        account: account,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        claimableRecords: [],
        pools: [],
        stakes: [],
        treasuryDeposits: [],
        lpBalances: [],
      };
    }
  }
);

export const storeAccountBalance = createAsyncThunk(
  "user/record",
  async (values: any[], { rejectWithValue }) => {
    try {
      console.log("💾 [userSlice] Storing account balances:", {
        balanceCount: values?.length || 0,
        balances: values?.map((balance: any) => ({
          asset_type: balance.asset_type,
          asset_code: balance.asset_code || "XLM",
          balance: balance.balance,
          limit: balance.limit,
          buying_liabilities: balance.buying_liabilities,
          selling_liabilities: balance.selling_liabilities,
          asset_issuer: balance.asset_issuer,
        })),
        timestamp: new Date().toISOString(),
      });

      return values;
    } catch (error: any) {
      console.error("❌ [userSlice] Error storing account balances:", error);
      const customError: CustomError = error;

      if (customError.response && customError.response.data.error.message) {
        return rejectWithValue(customError.response.data.error.message);
      }

      throw new Error(customError.message || "An unknown error occurred");
    }
  }
);

export const addLP = createAsyncThunk(
  "lock/mint",
  async (values: TransactionData, { rejectWithValue }) => {
    console.log(
      "ℹ️ [userSlice] Backend disabled - skipping addLP API call:",
      values
    );

    // Return success without backend call
    return {
      success: true,
      message: "Transaction submitted (backend disabled)",
      data: values,
    };
  }
);

export const provideLiquidity = createAsyncThunk(
  "liquidity/provide",
  async (
    values: {
      asset1: {
        code: string;
        issuer: string;
        amount: string;
      };
      asset2: {
        code: string;
        issuer: string;
        amount: string;
      };
      signedTxXdr: string;
      senderPublicKey: string;
    },
    { rejectWithValue }
  ) => {
    try {
      // Validate and convert amounts to numbers
      const amount1 = parseFloat(values.asset1.amount);
      const amount2 = parseFloat(values.asset2.amount);

      if (isNaN(amount1) || amount1 < 1) {
        console.error(
          "❌ [userSlice] Invalid asset1 amount:",
          values.asset1.amount
        );
        return rejectWithValue("Asset 1 amount must be at least 1");
      }

      if (isNaN(amount2) || amount2 < 1) {
        console.error(
          "❌ [userSlice] Invalid asset2 amount:",
          values.asset2.amount
        );
        return rejectWithValue("Asset 2 amount must be at least 1");
      }

      // Validate required fields
      if (!values.signedTxXdr || !values.senderPublicKey) {
        console.error(
          "❌ [userSlice] Missing required fields for provideLiquidity:",
          values
        );
        return rejectWithValue(
          "Sender public key and signed transaction are required"
        );
      }

      // Format data to match CreateAddLiquidityDto structure
      const requestData = {
        asset1: {
          code: values.asset1.code.trim(),
          issuer: values.asset1.issuer?.trim() || undefined, // Handle native assets with empty string
          amount: amount1, // Send as number
        },
        asset2: {
          code: values.asset2.code.trim(),
          issuer: values.asset2.issuer?.trim() || undefined, // Handle native assets with empty string
          amount: amount2, // Send as number
        },
        signedTxXdr: values.signedTxXdr.trim(),
        senderPublicKey: values.senderPublicKey.trim(),
      };

      console.log(
        "ℹ️ [userSlice] Backend disabled - skipping provideLiquidity API call:",
        requestData
      );

      // Return success without backend call
      return {
        success: true,
        message: "Transaction submitted (backend disabled)",
        data: requestData,
      };
    } catch (error: any) {
      console.error("❌ [userSlice] ProvideLiquidity request failed:", {
        error: error.response?.data || error.message,
        status: error.response?.status,
        requestData: values,
      });

      // Handle axios errors properly
      if (error.response) {
        const { status, data } = error.response;

        // Handle validation errors (400)
        if (status === 400) {
          const errorMessage =
            data?.message || data?.error?.message || "Validation failed";
          console.error(
            "❌ [userSlice] ProvideLiquidity validation error:",
            errorMessage
          );
          return rejectWithValue(errorMessage);
        }

        // Handle other HTTP errors
        const errorMessage =
          data?.message ||
          data?.error?.message ||
          `Request failed with status ${status}`;
        return rejectWithValue(errorMessage);
      }

      // Handle network/other errors
      const errorMessage =
        error.message ||
        "Network error occurred. Please check your connection and try again.";
      return rejectWithValue(errorMessage);
    }
  }
);

export const withdrawLP = createAsyncThunk(
  "liquidity/withdraw",
  async (
    values: {
      senderPublicKey: string;
      userPoolPercentage: number;
      summerizedAssets: SummarizedAssets | null;
    },
    { rejectWithValue }
  ) => {
    console.log(
      "ℹ️ [userSlice] Backend disabled - skipping removeLiquidity API call:",
      values
    );

    // Return success without backend call
    return {
      success: true,
      message: "Transaction submitted (backend disabled)",
      data: values,
    };
  }
);

export const redeemLPReward = createAsyncThunk(
  "liquidity/withdraw",
  async (
    values: {
      senderPublicKey: string;
      userPoolPercentage: number;
      summerizedAssets: SummarizedAssets | null;
    },
    { rejectWithValue }
  ) => {
    console.log(
      "ℹ️ [userSlice] Backend disabled - skipping redeemLPReward API call:",
      values
    );

    // Return success without backend call
    return {
      success: true,
      message: "Transaction submitted (backend disabled)",
      data: values,
    };
  }
);

export const getLockedAquaRewardsForAccount = createAsyncThunk(
  "user/lockedAquaRewards",
  async (account: string | undefined, { rejectWithValue }) => {
    console.log(
      "ℹ️ [userSlice] Backend disabled - skipping getLockedAquaRewards API call for:",
      account
    );

    // Return empty data without backend call
    return {
      lockedRewards: 0,
      lockedAquaRewardEstimation: 0,
      data: [],
    };
  }
);

export const userSlice = createSlice({
  name: "user",
  initialState,
  reducers: {
    walletSelectionAction: (state, { payload }: PayloadAction<any>) => ({
      ...state,
      walletSelectionOpen: payload,
    }),
    setUserWalletAddress: (state, { payload }: PayloadAction<any>) => {
      return {
        ...state,
        userWalletAddress: payload,
      };
    },
    setConnectingWallet: (state, { payload }: PayloadAction<any>) => ({
      ...state,
      connectingWallet: payload,
    }),
    setWalletConnectName: (state, { payload }: PayloadAction<any>) => ({
      ...state,
      walletName: payload,
    }),
    fetchingWalletInfo: (state, { payload }: PayloadAction<any>) => ({
      ...state,
      fetchingWalletInfo: payload,
    }),
    lockingAqua: (state, { payload }: PayloadAction<any>) => ({
      ...state,
      lockingAqua: payload,
    }),
    restaking: (state, { payload }: PayloadAction<any>) => ({
      ...state,
      restaking: payload,
    }),
    unStakingAqua: (state, { payload }: PayloadAction<any>) => ({
      ...state,
      unStakingAqua: payload,
    }),
    providingLp: (state, { payload }: PayloadAction<any>) => ({
      ...state,
      providingLp: payload,
    }),
    resetStateValues: (state) => ({
      ...state,
      lockedAqua: false,
      providedLp: false,
      unStakedAqua: false,
      restaked: false,
    }),
    setWalletConnected: (state, { payload }) => ({
      ...state,
      walletConnected: payload,
    }),
    setUserbalances: (state, { payload }) => {
      console.log("💾 [userSlice] setUserbalances reducer called:", {
        payloadCount: payload?.length || 0,
        payload: payload?.map((balance: any) => ({
          asset_type: balance.asset_type,
          asset_code: balance.asset_code || "XLM",
          balance: balance.balance,
          limit: balance.limit,
        })),
        existingBalances: state.userRecords?.balances?.length || 0,
        timestamp: new Date().toISOString(),
      });

      return {
        ...state,
        userRecords: {
          ...state.userRecords,
          balances: payload,
        },
      };
    },
    logOut: (state) => ({
      ...state,
      userRecords: { balances: null, account: null },
      walletConnected: false,
      walletSelectionOpen: false,
      userWalletAddress: null,
      connectingWallet: false,
      walletName: null,
      fetchingWalletInfo: false,
      lockingAqua: false,
      unStakingAqua: false,
      restaking: false,
      restaked: false,
      providingLp: false,
      providedLp: false,
      lockedAqua: false,
      unStakedAqua: false,
      userLockedRewardsAmount: 0,
    }),
  },
  extraReducers(builder) {
    //mint
    builder.addCase(mint.pending, (state) => {
      state.lockingAqua = true;
    });

    builder.addCase(mint.fulfilled, (state, {}) => {
      state.lockedAqua = true;
      state.lockingAqua = false;
    });

    builder.addCase(mint.rejected, (state, action) => {
      state.lockingAqua = false;
      console.error("❌ [userSlice] Mint operation rejected:", action.payload);
    });

    //unlock
    builder.addCase(unStakeAqua.pending, (state) => {
      state.unStakingAqua = true;
    });

    builder.addCase(unStakeAqua.fulfilled, (state, {}) => {
      state.unStakedAqua = true;
      state.unStakingAqua = false;
      state.userLockedRewardsAmount = 0;
    });

    builder.addCase(unStakeAqua.rejected, (state, action) => {
      state.unStakingAqua = false;
      console.error(
        "❌ [userSlice] UnStake operation rejected:",
        action.payload
      );
    });

    //restake
    builder.addCase(restakeBlub.pending, (state) => {
      state.restaking = true;
    });

    builder.addCase(restakeBlub.fulfilled, (state, {}) => {
      state.restaked = true;
      state.restaking = false;
    });

    builder.addCase(restakeBlub.rejected, (state, action) => {
      state.restaking = false;
      console.error(
        "❌ [userSlice] Restake operation rejected:",
        action.payload
      );
    });

    //provide lp
    builder.addCase(provideLiquidity.pending, (state) => {
      state.providingLp = true;
    });

    builder.addCase(provideLiquidity.fulfilled, (state, {}) => {
      state.providedLp = true;
      state.providingLp = false;
    });

    builder.addCase(provideLiquidity.rejected, (state) => {
      state.providingLp = false;
    });

    //store account
    builder.addCase(storeAccountBalance.pending, () => {});

    builder.addCase(storeAccountBalance.fulfilled, (state, { payload }) => {
      state.userRecords.balances = payload;
    });

    builder.addCase(storeAccountBalance.rejected, () => {});

    //get user account details from db
    builder.addCase(getAccountInfo.pending, () => {});

    builder.addCase(getAccountInfo.fulfilled, (state, { payload }) => {
      state.userRecords.account = payload;
    });

    builder.addCase(getAccountInfo.rejected, () => {});

    //get user locked aqua rewards
    builder.addCase(getLockedAquaRewardsForAccount.pending, () => {});

    builder.addCase(
      getLockedAquaRewardsForAccount.fulfilled,
      (state, { payload }) => {
        // console.log(payload);
        state.userLockedRewardsAmount = payload.lockedAquaRewardEstimation;
      }
    );

    builder.addCase(getLockedAquaRewardsForAccount.rejected, () => {});
  },
});

export const {
  logOut,
  restaking,
  providingLp,
  lockingAqua,
  unStakingAqua,
  resetStateValues,
  fetchingWalletInfo,
  setConnectingWallet,
  setWalletConnectName,
  setUserWalletAddress,
  walletSelectionAction,
  setWalletConnected,
  setUserbalances,
} = userSlice.actions;
