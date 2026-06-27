// Soroban Configuration
// Clear browser cache and localStorage after updating these addresses

// Helper function to get required environment variable
const getRequiredEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `❌ [SorobanConfig] Missing required environment variable: ${key}. Please set it in your .env file.`
    );
  }
  return value;
};

// Helper function to get optional environment variable
const getOptionalEnv = (key: string, defaultValue: string = ""): string => {
  return process.env[key] || defaultValue;
};

export const SOROBAN_CONFIG = {
  // Contract IDs
  contracts: {
    staking: getRequiredEnv("REACT_APP_STAKING_CONTRACT_ID"),
    liquidity: getRequiredEnv("REACT_APP_LIQUIDITY_CONTRACT_ID"),
    rewards: getRequiredEnv("REACT_APP_REWARDS_CONTRACT_ID"),
    // Leveraged LP farming (Blend flash-loan vault). Testnet-only for now;
    // optional so the rest of the app loads when unset. See
    // docs/technical/leveraged-lp-farming.md.
    leverageVault: getOptionalEnv("REACT_APP_LEVERAGE_VAULT_CONTRACT_ID"),
  },

  // Leveraged LP farming stack (Blend on testnet)
  leverage: {
    vaultContractId: getOptionalEnv("REACT_APP_LEVERAGE_VAULT_CONTRACT_ID"),
    blendPoolId: getOptionalEnv("REACT_APP_BLEND_POOL_ID"),
    ammPoolId: getOptionalEnv("REACT_APP_LEVERAGE_AMM_POOL_ID"),
    lpToken: getOptionalEnv("REACT_APP_LEVERAGE_LP_TOKEN"),
    borrowAsset: getOptionalEnv("REACT_APP_LEVERAGE_BORROW_ASSET"),
    pairToken: getOptionalEnv("REACT_APP_LEVERAGE_PAIR_TOKEN"),
    // Enabled only when the vault contract id is configured.
    get enabled(): boolean {
      return Boolean(this.vaultContractId);
    },
  },

  // Network Configuration
  network: {
    name: getRequiredEnv("REACT_APP_STELLAR_NETWORK"),
    rpcUrl: getRequiredEnv("REACT_APP_SOROBAN_RPC_URL"),
    horizonUrl: getRequiredEnv("REACT_APP_HORIZON_URL"),
  },

  // Backend API Configuration
  api: {
    baseUrl: getRequiredEnv("REACT_APP_BACKEND_API_URL"),
    timeout: 30000,
  },

  // Feature Flags
  features: {
    useSoroban: process.env.REACT_APP_USE_SOROBAN === "true",
    enableContractSimulation:
      process.env.REACT_APP_ENABLE_CONTRACT_SIMULATION === "true",
    enableRealTimeSync: process.env.REACT_APP_ENABLE_REAL_TIME_SYNC === "true",
    debugMode: process.env.REACT_APP_DEBUG_MODE === "true",
  },

  // Transaction Configuration
  transaction: {
    defaultFee: "100000",
    timeout: 30,
    retryAttempts: 3,
    retryDelay: 2000,
  },

  // Sync Configuration
  sync: {
    interval: 10 * 60 * 1000, // 10 minutes
    retryAttempts: 3,
    retryDelay: 5000,
  },

  // Asset Configuration
  assets: {
    aqua: {
      code: "AQUA",
      issuer: getRequiredEnv("REACT_APP_AQUA_ISSUER"),
      // Soroban SAC (Stellar Asset Contract) address for AQUA
      sorobanContract: getRequiredEnv("REACT_APP_AQUA_TOKEN_CONTRACT"),
    },
    blub: {
      code: "BLUB",
      issuer: "", // Minted by staking contract
      sorobanContract: getRequiredEnv("REACT_APP_BLUB_TOKEN_CONTRACT"),
    },
    // ICE tokens - minted by Aquarius when AQUA is locked
    // All 4 types are non-transferable and used within Aquarius ecosystem
    // @see https://docs.aqua.network/ice/ice-tokens-locking-aqua-and-getting-benefits
    ice: {
      code: "ICE",
      issuer: getOptionalEnv("REACT_APP_ICE_ISSUER"),
      // SAC wrapped ICE token contract
      sorobanContract: getOptionalEnv("REACT_APP_ICE_TOKEN_CONTRACT"),
    },
    governIce: {
      code: "governICE",
      issuer: getOptionalEnv("REACT_APP_GOVERN_ICE_ISSUER"),
      // SAC wrapped governICE token contract (for governance voting)
      sorobanContract: getOptionalEnv("REACT_APP_GOVERN_ICE_TOKEN_CONTRACT"),
    },
    upvoteIce: {
      code: "upvoteICE",
      issuer: getOptionalEnv("REACT_APP_UPVOTE_ICE_ISSUER"),
      // SAC wrapped upvoteICE token contract (for liquidity voting)
      sorobanContract: getOptionalEnv("REACT_APP_UPVOTE_ICE_TOKEN_CONTRACT"),
    },
    downvoteIce: {
      code: "downvoteICE",
      issuer: getOptionalEnv("REACT_APP_DOWNVOTE_ICE_ISSUER"),
      // SAC wrapped downvoteICE token contract (for downvoting markets)
      sorobanContract: getOptionalEnv("REACT_APP_DOWNVOTE_ICE_TOKEN_CONTRACT"),
    },
  },

  // Pool Configuration
  pools: {
    aquaBlub: {
      id: "1",
      assetA: "AQUA",
      assetB: "BLUB",
      feeRate: 0.003, // 0.3%
    },
    xlmUsdc: {
      id: "2",
      assetA: "XLM",
      assetB: "USDC",
      feeRate: 0.003, // 0.3%
    },
    aquaXlm: {
      id: "3",
      assetA: "AQUA",
      assetB: "XLM",
      feeRate: 0.003, // 0.3%
    },
  },

  // POL Configuration
  pol: {
    contributionPercentage: 0.1, // 10% of locked AQUA
    autoVotingEnabled: true,
    votingTarget: "AQUA-BLUB", // ICE tokens automatically vote for AQUA-BLUB pair
  },

  // Governance Configuration
  governance: {
    maxLockDuration: 365, // days
    baseMultiplier: 1.0,
    maxMultiplier: 2.0,
    votingPowerMultiplier: 1.0,
  },
};

// Helper functions
export const getContractId = (
  contractType: keyof typeof SOROBAN_CONFIG.contracts
): string => {
  return SOROBAN_CONFIG.contracts[contractType];
};

export const isFeatureEnabled = (
  feature: keyof typeof SOROBAN_CONFIG.features
): boolean => {
  return SOROBAN_CONFIG.features[feature];
};

export const getAssetConfig = (assetCode: string) => {
  return Object.values(SOROBAN_CONFIG.assets).find(
    (asset) => asset.code === assetCode
  );
};

export const getPoolConfig = (poolId: string) => {
  return Object.values(SOROBAN_CONFIG.pools).find((pool) => pool.id === poolId);
};

// Environment validation
export const validateEnvironment = (): {
  isValid: boolean;
  errors: string[];
} => {
  const errors: string[] = [];

  // Check required contract IDs
  if (!SOROBAN_CONFIG.contracts.staking) {
    errors.push("Staking contract ID is required");
  }

  // Check network configuration
  if (!SOROBAN_CONFIG.network.rpcUrl) {
    errors.push("Soroban RPC URL is required");
  }

  // Check backend API
  if (!SOROBAN_CONFIG.api.baseUrl) {
    errors.push("Backend API URL is required");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

// Log configuration on load
if (SOROBAN_CONFIG.features.debugMode) {
  console.log("🔧 [SorobanConfig] Configuration loaded:", SOROBAN_CONFIG);

  const validation = validateEnvironment();
  if (!validation.isValid) {
    console.warn("⚠️ [SorobanConfig] Configuration issues:", validation.errors);
  } else {
    console.log("✅ [SorobanConfig] Configuration validated successfully");
  }
}
