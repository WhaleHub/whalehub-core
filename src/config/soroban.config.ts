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

  // Leveraged LP farming stack (Blend on TESTNET).
  // The /leverage screen always operates on testnet (the leverage service pins its own
  // testnet RPC + passphrase), so these testnet addresses are baked in as defaults — the
  // hidden page works on the mainnet prod build without any Netlify env changes. Env vars
  // still override if set. Deployed 2026-06-27 (identity `core`).
  leverage: {
    // Each market is a separate leverage vault (LP collateral + borrow asset) on Blend.
    // All on testnet; the /leverage service pins testnet RPC regardless of app network.
    markets: [
      {
        id: "aqua-usdc",
        label: "AQUA / USDC",
        // pair tokens shown in the UI (for icons + labels)
        tokenA: "AQUA",
        tokenB: "USDC",
        borrowSymbol: "USDC",
        status: "live" as "live" | "activating",
        note: "",
        vault: getOptionalEnv(
          "REACT_APP_LEVERAGE_VAULT_CONTRACT_ID",
          "CC2JF2VP3LVNHYI7URF3R376FCVFSAI4HNVZ2WPZZHBJDAJSWX2X2PFH"
        ),
        zapper: "CCUDFI62LH2IMHGSRBLLF7SIKRPDQ3LZPA4TYFBFS5ENRYWZOHOKSHT2",
        blendPool: "CDSFGJOQ5RHIPK5522VVCNYNOQH4ECGRTPWZK6QBQV4XXA4IAE5BVTW4",
        amm: "CDOTVNSYEFF6TWAFSMO3AVSHYEMTMAWTR2E7GXUOOLOCSEC6UV6KJWGC",
        lpToken: "CDOTVNSYEFF6TWAFSMO3AVSHYEMTMAWTR2E7GXUOOLOCSEC6UV6KJWGC",
        borrowAsset: "CA2AYW5YFEI36LY5L7NTDN666KMR7SBCY4MLY6FA6UMAYBF3ZS7PR7WH",
        pairToken: "CAMP6O2ZGMY65DDCJKC7RGZVSOWTFHQDHG6MHD2BRZXBUQBIYNQJMCUJ",
      },
      {
        id: "xlm-usdc",
        label: "XLM / USDC",
        tokenA: "XLM",
        tokenB: "USDC",
        borrowSymbol: "USDC",
        // Blend reserve for this LP is queued; activates ~2026-07-06 (1-week timelock).
        status: "activating" as "live" | "activating",
        note: "Blend reserve unlocks ~Jul 6, 2026",
        vault: "CB7PYSZRGKRRCYXYDQ7WKIWOK5WLKXKN4FWK3XL5NDHT3WFY622XVSEH",
        zapper: "CCWJ5FW5ZU6WSCFL4FO4TNAK3Q6G63WUILNIBOR26RRLNQBVUUUO7VHT",
        blendPool: "CDSFGJOQ5RHIPK5522VVCNYNOQH4ECGRTPWZK6QBQV4XXA4IAE5BVTW4",
        amm: "CAKZSBUEJCDXO7D5BFXPIY6NBVBUONHJ7RSFNK6R4C7SNKST7Y5FHQHC",
        lpToken: "CAKZSBUEJCDXO7D5BFXPIY6NBVBUONHJ7RSFNK6R4C7SNKST7Y5FHQHC",
        borrowAsset: "CA2AYW5YFEI36LY5L7NTDN666KMR7SBCY4MLY6FA6UMAYBF3ZS7PR7WH",
        pairToken: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
      },
    ],
    // Legacy single-market fields (= market 0) for the service's default vault.
    vaultContractId: getOptionalEnv(
      "REACT_APP_LEVERAGE_VAULT_CONTRACT_ID",
      "CC2JF2VP3LVNHYI7URF3R376FCVFSAI4HNVZ2WPZZHBJDAJSWX2X2PFH"
    ),
    get enabled(): boolean {
      return this.markets.some((m) => Boolean(m.vault));
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
