#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, Bytes, Env, Vec, Symbol, IntoVal,
    auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation},
};

// ============================================================================
// Aquarius Pool Interface (External Contract)
// ============================================================================

mod aquarius_pool {
    use soroban_sdk::{Address, Env, Map, Symbol, Val, Vec, contractclient};

    #[contractclient(name = "AquariusPoolClient")]
    pub trait AquariusPoolTrait {
        /// Claims rewards from the pool
        /// Returns: Amount of reward tokens claimed
        fn claim(env: Env, user: Address) -> u128;

        /// Deposits tokens to the pool
        /// Parameters:
        /// - user: Address depositing
        /// - desired_amounts: Vec<u128> of [token_a_amount, token_b_amount]
        /// - min_shares: u128 minimum LP tokens to receive
        /// Returns: (actual_amounts: Vec<u128>, shares_minted: u128)
        fn deposit(
            env: Env,
            user: Address,
            desired_amounts: Vec<u128>,
            min_shares: u128,
        ) -> (Vec<u128>, u128);

        /// Withdraws from the pool
        /// Parameters:
        /// - user: Address withdrawing
        /// - share_amount: u128 LP tokens to burn
        /// - min_amounts: Vec<u128> minimum tokens to receive
        /// Returns: Vec<u128> actual amounts withdrawn
        fn withdraw(
            env: Env,
            user: Address,
            share_amount: u128,
            min_amounts: Vec<u128>,
        ) -> Vec<u128>;

        /// Gets pool information
        fn get_info(env: Env) -> Map<Symbol, Val>;

        /// Gets pool reserves
        fn get_reserves(env: Env) -> Vec<u128>;

        /// Gets total LP shares in circulation
        fn get_total_shares(env: Env) -> u128;
    }
}

use aquarius_pool::AquariusPoolClient;

/// Old Config struct for migration (matches deployed v1.0.0 contract)
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OldConfig {
    pub admin: Address,
    pub aqua_token: Address,
    pub blub_token: Address,
    pub ice_contract: Address,
    pub liquidity_contract: Address,
    pub period_unit_minutes: u64,
    pub reward_rate: i128,
    pub total_supply: i128,
    pub treasury_address: Address,
    pub version: u32,
}

/// Config struct for v1.1.0 (before cooldown fields were added)
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ConfigV1_1 {
    pub admin: Address,
    pub version: u32,
    pub total_supply: i128,
    pub treasury_address: Address,
    pub reward_rate: i128,
    pub aqua_token: Address,
    pub blub_token: Address,
    pub liquidity_contract: Address,
    pub ice_token: Address,
    pub govern_ice_token: Address,
    pub upvote_ice_token: Address,
    pub downvote_ice_token: Address,
    pub period_unit_minutes: u64,
    pub vault_treasury: Address,
    pub vault_fee_bps: u32,
}

/// New Config struct (v1.2.0)
/// Version encoding: major * 10000 + minor * 100 + patch
/// 1.2.0 = 10200
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    pub admin: Address,
    pub version: u32, // 10200 = v1.2.0
    pub total_supply: i128,
    pub treasury_address: Address,
    pub reward_rate: i128, // basis points per period
    pub aqua_token: Address, // AQUA token contract address
    pub blub_token: Address, // External BLUB token (Stellar asset)
    pub liquidity_contract: Address, // AQUA/BLUB StableSwap pool contract on Stellar network
    // ICE token addresses (4 types)
    pub ice_token: Address, // Base ICE token (SAC)
    pub govern_ice_token: Address, // governICE token (SAC)
    pub upvote_ice_token: Address, // upvoteICE token (SAC)
    pub downvote_ice_token: Address, // downvoteICE token (SAC)
    pub period_unit_minutes: u64, // Staking period unit in minutes
    // Vault settings
    pub vault_treasury: Address, // Treasury for vault fees (15% on-chain; POL gets extra cut in backend)
    pub vault_fee_bps: u32, // Vault fee in basis points (1500 = 15% on-chain; POL adds 17.65% extra in backend → effective 30%)
    // Cooldown settings (v1.2.0)
    pub unstake_cooldown_seconds: u64,      // Default: 864000 (10 days)
    pub claim_reward_cooldown_seconds: u64, // Default: 604800 (7 days)
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IceTokens {
    pub ice_token: Address,           // Base ICE token (SAC)
    pub govern_ice_token: Address,    // governICE token (SAC)
    pub upvote_ice_token: Address,    // upvoteICE token (SAC)
    pub downvote_ice_token: Address,  // downvoteICE token (SAC)
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LockEntry {
    pub user: Address,
    pub amount: i128,                // AQUA amount locked in contract
    pub blub_locked: i128,           // BLUB amount locked in staking pool
    pub lock_timestamp: u64,
    pub duration_minutes: u64,       // Lock duration in minutes
    pub unlock_timestamp: u64,       // Calculated unlock time
    pub reward_multiplier: i128,
    pub tx_hash: Bytes,
    pub pol_contributed: i128, // 10% of locked AQUA that goes to POL
    pub is_blub_stake: bool,   // true if this is a BLUB restake, false if AQUA stake
    pub unlocked: bool,        // true if this entry has been unlocked
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PendingStake {
    pub user: Address,
    pub amount: i128,
    pub duration_minutes: u64,
    pub timestamp: u64,
    pub processed: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LockTotals {
    pub total_locked_aqua: i128,
    pub total_blub_minted: i128,       // Total BLUB minted for this user
    pub total_entries: u32,
    pub last_update_ts: u64,
    pub accumulated_rewards: i128,      // Accumulated BLUB rewards
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UserStakingInfo {
    pub total_staked_blub: i128,       // Total BLUB currently staked/locked
    pub unstaking_available: i128,      // BLUB available to unstake (unlocked positions)
    pub accumulated_rewards: i128,      // Total accumulated BLUB rewards
    pub pending_rewards: i128,          // Pending rewards not yet accumulated
    pub total_locked_entries: u32,      // Number of locked positions
    pub total_unlocked_entries: u32,    // Number of unlocked positions ready to unstake
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LpPosition {
    pub pool_id: Bytes,
    pub total_asset_a: i128,
    pub total_asset_b: i128,
    pub last_tx: Bytes,
    pub last_update_ts: u64,
    pub lp_shares: i128,
    pub reward_debt: i128, // for reward calculation
}

// ============================================================================
// SYNTHETIX-STYLE REWARD SYSTEM (v1.2.0)
// ============================================================================

/// Precision constant for reward calculations (1e12)
/// Used to maintain precision in reward_per_token calculations
pub const REWARD_PRECISION: i128 = 1_000_000_000_000;

/// Global reward state - tracks accumulated rewards for the entire pool
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RewardState {
    pub reward_per_token_stored: i128,
    pub last_update_time: u64,
    pub total_staked: i128,
    pub total_rewards_added: i128,
    pub total_rewards_claimed: i128,
}

/// Per-user reward state - tracks each user's reward accounting
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UserRewardState {
    pub staked_balance: i128,
    pub reward_per_token_paid: i128,
    pub rewards_earned: i128,
    pub last_claim_time: u64,
    pub total_claimed: i128,
}

/// Event emitted when backend adds rewards
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RewardsAddedEvent {
    pub amount: i128,
    pub total_staked: i128,
    pub reward_per_token: i128,
    pub timestamp: u64,
}

/// Event emitted when user claims rewards
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RewardsClaimedEvent {
    pub user: Address,
    pub amount: i128,
    pub total_claimed: i128,
    pub timestamp: u64,
}

/// User reward info for view function
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UserRewardInfo {
    pub pending_rewards: i128,
    pub total_claimed: i128,
    pub staked_balance: i128,
    pub last_claim_time: u64,
    pub can_claim: bool,
    pub claim_available_at: u64,
}

/// Unstake status for a specific lock entry
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UnstakeStatus {
    pub can_unstake: bool,
    pub unstake_available_at: u64,
    pub blub_amount: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UnlockEntry {
    pub amount: i128,
    pub tx_hash: Bytes,
    pub timestamp: u64,
    pub claimed: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BlubRestakeEntry {
    pub amount: i128,
    pub tx_hash: Bytes,
    pub timestamp: u64,
    pub previous_amount: i128, // track restake additions
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UserRewardTotals {
    pub lp_total: i128,
    pub locked_total: i128,
    pub last_update_ts: u64,
    pub pending_lp: i128, // unclaimed LP rewards
    pub pending_locked: i128, // unclaimed locked rewards
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RewardDistribution {
    pub kind: u32,
    pub pool_id: Bytes,
    pub total_reward: i128,
    pub distributed_amount: i128,
    pub treasury_amount: i128,
    pub tx_hash: Bytes,
    pub timestamp: u64,
    pub user_count: u32,
}

// Gas-optimized global state
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GlobalState {
    pub total_locked: i128,
    pub total_blub_supply: i128,         // Total BLUB tokens minted
    pub total_lp_staked: i128,
    pub locked: bool,                     // Re-entrancy guard
    pub total_users: u32,
    pub last_reward_update: u64,
    pub reward_per_locked_token: i128, // accumulated rewards per token (with precision)
    pub reward_per_lp_token: i128, // accumulated rewards per LP token (with precision)
    pub total_blub_rewards_distributed: i128, // Track total BLUB rewards given
    pub lock_counter: u64,                // Counter for generating predictable lock IDs
    // ICE locking (Request 1)
    pub pending_aqua_for_ice: i128,      // AQUA accumulated for ICE locking
    pub ice_balance: i128,                // Base ICE token balance
    pub govern_ice_balance: i128,         // governICE token balance
    pub upvote_ice_balance: i128,         // upvoteICE token balance
    pub downvote_ice_balance: i128,       // downvoteICE token balance
    pub ice_lock_counter: u64,            // Counter for ICE lock authorizations
    // Vault (Request 2)
    pub pool_count: u32,                  // Number of vault pools (max 10)
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProtocolOwnedLiquidity {
    pub total_aqua_contributed: i128, // Total 10% AQUA from all locks
    pub total_blub_contributed: i128, // Total 10% BLUB from all locks
    pub aqua_blub_lp_position: i128, // Total LP tokens held by protocol
    pub total_pol_rewards_earned: i128, // Total rewards earned from POL voting
    pub last_reward_claim: u64,
    pub ice_voting_power_used: i128, // ICE tokens used for voting on AQUA-BLUB pair
}

// ============================================================================
// ICE Locking Structures (Request 1)
// ============================================================================

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IceLockAuthorization {
    pub lock_id: u64,
    pub aqua_amount: i128,
    pub duration_years: u64,
    pub authorized_at: u64,
    pub executed: bool,
}

// ============================================================================
// Vault Structures (Request 2)
// ============================================================================

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PoolInfo {
    pub pool_id: u32,
    pub pool_address: Address, // Aquarius pool contract
    pub token_a: Address,
    pub token_b: Address,
    pub share_token: Address, // LP token address
    pub total_lp_tokens: i128, // Contract's total LP in this pool
    pub active: bool,
    pub added_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UserVaultPosition {
    pub user: Address,
    pub pool_id: u32,
    pub share_ratio: i128, // Vault shares (v1.8.0+). User LP = share_ratio * total_lp / total_shares
    pub deposited_at: u64,
    pub active: bool,
}

/// Tracks cumulative compound stats per vault pool.
/// Stored separately from PoolInfo to preserve upgrade compatibility.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PoolCompoundStats {
    pub total_compounded_lp: i128,      // Total LP minted from compounding
    pub total_rewards_claimed: i128,    // Total AQUA rewards claimed
    pub total_treasury_fees: i128,      // Total AQUA sent to treasury
    pub last_compound_time: u64,        // Timestamp of last compound
    pub compound_count: u32,            // Number of successful compounds
}

// ============================================================================
// Liquidity Pool Integration (AQUA/BLUB AMM Pool)
// ============================================================================

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Config,
    UserLockByTxHash(Address, Bytes),
    UserLocks(Address), // Vector of all lock tx hashes for a user
    UserLpCount(Address),
    UserLpByIndex(Address, u32),
    UserUnlockByTxHash(Address, Bytes),
    UserUnlocks(Address), // Vector of all unlock tx hashes for a user
    UserBlubRestakeByTxHash(Address, Bytes),
    UserBlubRestakes(Address), // Vector of all BLUB restake tx hashes for a user
    LockTotals,
    LpTotals,
    UserRewards(Address),
    DistributionCount,
    DistributionByIndex(u32),
    GlobalState,
    RewardSnapshot(u64),
    ProtocolOwnedLiquidity, // POL tracking
    DailyPolSnapshot(u64), // Daily POL performance snapshots
    UserLockTotals(Address), // User-specific lock totals
    UserPools(Address), // User pool list
    UserLp(Address, Bytes), // User LP position by pool
    PendingStakeCount, // Total pending stakes
    PendingStakeByIndex(u32), // Pending stake by index
    // ICE locking (Request 1)
    IceLockAuth(u64), // ICE lock authorization by ID
    // Vault (Request 2)
    PoolInfo(u32), // Pool info by pool_id
    UserVaultPosition(Address, u32), // User vault position by (user, pool_id)
    // Synthetix-style Reward System (v1.2.0)
    RewardStateV2,                    // Global reward state
    UserRewardStateV2(Address),       // Per-user reward state
    // Stable admin key — NEVER change the format of this entry.
    // It stores just an Address and ensures upgrade() is always callable
    // regardless of Config struct changes.
    AdminAddress,
    // Compound tracking (v1.3.0)
    PoolCompoundStats(u32),           // Cumulative compound stats per pool
    UserDepositedLp(Address, u32),    // User's total deposited LP (excl. compound gains)
    // Multisig / manager split (v1.4.0)
    ManagerAddress,                  // Single-sig backend manager (blub-issuer-v2)
    // Vault share model (v1.8.0) — sum of all user shares per pool
    VaultTotalShares(u32),
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Error {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    Unauthorized = 3,
    InvalidInput = 4,
    NotFound = 5,
    InsufficientBalance = 6,
    RewardCalculationFailed = 7,
    UnlockNotReady = 8,
    AlreadyClaimed = 9,
    ReentrancyDetected = 20,
    // Token Errors
    InsufficientAllowance = 19,
    InvalidPeriod = 21,
    NoUnlockableAmount = 22,
    // ICE Errors
    AlreadyExecuted = 23,
    InsufficientPendingAqua = 24,
    // Vault Errors
    PoolNotActive = 25,
    PoolNotFound = 26,
    MaxPoolsReached = 27,
    PositionNotFound = 28,
    ClaimCooldownActive = 29,
    UnstakeCooldownActive = 30,
    NoRewardsToClaim = 31,
}

impl From<Error> for soroban_sdk::Error {
    fn from(error: Error) -> Self {
        soroban_sdk::Error::from_contract_error(error as u32)
    }
}

impl From<&Error> for soroban_sdk::Error {
    fn from(error: &Error) -> Self {
        soroban_sdk::Error::from_contract_error(error.clone() as u32)
    }
}

impl From<soroban_sdk::Error> for Error {
    fn from(_: soroban_sdk::Error) -> Self {
        Error::InvalidInput
    }
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LockRecordedEvent {
    pub user: Address,
    pub amount: i128,
    pub duration_minutes: u64,
    pub reward_multiplier: i128,
    pub tx_hash: Bytes,
    pub timestamp: u64,
    pub unlock_timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LpDepositRecordedEvent {
    pub user: Address,
    pub pool_id: Bytes,
    pub amount_a: i128,
    pub amount_b: i128,
    pub tx_hash: Bytes,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UnlockRecordedEvent {
    pub user: Address,
    pub amount: i128,
    pub tx_hash: Bytes,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BlubRestakeRecordedEvent {
    pub user: Address,
    pub amount: i128,
    pub tx_hash: Bytes,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RewardDistributionRecordedEvent {
    pub kind: u32,
    pub pool_id: Bytes,
    pub total_reward: i128,
    pub distributed_amount: i128,
    pub treasury_amount: i128,
    pub tx_hash: Bytes,
    pub timestamp: u64,
    pub distribution_index: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UserRewardCreditedEvent {
    pub kind: u32,
    pub user: Address,
    pub pool_id: Bytes,
    pub amount: i128,
    pub tx_hash: Bytes,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PolContributionEvent {
    pub user: Address,
    pub aqua_locked: i128,
    pub pol_aqua_amount: i128, // 10% of locked AQUA
    pub pol_blub_amount: i128, // 10% of minted BLUB
    pub total_pol_aqua: i128,
    pub total_pol_blub: i128,
    pub timestamp: u64,
    pub tx_hash: Bytes,
}

/// Event emitted when tokens are sent to admin for LP deposit
/// Backend should listen for this event and deposit to AQUA/BLUB pool
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PolDepositTriggerEvent {
    pub user: Address,       
    pub aqua_amount: i128,     
    pub blub_amount: i128,    
    pub timestamp: u64,
    pub tx_hash: Bytes,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PolRewardsClaimedEvent {
    pub reward_amount: i128,
    pub ice_voting_power: i128,
    pub total_pol_rewards: i128,
    pub reward_distribution_to_users: i128, // 70% to users
    pub treasury_amount: i128, // 30% to treasury
    pub timestamp: u64,
}

/// Event emitted when AQUA revenue is converted to BLUB rewards
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AquaRewardsConvertedEvent {
    pub aqua_amount: i128,
    pub blub_reward_amount: i128,
    pub total_staked: i128,
    pub reward_per_token: i128,
    pub timestamp: u64,
}

// Gas-optimized batch reward calculation event
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BatchRewardCalculatedEvent {
    pub kind: u32,
    pub total_amount: i128,
    pub user_count: u32,
    pub timestamp: u64,
}

#[contract]
pub struct StakingRegistry;

#[contractimpl]
impl StakingRegistry {
    /// Initializes the staking contract with required configuration.
    ///
    /// # Arguments
    /// * `env` - The contract environment
    /// * `admin` - The administrator address that will have privileged access
    /// * `treasury_address` - Address where treasury fees are sent
    /// * `aqua_token` - Contract address of the AQUA token
    /// * `blub_token` - Contract address of the BLUB token (Stellar asset)
    /// * `liquidity_contract` - Address of the AQUA/BLUB StableSwap pool contract
    /// * `ice_contract` - Address of the ICE locking contract for governance
    ///
    /// # Returns
    /// * `Ok(())` on success
    /// * `Err(Error::AlreadyInitialized)` if contract is already initialized
    ///
    /// # Authorization
    /// Requires authorization from the `admin` address.
    pub fn initialize(
        env: Env,
        admin: Address,
        treasury_address: Address,
        aqua_token: Address,
        blub_token: Address,
        liquidity_contract: Address,
        ice_tokens: IceTokens,
        vault_treasury: Address,
        vault_fee_bps: u32,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Config) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();

        let cfg = Config {
            admin: admin.clone(),
            version: 10200, // v1.2.0
            total_supply: 0,
            treasury_address,
            reward_rate: 100, // 1% per period default
            aqua_token,
            blub_token,
            liquidity_contract,
            ice_token: ice_tokens.ice_token,
            govern_ice_token: ice_tokens.govern_ice_token,
            upvote_ice_token: ice_tokens.upvote_ice_token,
            downvote_ice_token: ice_tokens.downvote_ice_token,
            period_unit_minutes: 1,
            vault_treasury,
            vault_fee_bps,
            // Default cooldowns: 10 days unstake, 7 days claim
            unstake_cooldown_seconds: 864000,      // 10 days
            claim_reward_cooldown_seconds: 604800, // 7 days
        };
        env.storage().instance().set(&DataKey::Config, &cfg);

        // Store admin in a stable, format-independent key so upgrade() always works
        env.storage().instance().set(&DataKey::AdminAddress, &admin);

        // Initialize global state
        let global_state = GlobalState {
            total_locked: 0,
            total_blub_supply: 0,
            total_lp_staked: 0,
            locked: false,
            total_users: 0,
            last_reward_update: env.ledger().timestamp(),
            reward_per_locked_token: 0,
            reward_per_lp_token: 0,
            total_blub_rewards_distributed: 0,
            lock_counter: 0,
            pending_aqua_for_ice: 0,
            ice_balance: 0,
            govern_ice_balance: 0,
            upvote_ice_balance: 0,
            downvote_ice_balance: 0,
            ice_lock_counter: 0,
            pool_count: 0,
        };
        env.storage().instance().set(&DataKey::GlobalState, &global_state);

        // Initialize POL state
        let pol = ProtocolOwnedLiquidity {
            total_aqua_contributed: 0,
            total_blub_contributed: 0,
            aqua_blub_lp_position: 0,
            total_pol_rewards_earned: 0,
            last_reward_claim: 0,
            ice_voting_power_used: 0,
        };
        env.storage().instance().set(&DataKey::ProtocolOwnedLiquidity, &pol);

        // Initialize Synthetix-style reward state (v1.2.0)
        let reward_state = RewardState {
            reward_per_token_stored: 0,
            last_update_time: env.ledger().timestamp(),
            total_staked: 0,
            total_rewards_added: 0,
            total_rewards_claimed: 0,
        };
        env.storage().instance().set(&DataKey::RewardStateV2, &reward_state);

        Ok(())
    }

    /// Retrieves the current contract configuration.
    ///
    /// # Returns
    /// * `Ok(Config)` - The contract configuration
    /// * `Err(Error::NotInitialized)` if contract is not initialized
    pub fn get_config(env: Env) -> Result<Config, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(Error::NotInitialized)
    }

    // Staking/unstaking/restaking logic

    /// Helper function to deposit POL assets to AQUA-BLUB LP pool on Stellar network
    /// Uses the existing StableSwap pool interface
    fn deposit_pol_to_lp(
        env: &Env,
        config: &Config,
        aqua_amount: i128,
        blub_amount: i128,
    ) -> Result<(), Error> {
        if aqua_amount <= 0 || blub_amount <= 0 {
            return Ok(()); // Nothing to deposit
        }
        
        let contract_address = env.current_contract_address();
        
        // Verify balances before attempting deposit
        use soroban_sdk::token;
        let aqua_client = token::Client::new(env, &config.aqua_token);
        let blub_client = token::Client::new(env, &config.blub_token);
        
        let aqua_balance = aqua_client.balance(&contract_address);
        let blub_balance = blub_client.balance(&contract_address);
        
        env.events().publish(
            (symbol_short!("pol_pre"),),
            (aqua_amount, blub_amount, aqua_balance, blub_balance),
        );
        
        if aqua_balance < aqua_amount {
            env.events().publish(
                (symbol_short!("pol_err"),),
                symbol_short!("low_aqua"),
            );
            return Err(Error::InsufficientBalance);
        }
        
        if blub_balance < blub_amount {
            env.events().publish(
                (symbol_short!("pol_err"),),
                symbol_short!("low_blub"),
            );
            return Err(Error::InsufficientBalance);
        }
        
        use soroban_sdk::{IntoVal, Vec as SorobanVec};
        use soroban_sdk::auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation};
        
        // Log what tokens we expect from config
        env.events().publish(
            (symbol_short!("cfg_tok"),),
            (config.aqua_token.clone(), config.blub_token.clone()),
        );
        
        // Get the token order from the pool to ensure we authorize in the correct order
        let pool_tokens_result = env.try_invoke_contract::<SorobanVec<Address>, soroban_sdk::Error>(
            &config.liquidity_contract,
            &soroban_sdk::Symbol::new(env, "get_tokens"),
            ().into_val(env),
        );
        
        let (token_0, token_1, amount_0, amount_1) = match pool_tokens_result {
            Ok(Ok(tokens)) if tokens.len() >= 2 => {
                let t0 = tokens.get(0).unwrap();
                let t1 = tokens.get(1).unwrap();
                
                // Determine which token is which and set amounts accordingly
                let (final_t0, final_t1, final_amt0, final_amt1) = if t0 == config.aqua_token && t1 == config.blub_token {
                    // Pool expects: AQUA first, BLUB second
                    (t0, t1, aqua_amount, blub_amount)
                } else if t0 == config.blub_token && t1 == config.aqua_token {
                    // Pool expects: BLUB first, AQUA second
                    (t0, t1, blub_amount, aqua_amount)
                } else {
                    // Tokens don't match - log warning and use pool order
                    env.events().publish(
                        (symbol_short!("pol_warn"),),
                        symbol_short!("tok_mism"),
                    );
                    // Assume pool order is correct, try AQUA first
                    (t0, t1, aqua_amount, blub_amount)
                };
                
                // Log token order for debugging
                let is_blub_first = final_t0 == config.blub_token;
                env.events().publish(
                    (symbol_short!("tok_ord"),),
                    (final_t0.clone(), final_t1.clone(), final_amt0, final_amt1),
                );
                env.events().publish(
                    (symbol_short!("blub_1st"),),
                    is_blub_first,
                );
                
                (final_t0, final_t1, final_amt0, final_amt1)
            }
            _ => {
                env.events().publish(
                    (symbol_short!("pol_warn"),),
                    symbol_short!("no_tokens"),
                );
                (config.aqua_token.clone(), config.blub_token.clone(), aqua_amount, blub_amount)
            }
        };
        
        let mut amounts = SorobanVec::new(env);
        amounts.push_back(amount_0 as u128);
        amounts.push_back(amount_1 as u128);
        
        let min_shares: u128 = 0;
        
        // Build authorization: The pool will call transfer on each token on our behalf
        let mut auth_entries = SorobanVec::new(env);
        
        // Authorize token 0 transfer (will be called by the pool contract)
        auth_entries.push_back(InvokerContractAuthEntry::Contract(SubContractInvocation {
            context: ContractContext {
                contract: token_0.clone(),
                fn_name: soroban_sdk::symbol_short!("transfer"),
                args: (contract_address.clone(), config.liquidity_contract.clone(), amount_0).into_val(env),
            },
            sub_invocations: SorobanVec::new(env),
        }));
        
        // Authorize token 1 transfer (will be called by the pool contract)
        auth_entries.push_back(InvokerContractAuthEntry::Contract(SubContractInvocation {
            context: ContractContext {
                contract: token_1.clone(),
                fn_name: soroban_sdk::symbol_short!("transfer"),
                args: (contract_address.clone(), config.liquidity_contract.clone(), amount_1).into_val(env),
            },
            sub_invocations: SorobanVec::new(env),
        }));
        
        env.authorize_as_current_contract(auth_entries);
        
        // Call the pool's deposit function
        // deposit(user: address, amounts: vec<u128>, min_shares: u128) -> tuple<vec<u128>,u128>
        // amounts[0] = AQUA, amounts[1] = BLUB (order determined by get_tokens())
        let result = env.try_invoke_contract::<(SorobanVec<u128>, u128), soroban_sdk::Error>(
            &config.liquidity_contract,
            &soroban_sdk::Symbol::new(env, "deposit"),
            (contract_address.clone(), amounts, min_shares).into_val(env),
        );
        
        match result {
            Ok(Ok((_deposited_amounts, lp_shares_minted))) => {
                // Update POL LP position tracking with actual minted shares
                let mut pol = Self::get_pol(env);
                pol.aqua_blub_lp_position = pol.aqua_blub_lp_position.saturating_add(lp_shares_minted as i128);
                env.storage().instance().set(&DataKey::ProtocolOwnedLiquidity, &pol);

                // Emit successful LP deposit event
                env.events().publish(
                    (symbol_short!("pol_lp"),),
                    (aqua_amount, blub_amount, lp_shares_minted as i128),
                );

                Ok(())
            }
            Ok(Err(_)) => {
                env.events().publish(
                    (symbol_short!("pol_err"),),
                    symbol_short!("dep_conv"),
                );
                Err(Error::InvalidInput)
            }
            Err(_) => {
                env.events().publish(
                    (symbol_short!("pol_err"),),
                    symbol_short!("dep_fail"),
                );
                Err(Error::InvalidInput)
            }
        }
    }

    /// Updates the admin for the BLUB Stellar Asset Contract (SAC).
    ///
    /// # Arguments
    /// * `admin` - The current admin address
    /// * `new_admin` - The new admin address to set
    ///
    /// # Returns
    /// * `Ok(())` on success
    /// * `Err(Error::Unauthorized)` if caller is not the admin
    ///
    /// # Authorization
    /// Requires authorization from the current `admin` address.
    pub fn update_sac_admin(env: Env, admin: Address, new_admin: Address) -> Result<(), Error> {
        admin.require_auth();
        
        // Get config and verify admin authorization
        let config = Self::get_config(env.clone())?;
        if config.admin != admin {
            return Err(Error::Unauthorized);
        }

        use soroban_sdk::token;

        let sac_client = token::StellarAssetClient::new(&env, &config.blub_token);
        sac_client.set_admin(&new_admin);
        
        Ok(())
    }

    /// Stake AQUA tokens and automatically mint BLUB tokens for staking.
    ///
    /// This function performs the following operations:
    /// - Transfers AQUA from user to contract
    /// - Mints 1.1x BLUB tokens (110% of AQUA amount)
    /// - Sends 90% of AQUA to ICE contract for governance
    /// - Keeps 10% AQUA for Protocol Owned Liquidity (POL)
    /// - Stakes the equivalent 1x BLUB for rewards
    /// - Automatically deposits 0.1x BLUB + 10% AQUA to LP pool
    ///
    /// # Arguments
    /// * `user` - The address of the user staking tokens
    /// * `amount` - The amount of AQUA tokens to stake
    /// * `duration_periods` - The number of period units to lock tokens (multiplied by period_unit_minutes)
    ///
    /// # Returns
    /// * `Ok(())` - Success
    /// * `Err(Error::InvalidInput)` if amount is <= 0
    /// * `Err(Error::ReentrancyDetected)` if a reentrant call is detected
    /// * `Err(Error::InsufficientBalance)` if user doesn't have enough AQUA
    ///
    /// # Authorization
    /// Requires authorization from the `user` address.
    ///
    /// # State Changes
    /// - Creates a new lock entry for the user
    /// - Updates global state with new locked amounts
    /// - Updates POL contribution tracking
    pub fn lock(
        env: Env,
        user: Address,
        amount: i128,
        duration_periods: u64,
    ) -> Result<(), Error> {
        // ===== CHECKS =====
        user.require_auth();
        
        if amount <= 0 {
            return Err(Error::InvalidInput);
        }
        
        // ===== RE-ENTRANCY GUARD =====
        let mut global_state = Self::get_global_state(env.clone())?;
        if global_state.locked {
            return Err(Error::ReentrancyDetected);
        }
        global_state.locked = true;
        env.storage().instance().set(&DataKey::GlobalState, &global_state);
        
        // Get config - only use whitelisted AQUA token
        let config = Self::get_config(env.clone())?;
        let contract_address = env.current_contract_address();
        let now = env.ledger().timestamp();
        
        // ===== EFFECTS: UPDATE ALL STATE FIRST =====
        
        // Calculate duration in minutes
        let duration_minutes = duration_periods * config.period_unit_minutes;
        let unlock_timestamp = now + (duration_minutes * 60);

        let pol_aqua = amount / 10;                // 10% AQUA for POL
        let ice_aqua = amount - pol_aqua;          // 90% AQUA to ICE for governance
        
        let reward_multiplier = Self::calculate_lock_multiplier(duration_minutes);
        
        // Increment lock counter and create predictable lock ID
        let lock_id = global_state.lock_counter;
        global_state.lock_counter = global_state.lock_counter.saturating_add(1);
        let lock_id_array = lock_id.to_be_bytes();
        let tx_hash_bytes = Bytes::from_array(&env, &lock_id_array);
        
        // Calculate BLUB amounts: mint 1.1x AQUA, stake 1x, LP gets 0.1x
        let blub_minted = (amount * 11) / 10;      // 1.1x AQUA amount
        let blub_staked = amount;                   // 1x AQUA amount staked
        let blub_to_lp = blub_minted - blub_staked; // 0.1x AQUA amount to LP
        
        // Create and store lock entry before external calls
        let lock = LockEntry {
            user: user.clone(),
            amount,                             // Full AQUA amount (for tracking)
            blub_locked: blub_staked,           // BLUB amount locked for staking
            lock_timestamp: now,
            duration_minutes,
            unlock_timestamp,
            reward_multiplier,
            tx_hash: tx_hash_bytes.clone(),
            pol_contributed: pol_aqua,          // Track 10% AQUA to POL
            is_blub_stake: false,
            unlocked: false,                    // Initially locked
        };
        env.storage().persistent().set(&DataKey::UserLockByTxHash(user.clone(), tx_hash_bytes.clone()), &lock);
        
        // Add tx_hash to user's locks list
        let mut user_locks: Vec<Bytes> = env
            .storage()
            .persistent()
            .get(&DataKey::UserLocks(user.clone()))
            .unwrap_or(Vec::new(&env));
        user_locks.push_back(tx_hash_bytes.clone());
        env.storage().persistent().set(&DataKey::UserLocks(user.clone()), &user_locks);
        
        // Update global lock totals with both AQUA and BLUB
        Self::update_lock_totals_with_blub(&env, amount, blub_staked, reward_multiplier)?;

        // Update per-user lock totals
        let mut user_totals: LockTotals = env
            .storage()
            .persistent()
            .get(&DataKey::UserLockTotals(user.clone()))
            .unwrap_or(LockTotals {
                total_locked_aqua: 0,
                total_blub_minted: 0,
                total_entries: 0,
                last_update_ts: 0,
                accumulated_rewards: 0,
            });
        user_totals.total_locked_aqua = user_totals.total_locked_aqua.saturating_add(amount);
        user_totals.total_blub_minted = user_totals.total_blub_minted.saturating_add(blub_staked);
        user_totals.total_entries = user_totals.total_entries.saturating_add(1);
        user_totals.last_update_ts = now;
        env.storage().persistent().set(&DataKey::UserLockTotals(user.clone()), &user_totals);

        // Update POL contribution with both AQUA and BLUB
        Self::update_pol_contribution(&env, pol_aqua, blub_to_lp)?;
        
        // Update global state (but keep locked=true until end)
        global_state.total_locked = global_state.total_locked.saturating_add(amount);
        global_state.total_blub_supply = global_state.total_blub_supply.saturating_add(blub_minted);
        global_state.last_reward_update = now;
        env.storage().instance().set(&DataKey::GlobalState, &global_state);
        
        // ===== INTERACTIONS: EXTERNAL CALLS LAST =====
        
        use soroban_sdk::token;

        let blub_client = token::StellarAssetClient::new(&env, &config.blub_token);
        blub_client.mint(&contract_address, &blub_minted);
        // EXTERNAL CALL #1: Transfer AQUA from user to contract (MUST BE FIRST!)
        let aqua_client = token::Client::new(&env, &config.aqua_token);
        
        // Try the transfer and handle errors properly
        let transfer_result = aqua_client.try_transfer(&user, &contract_address, &amount);
        if transfer_result.is_err() {
            // Release lock before returning error
            global_state.locked = false;
            env.storage().instance().set(&DataKey::GlobalState, &global_state);
            return Err(Error::InsufficientBalance);
        }
        
        // CHANGED: Keep 90% AQUA in contract for ICE locking (Request 1)
        // Track as pending instead of sending to ICE contract
        global_state.pending_aqua_for_ice = global_state.pending_aqua_for_ice.saturating_add(ice_aqua);

        // ===== SEND 10% AQUA + 0.1x BLUB TO MANAGER WALLET =====
        // Manager (blub-issuer-v2) will deposit these to AQUA/BLUB pool to get ICE boost.
        // NOTE: Send to manager (single-sig backend), NOT config.admin (multisig cold wallet),
        // so the backend can auto-deposit without requiring 2-of-3 signatures.
        if pol_aqua > 0 && blub_to_lp > 0 {
            // Resolve manager address (falls back to admin if ManagerAddress not set)
            let pol_recipient = env.storage()
                .instance()
                .get::<DataKey, Address>(&DataKey::ManagerAddress)
                .unwrap_or_else(|| config.admin.clone());

            // Transfer AQUA to manager wallet
            let transfer_aqua_result = aqua_client.try_transfer(&contract_address, &pol_recipient, &pol_aqua);
            if transfer_aqua_result.is_err() {
                global_state.locked = false;
                env.storage().instance().set(&DataKey::GlobalState, &global_state);
                env.events().publish(
                    (symbol_short!("pol_err"),),
                    symbol_short!("aqua_xfr"),
                );
                return Err(Error::InsufficientBalance);
            }

            // Transfer BLUB to manager wallet
            let blub_client = token::Client::new(&env, &config.blub_token);
            let transfer_blub_result = blub_client.try_transfer(&contract_address, &pol_recipient, &blub_to_lp);
            if transfer_blub_result.is_err() {
                global_state.locked = false;
                env.storage().instance().set(&DataKey::GlobalState, &global_state);
                env.events().publish(
                    (symbol_short!("pol_err"),),
                    symbol_short!("blub_xfr"),
                );
                return Err(Error::InsufficientBalance);
            }

            // Emit event for backend to deposit to AQUA/BLUB pool
            let pol_trigger_event = PolDepositTriggerEvent {
                user: user.clone(),
                aqua_amount: pol_aqua,
                blub_amount: blub_to_lp,
                timestamp: now,
                tx_hash: tx_hash_bytes.clone(),
            };
            env.events().publish((symbol_short!("pol_dep"),), pol_trigger_event);
        }

        // ===== RELEASE RE-ENTRANCY LOCK =====
        global_state.locked = false;
        env.storage().instance().set(&DataKey::GlobalState, &global_state);

        // ===== EMIT EVENTS (safe, after all operations) =====

        // Emit ICE transfer event (90% AQUA to governance)
        env.events().publish(
            (symbol_short!("ice_xfer"), user.clone()),
            ice_aqua,
        );

        // Emit lock event
        let event = LockRecordedEvent {
            user: user.clone(),
            amount,
            duration_minutes,
            reward_multiplier,
            tx_hash: tx_hash_bytes.clone(),
            timestamp: now,
            unlock_timestamp,
        };
        env.events().publish((symbol_short!("lock"),), event);

        // Emit BLUB staking event
        env.events().publish(
            (symbol_short!("blub_stk"), user.clone()),
            (blub_minted, blub_staked, blub_to_lp),
        );
        // Checkpoint and update user's staked balance for reward tracking
        let new_total_staked = Self::get_user_total_staked_blub(&env, &user);
        Self::sync_user_reward_balance(&env, &user, new_total_staked);

        Ok(())
    }


    fn create_blub_stake_entry(
        env: &Env,
        user: Address,
        amount: i128,
        duration_minutes: u64,
        timestamp: u64,
        lock_id: u64,
    ) -> Result<(), Error> {
        let unlock_timestamp = timestamp + (duration_minutes * 60);
        let reward_multiplier = Self::calculate_lock_multiplier(duration_minutes);
        
        // Create lock ID from provided counter
        let lock_id_array = lock_id.to_be_bytes();
        let tx_hash_bytes = Bytes::from_array(env, &lock_id_array);

        // Create BLUB stake lock entry
        let blub_lock = LockEntry {
            user: user.clone(),
            amount: 0,
            blub_locked: amount,
            lock_timestamp: timestamp,
            duration_minutes,
            unlock_timestamp,
            reward_multiplier,
            tx_hash: tx_hash_bytes.clone(),
            pol_contributed: 0,
            is_blub_stake: true,
            unlocked: false,
        };

        env.storage()
            .persistent()
            .set(&DataKey::UserLockByTxHash(user.clone(), tx_hash_bytes.clone()), &blub_lock);

        // Add tx_hash to user's locks list
        let mut user_locks: Vec<Bytes> = env
            .storage()
            .persistent()
            .get(&DataKey::UserLocks(user.clone()))
            .unwrap_or(Vec::new(env));
        user_locks.push_back(tx_hash_bytes.clone());
        env.storage().persistent().set(&DataKey::UserLocks(user.clone()), &user_locks);

        Self::update_lock_totals_with_blub(env, 0, amount, reward_multiplier)?;

        let mut global_state = Self::get_global_state(env.clone())?;
        global_state.last_reward_update = env.ledger().timestamp();
        env.storage().instance().set(&DataKey::GlobalState, &global_state);

        Ok(())
    }

    /// Records a lock entry for tracking purposes without performing token transfers.
    ///
    /// This function only records metadata about a lock that occurred elsewhere.
    /// Useful for tracking locks that happened on a different chain or contract.
    ///
    /// # Arguments
    /// * `user` - The address of the user whose lock is being recorded
    /// * `amount` - The amount of tokens locked
    /// * `duration_periods` - The number of period units for the lock
    /// * `tx_hash` - The transaction hash from the external lock
    ///
    /// # Returns
    /// * `Ok(())` - Success
    /// * `Err(Error::InvalidInput)` if amount is <= 0
    /// * `Err(Error::ReentrancyDetected)` if a reentrant call is detected
    ///
    /// # Authorization
    /// Requires authorization from the `user` address.
    pub fn record_lock(
        env: Env,
        user: Address,
        amount: i128,
        duration_periods: u64,
        tx_hash: Bytes,
    ) -> Result<(), Error> {
        user.require_auth();

        if amount <= 0 {
            return Err(Error::InvalidInput);
        }

        let mut global_state = Self::get_global_state(env.clone())?;
        if global_state.locked {
            return Err(Error::ReentrancyDetected);
        }
        global_state.locked = true;
        env.storage().instance().set(&DataKey::GlobalState, &global_state);

        let config = Self::get_config(env.clone())?;
        let now = env.ledger().timestamp();

        let duration_minutes = duration_periods * config.period_unit_minutes;
        let unlock_timestamp = now + (duration_minutes * 60);

        let reward_multiplier = Self::calculate_lock_multiplier(duration_minutes);
        
        let pol_contribution = amount / 10;

        // Create lock record with POL tracking
        let lock = LockEntry {
            user: user.clone(),
            amount,
            blub_locked: amount,
            lock_timestamp: now,
            duration_minutes,
            unlock_timestamp,
            reward_multiplier,
            tx_hash: tx_hash.clone(),
            pol_contributed: pol_contribution,
            is_blub_stake: false,
            unlocked: false,
        };

        env.storage()
            .persistent()
            .set(&DataKey::UserLockByTxHash(user.clone(), tx_hash.clone()), &lock);

        // Add tx_hash to user's locks list
        let mut user_locks: Vec<Bytes> = env
            .storage()
            .persistent()
            .get(&DataKey::UserLocks(user.clone()))
            .unwrap_or(Vec::new(&env));
        user_locks.push_back(tx_hash.clone());
        env.storage().persistent().set(&DataKey::UserLocks(user.clone()), &user_locks);

        Self::update_lock_totals(&env, amount, reward_multiplier)?;

        // Update per-user lock totals
        let mut user_totals: LockTotals = env
            .storage()
            .persistent()
            .get(&DataKey::UserLockTotals(user.clone()))
            .unwrap_or(LockTotals {
                total_locked_aqua: 0,
                total_blub_minted: 0,
                total_entries: 0,
                last_update_ts: 0,
                accumulated_rewards: 0,
            });
        user_totals.total_locked_aqua = user_totals.total_locked_aqua.saturating_add(amount);
        user_totals.total_blub_minted = user_totals.total_blub_minted.saturating_add(amount);
        user_totals.total_entries = user_totals.total_entries.saturating_add(1);
        user_totals.last_update_ts = now;
        env.storage().persistent().set(&DataKey::UserLockTotals(user.clone()), &user_totals);

        Self::update_pol_contribution(&env, pol_contribution, pol_contribution)?;

        // Update global state directly on local variable (avoid helper overwrite bug)
        global_state.total_locked = global_state.total_locked.saturating_add(amount);
        global_state.last_reward_update = env.ledger().timestamp();

        // Emit POL contribution event
        let pol = Self::get_pol(&env);
        let pol_event = PolContributionEvent {
            user: user.clone(),
            aqua_locked: amount,
            pol_aqua_amount: pol_contribution,
            pol_blub_amount: pol_contribution,
            total_pol_aqua: pol.total_aqua_contributed,
            total_pol_blub: pol.total_blub_contributed,
            timestamp: now,
            tx_hash: tx_hash.clone(),
        };
        env.events().publish((symbol_short!("pol"),), pol_event);

        // ===== RELEASE RE-ENTRANCY LOCK =====
        global_state.locked = false;
        env.storage().instance().set(&DataKey::GlobalState, &global_state);

        let event = LockRecordedEvent {
            user: user.clone(),
            amount,
            duration_minutes,
            reward_multiplier,
            tx_hash,
            timestamp: now,
            unlock_timestamp,
        };
        env.events().publish((symbol_short!("lock"),), event);

        Ok(())
    }

    /// Records an unlock event and transfers locked BLUB plus rewards to the user.
    ///
    /// # Arguments
    /// * `user` - The address of the user unlocking tokens
    /// * `amount` - The amount of tokens to unlock
    /// * `tx_hash` - The transaction hash for tracking
    ///
    /// # Returns
    /// * `Ok(())` - Success
    /// * `Err(Error::InvalidInput)` if amount is <= 0
    /// * `Err(Error::ReentrancyDetected)` if a reentrant call is detected
    /// * `Err(Error::InsufficientBalance)` if contract doesn't have enough BLUB
    ///
    /// # Authorization
    /// Requires authorization from the `user` address.
    ///
    /// # State Changes
    /// - Creates a new unlock entry
    /// - Updates user lock totals
    /// - Updates global state
    /// - Transfers BLUB tokens and accumulated rewards to user
    pub fn record_unlock(env: Env, user: Address, amount: i128, tx_hash: Bytes) -> Result<(), Error> {
        user.require_auth();
        if amount <= 0 { return Err(Error::InvalidInput); }

        // ===== RE-ENTRANCY GUARD =====
        let mut global_state = Self::get_global_state(env.clone())?;
        if global_state.locked {
            return Err(Error::ReentrancyDetected);
        }
        global_state.locked = true;
        env.storage().instance().set(&DataKey::GlobalState, &global_state);

        let config = Self::get_config(env.clone())?;
        let contract_address = env.current_contract_address();

        let now = env.ledger().timestamp();

        let blub_locked = amount;

        // Update global state directly on local variable (avoid helper overwrite bug)
        global_state.total_locked = global_state.total_locked.saturating_sub(amount).max(0);
        global_state.total_blub_supply = global_state.total_blub_supply.saturating_sub(blub_locked).max(0);
        global_state.last_reward_update = env.ledger().timestamp();

        let entry = UnlockEntry {
            amount,
            tx_hash: tx_hash.clone(),
            timestamp: now,
            claimed: false,
        };
        env.storage().persistent().set(&DataKey::UserUnlockByTxHash(user.clone(), tx_hash.clone()), &entry);

        // Add tx_hash to user's unlocks list
        let mut user_unlocks: Vec<Bytes> = env
            .storage()
            .persistent()
            .get(&DataKey::UserUnlocks(user.clone()))
            .unwrap_or(Vec::new(&env));
        user_unlocks.push_back(tx_hash.clone());
        env.storage().persistent().set(&DataKey::UserUnlocks(user.clone()), &user_unlocks);

        // Update per-user lock totals
        let mut totals: LockTotals = env
            .storage()
            .persistent()
            .get(&DataKey::UserLockTotals(user.clone()))
            .unwrap_or(LockTotals {
                total_locked_aqua: 0,
                total_blub_minted: 0,
                total_entries: 0,
                last_update_ts: 0,
                accumulated_rewards: 0,
            });

        // Transfer LOCKED BLUB from contract to user's wallet
        // Rewards are claimed separately via claim_rewards() (Synthetix system)
        if blub_locked > 0 {
            use soroban_sdk::token;
            let blub_client = token::Client::new(&env, &config.blub_token);
            let transfer_result = blub_client.try_transfer(&contract_address, &user, &blub_locked);
            if transfer_result.is_err() {
                global_state.locked = false;
                env.storage().instance().set(&DataKey::GlobalState, &global_state);
                return Err(Error::InsufficientBalance);
            }
        }

        // Update user totals
        totals.total_locked_aqua = totals.total_locked_aqua.saturating_sub(amount).max(0);
        totals.total_blub_minted = totals.total_blub_minted.saturating_sub(blub_locked).max(0);
        totals.last_update_ts = now;
        env.storage().persistent().set(&DataKey::UserLockTotals(user.clone()), &totals);

        // ===== RELEASE RE-ENTRANCY LOCK =====
        global_state.locked = false;
        env.storage().instance().set(&DataKey::GlobalState, &global_state);

        let evt = UnlockRecordedEvent { 
            user: user.clone(), 
            amount, 
            tx_hash, 
            timestamp: now, 
        };
        env.events().publish((symbol_short!("unlock"),), evt);

        Ok(())
    }

    /// Restake BLUB tokens to earn more BLUB rewards.
    ///
    /// Allows users to stake their BLUB tokens (obtained from previous stakes or rewards)
    /// to earn additional BLUB rewards.
    ///
    /// # Arguments
    /// * `user` - The address of the user staking BLUB
    /// * `amount` - The amount of BLUB tokens to stake
    /// * `duration_periods` - The number of period units to lock tokens
    ///
    /// # Returns
    /// * `Ok(())` - Success
    /// * `Err(Error::InvalidInput)` if amount is <= 0
    /// * `Err(Error::ReentrancyDetected)` if a reentrant call is detected
    /// * `Err(Error::InsufficientBalance)` if user doesn't have enough BLUB
    ///
    /// # Authorization
    /// Requires authorization from the `user` address.
    ///
    /// # State Changes
    /// - Creates a new BLUB lock entry
    /// - Updates lock totals
    /// - Updates global state:
    /// - Transfers BLUB from user to contract
    pub fn stake(
        env: Env,
        user: Address,
        amount: i128,
        duration_periods: u64,
    ) -> Result<(), Error> {
        user.require_auth();
        
        if amount <= 0 {
            return Err(Error::InvalidInput);
        }

        // ===== RE-ENTRANCY GUARD =====
        let mut global_state = Self::get_global_state(env.clone())?;
        if global_state.locked {
            return Err(Error::ReentrancyDetected);
        }
        global_state.locked = true;
        env.storage().instance().set(&DataKey::GlobalState, &global_state);

        let config = Self::get_config(env.clone())?;
        let contract_address = env.current_contract_address();
        let now = env.ledger().timestamp();
        
        let duration_minutes = duration_periods * config.period_unit_minutes;
        let unlock_timestamp = now + (duration_minutes * 60);
        let reward_multiplier = Self::calculate_lock_multiplier(duration_minutes);
        
        // ===== EFFECTS: UPDATE ALL STATE FIRST =====
        
        // Increment lock counter and create predictable lock ID
        let lock_id = global_state.lock_counter;
        global_state.lock_counter = global_state.lock_counter.saturating_add(1);
        let lock_id_array = lock_id.to_be_bytes();
        let tx_hash_bytes = Bytes::from_array(&env, &lock_id_array);

        // Create lock record for BLUB restaking
        let lock = LockEntry {
            user: user.clone(),
            amount: 0,
            blub_locked: amount,
            lock_timestamp: now,
            duration_minutes,
            unlock_timestamp,
            reward_multiplier,
            tx_hash: tx_hash_bytes.clone(),
            pol_contributed: 0,
            is_blub_stake: true,
            unlocked: false,
        };

        env.storage()
            .persistent()
            .set(&DataKey::UserLockByTxHash(user.clone(), tx_hash_bytes.clone()), &lock);
        
        // Add tx_hash to user's locks list
        let mut user_locks: Vec<Bytes> = env
            .storage()
            .persistent()
            .get(&DataKey::UserLocks(user.clone()))
            .unwrap_or(Vec::new(&env));
        user_locks.push_back(tx_hash_bytes.clone());
        env.storage().persistent().set(&DataKey::UserLocks(user.clone()), &user_locks);

        Self::update_lock_totals_with_blub(&env, 0, amount, reward_multiplier)?;

        // Update per-user lock totals
        let mut user_totals: LockTotals = env
            .storage()
            .persistent()
            .get(&DataKey::UserLockTotals(user.clone()))
            .unwrap_or(LockTotals {
                total_locked_aqua: 0,
                total_blub_minted: 0,
                total_entries: 0,
                last_update_ts: 0,
                accumulated_rewards: 0,
            });
        user_totals.total_blub_minted = user_totals.total_blub_minted.saturating_add(amount);
        user_totals.total_entries = user_totals.total_entries.saturating_add(1);
        user_totals.last_update_ts = now;
        env.storage().persistent().set(&DataKey::UserLockTotals(user.clone()), &user_totals);

        // Update global state directly on local variable (avoid helper overwrite bug)
        global_state.total_blub_supply = global_state.total_blub_supply.saturating_add(amount);
        global_state.last_reward_update = env.ledger().timestamp();

        // ===== INTERACTIONS: TRANSFER BLUB LAST =====

        use soroban_sdk::token;
        let blub_client = token::Client::new(&env, &config.blub_token);
        let transfer_result = blub_client.try_transfer(&user, &contract_address, &amount);
        if transfer_result.is_err() {
            global_state.locked = false;
            env.storage().instance().set(&DataKey::GlobalState, &global_state);
            return Err(Error::InsufficientBalance);
        }

        // ===== RELEASE RE-ENTRANCY LOCK =====
        global_state.locked = false;
        env.storage().instance().set(&DataKey::GlobalState, &global_state);

        env.events().publish(
            (symbol_short!("blub_stk"), user.clone()),
            amount,
        );

        // ===== SYNC REWARD BALANCE (v1.2.0) =====
        let new_total_staked = Self::get_user_total_staked_blub(&env, &user);
        Self::sync_user_reward_balance(&env, &user, new_total_staked);

        Ok(())
    }

    /// Records a BLUB restake entry for tracking purposes.
    ///
    /// # Arguments
    /// * `user` - The address of the user restaking BLUB
    /// * `amount` - The amount of BLUB being restaked
    /// * `tx_hash` - The transaction hash for tracking
    ///
    /// # Returns
    /// * `Ok(())` - Success
    /// * `Err(Error::InvalidInput)` if amount is <= 0
    /// * `Err(Error::ReentrancyDetected)` if a reentrant call is detected
    ///
    /// # Authorization
    /// Requires authorization from the `user` address.
    pub fn record_blub_restake(env: Env, user: Address, amount: i128, tx_hash: Bytes) -> Result<(), Error> {
        user.require_auth();
        if amount <= 0 { return Err(Error::InvalidInput); }

        // ===== RE-ENTRANCY GUARD =====
        let mut global_state = Self::get_global_state(env.clone())?;
        if global_state.locked {
            return Err(Error::ReentrancyDetected);
        }
        global_state.locked = true;
        env.storage().instance().set(&DataKey::GlobalState, &global_state);

        let now = env.ledger().timestamp();

        let previous_amount = {
            let user_restakes: Vec<Bytes> = env
                .storage()
                .persistent()
                .get(&DataKey::UserBlubRestakes(user.clone()))
                .unwrap_or(Vec::new(&env));
            
            if let Some(last_tx_hash) = user_restakes.last() {
                env.storage()
                    .persistent()
                    .get::<DataKey, BlubRestakeEntry>(&DataKey::UserBlubRestakeByTxHash(user.clone(), last_tx_hash))
                    .map(|entry| entry.amount)
                    .unwrap_or(0)
            } else {
                0
            }
        };

        let entry = BlubRestakeEntry { 
            amount, 
            tx_hash: tx_hash.clone(), 
            timestamp: now,
            previous_amount,
        };
        env.storage().persistent().set(&DataKey::UserBlubRestakeByTxHash(user.clone(), tx_hash.clone()), &entry);
        
        // Add tx_hash to user's BLUB restakes list
        let mut user_restakes: Vec<Bytes> = env
            .storage()
            .persistent()
            .get(&DataKey::UserBlubRestakes(user.clone()))
            .unwrap_or(Vec::new(&env));
        user_restakes.push_back(tx_hash.clone());
        env.storage().persistent().set(&DataKey::UserBlubRestakes(user.clone()), &user_restakes);

        // ===== RELEASE RE-ENTRANCY LOCK =====
        global_state.locked = false;
        env.storage().instance().set(&DataKey::GlobalState, &global_state);

        let evt = BlubRestakeRecordedEvent { 
            user: user.clone(),
            amount, 
            tx_hash, 
            timestamp: now, 
        };
        env.events().publish((symbol_short!("rstk"),), evt);

        Ok(())
    }

    /// Records an LP (Liquidity Pool) deposit for a user.
    ///
    /// # Arguments
    /// * `admin` - The admin address authorizing this operation
    /// * `user` - The address of the user depositing liquidity
    /// * `pool_id` - The unique identifier of the liquidity pool
    /// * `amount_a` - The amount of token A deposited
    /// * `amount_b` - The amount of token B deposited
    /// * `tx_hash` - The transaction hash for tracking
    ///
    /// # Returns
    /// * `Ok(())` on success
    /// * `Err(Error::Unauthorized)` if caller is not the admin
    /// * `Err(Error::InvalidInput)` if amounts are negative
    ///
    /// # Authorization
    /// Requires authorization from the `admin` address.
    ///
    /// # State Changes
    /// - Updates or creates LP position for user
    /// - Updates global LP staked amount
    /// - Calculates and credits any pending LP rewards
    pub fn record_lp_deposit(
        env: Env,
        manager: Address,
        user: Address,
        pool_id: Bytes,
        amount_a: i128,
        amount_b: i128,
        tx_hash: Bytes,
    ) -> Result<(), Error> {
        Self::require_manager_auth(&env, &manager)?;
        if amount_a < 0 || amount_b < 0 { return Err(Error::InvalidInput); }

        let now = env.ledger().timestamp();

        let lp_shares = Self::calculate_lp_shares(amount_a, amount_b);

        Self::update_global_state(&env, 0, lp_shares, true)?;

        let mut pools: Vec<Bytes> = env
            .storage()
            .persistent()
            .get(&DataKey::UserPools(user.clone()))
            .unwrap_or(Vec::new(&env));
        let mut found = false;
        for existing in pools.iter() {
            if existing == pool_id {
                found = true;
                break;
            }
        }
        if !found {
            pools.push_back(pool_id.clone());
            env.storage().persistent().set(&DataKey::UserPools(user.clone()), &pools);
        }

        let mut pos: LpPosition = env
            .storage()
            .persistent()
            .get(&DataKey::UserLp(user.clone(), pool_id.clone()))
            .unwrap_or(LpPosition {
                pool_id: pool_id.clone(),
                total_asset_a: 0,
                total_asset_b: 0,
                last_tx: Bytes::new(&env),
                last_update_ts: 0,
                lp_shares: 0,
                reward_debt: 0,
            });

        // Calculate pending LP rewards before update
        let global_state = Self::get_global_state(env.clone())?;
        let pending_lp_rewards = pos.lp_shares.saturating_mul(global_state.reward_per_lp_token) / 1_000_000 - pos.reward_debt;

        pos.total_asset_a = pos.total_asset_a.saturating_add(amount_a);
        pos.total_asset_b = pos.total_asset_b.saturating_add(amount_b);
        pos.lp_shares = pos.lp_shares.saturating_add(lp_shares);
        pos.last_tx = tx_hash.clone();
        pos.last_update_ts = now;
        pos.reward_debt = pos.lp_shares.saturating_mul(global_state.reward_per_lp_token) / 1_000_000;

        env.storage()
            .persistent()
            .set(&DataKey::UserLp(user.clone(), pool_id.clone()), &pos);

        // Update user rewards if there were pending rewards
        if pending_lp_rewards > 0 {
            Self::update_user_reward_totals(&env, &user, pending_lp_rewards, 0, now)?;
        }

        let evt = LpDepositRecordedEvent {
            user: user.clone(),
            pool_id,
            amount_a,
            amount_b,
            tx_hash,
            timestamp: now,
        };
        env.events().publish((symbol_short!("lpdep"),), evt);

        Ok(())
    }

    // Reward calculation and distribution functions

    /// Calculates the total rewards for a user from both locked stakes and LP positions.
    ///
    /// # Arguments
    /// * `user` - The address of the user to calculate rewards for
    ///
    /// # Returns
    /// * `Ok(UserRewardTotals)` - The user's reward totals including pending and accumulated rewards
    /// * `Err(Error)` if calculation fails
    ///
    /// # Note
    /// This is a view function that doesn't modify state. It calculates:
    /// - Pending rewards from locked stakes (based on time elapsed and multipliers)
    /// - Pending rewards from LP positions (based on global reward rates)
    pub fn calculate_user_rewards(env: Env, user: Address) -> Result<UserRewardTotals, Error> {
        let now = env.ledger().timestamp();
        
        // Get current totals
        let mut totals: UserRewardTotals = env
            .storage()
            .persistent()
            .get(&DataKey::UserRewards(user.clone()))
            .unwrap_or(UserRewardTotals { 
                lp_total: 0, 
                locked_total: 0, 
                last_update_ts: 0,
                pending_lp: 0,
                pending_locked: 0,
            });

        // Calculate locked rewards using Synthetix system (v1.2.0)
        let reward_state = Self::get_reward_state(&env);
        let user_reward_state = Self::get_user_reward_state(&env, &user);
        let pending_locked_rewards = Self::calculate_user_pending_rewards(&reward_state, &user_reward_state);
        totals.pending_locked = pending_locked_rewards;

        // Calculate LP rewards for all pools
        let pools: Vec<Bytes> = env
            .storage()
            .persistent()
            .get(&DataKey::UserPools(user.clone()))
            .unwrap_or(Vec::new(&env));

        let mut total_pending_lp = 0i128;
        let global_state = Self::get_global_state(env.clone())?;

        for pool_id in pools.iter() {
            if let Some(pos) = env.storage().persistent().get::<DataKey, LpPosition>(&DataKey::UserLp(user.clone(), pool_id.clone())) {
                let pending_pool_rewards = pos.lp_shares.saturating_mul(global_state.reward_per_lp_token) / 1_000_000 - pos.reward_debt;
                total_pending_lp = total_pending_lp.saturating_add(pending_pool_rewards);
            }
        }

        totals.pending_lp = totals.lp_total.saturating_add(total_pending_lp);
        totals.last_update_ts = now;

        Ok(totals)
    }

    /// Records a reward distribution event.
    ///
    /// # Arguments
    /// * `admin` - The admin address authorizing this operation
    /// * `kind` - The type of reward distribution (0 = LP rewards, 1 = locked rewards)
    /// * `pool_id` - The pool identifier (if applicable)
    /// * `total_reward` - The total amount of rewards distributed
    /// * `distributed_amount` - The amount distributed to users
    /// * `treasury_amount` - The amount sent to treasury
    /// * `tx_hash` - The transaction hash for tracking
    ///
    /// # Returns
    /// * `Ok(u32)` - The index of the distribution record
    /// * `Err(Error::Unauthorized)` if caller is not the admin
    /// * `Err(Error::InvalidInput)` if amounts are negative
    ///
    /// # Authorization
    /// Requires authorization from the `admin` address.
    ///
    /// # State Changes
    /// - Updates global reward rates for future calculations
    /// - Creates a new distribution record
    /// - Emits batch reward calculation event
    pub fn record_reward_distribution(
        env: Env,
        manager: Address,
        kind: u32,
        pool_id: Bytes,
        total_reward: i128,
        distributed_amount: i128,
        treasury_amount: i128,
        tx_hash: Bytes,
    ) -> Result<u32, Error> {
        Self::require_manager_auth(&env, &manager)?;
        if total_reward < 0 || distributed_amount < 0 || treasury_amount < 0 { 
            return Err(Error::InvalidInput); 
        }

        let now = env.ledger().timestamp();

        // Update global reward rates for gas-efficient future calculations
        Self::update_reward_rates(&env, kind, distributed_amount)?;

        let mut dcount: u32 = env.storage().instance().get(&DataKey::DistributionCount).unwrap_or(0);
        let idx = dcount;
        dcount = dcount.saturating_add(1);
        env.storage().instance().set(&DataKey::DistributionCount, &dcount);

        let global_state = Self::get_global_state(env.clone())?;
        let estimated_users = if kind == 0 { 
            global_state.total_users / 2
        } else { 
            global_state.total_users 
        };

        let dist = RewardDistribution {
            kind,
            pool_id: pool_id.clone(),
            total_reward,
            distributed_amount,
            treasury_amount,
            tx_hash: tx_hash.clone(),
            timestamp: now,
            user_count: estimated_users,
        };
        env.storage().instance().set(&DataKey::DistributionByIndex(idx), &dist);

        let evt = RewardDistributionRecordedEvent {
            kind,
            pool_id,
            total_reward,
            distributed_amount,
            treasury_amount,
            tx_hash,
            timestamp: now,
            distribution_index: idx,
        };
        env.events().publish((symbol_short!("dist"),), evt);

        // Emit batch calculation event for gas tracking
        let batch_evt = BatchRewardCalculatedEvent {
            kind,
            total_amount: distributed_amount,
            user_count: estimated_users,
            timestamp: now,
        };
        env.events().publish((symbol_short!("batch"),), batch_evt);

        Ok(idx)
    }

    /// Credits a reward amount to a specific user.
    ///
    /// # Arguments
    /// * `admin` - The admin address authorizing this operation
    /// * `kind` - The type of reward (0 = LP rewards, 1 = locked rewards)
    /// * `user` - The address of the user receiving the reward
    /// * `pool_id` - The pool identifier (if applicable)
    /// * `amount` - The amount of reward to credit
    /// * `tx_hash` - The transaction hash for tracking
    ///
    /// # Returns
    /// * `Ok(())` on success
    /// * `Err(Error::Unauthorized)` if caller is not the admin
    /// * `Err(Error::InvalidInput)` if amount is <= 0
    ///
    /// # Authorization
    /// Requires authorization from the `admin` address.
    ///
    /// # State Changes
    /// - Updates user's reward totals based on reward kind
    pub fn credit_user_reward(
        env: Env,
        manager: Address,
        kind: u32,
        user: Address,
        pool_id: Bytes,
        amount: i128,
        tx_hash: Bytes,
    ) -> Result<(), Error> {
        Self::require_manager_auth(&env, &manager)?;
        if amount <= 0 { return Err(Error::InvalidInput); }

        let now = env.ledger().timestamp();

        Self::update_user_reward_totals(&env, &user, 
            if kind == 0 { amount } else { 0 },
            if kind == 1 { amount } else { 0 },
            now)?;

        let evt = UserRewardCreditedEvent { 
            kind, 
            user: user.clone(), 
            pool_id, 
            amount, 
            tx_hash, 
            timestamp: now 
        };
        env.events().publish((symbol_short!("ucred"),), evt);
        
        Ok(())
    }

    /// Records POL (Protocol Owned Liquidity) rewards claimed from AQUA-BLUB pair voting.
    ///
    /// The rewards are split: 70% distributed to users, 30% to treasury.
    ///
    /// # Arguments
    /// * `admin` - The admin address authorizing this operation
    /// * `reward_amount` - The total amount of rewards claimed
    /// * `ice_voting_power` - The ICE voting power used to obtain these rewards
    ///
    /// # Returns
    /// * `Ok(())` on success
    /// * `Err(Error::Unauthorized)` if caller is not the admin
    /// * `Err(Error::InvalidInput)` if reward_amount is <= 0
    ///
    /// # Authorization
    /// Requires authorization from the `admin` address.
    ///
    /// # State Changes
    /// - Updates POL state with new reward totals
    /// - Creates a daily POL snapshot
    /// - Emits POL rewards claimed event
    pub fn record_pol_rewards(
        env: Env,
        manager: Address,
        reward_amount: i128,
        ice_voting_power: i128,
    ) -> Result<(), Error> {
        Self::require_manager_auth(&env, &manager)?;

        if reward_amount <= 0 {
            return Err(Error::InvalidInput);
        }

        let now = env.ledger().timestamp();

        // Get current POL state
        let mut pol = Self::get_pol(&env);
        pol.total_pol_rewards_earned = pol.total_pol_rewards_earned.saturating_add(reward_amount);
        pol.last_reward_claim = now;
        pol.ice_voting_power_used = ice_voting_power;

        env.storage().instance().set(&DataKey::ProtocolOwnedLiquidity, &pol);

        let user_distribution = (reward_amount * 70) / 100;
        let treasury_amount = reward_amount - user_distribution;

        // Create daily snapshot
        let day = now / 86400;
        env.storage().instance().set(&DataKey::DailyPolSnapshot(day), &pol);

        // Emit POL rewards event
        let event = PolRewardsClaimedEvent {
            reward_amount,
            ice_voting_power,
            total_pol_rewards: pol.total_pol_rewards_earned,
            reward_distribution_to_users: user_distribution,
            treasury_amount,
            timestamp: now,
        };
        env.events().publish((symbol_short!("polrew"),), event);
        
        Ok(())
    }

    fn update_global_state(env: &Env, locked_delta: i128, lp_delta: i128, is_new_user: bool) -> Result<(), Error> {
        let mut global_state = Self::get_global_state(env.clone())?;
        
        global_state.total_locked = global_state.total_locked.saturating_add(locked_delta);
        global_state.total_lp_staked = global_state.total_lp_staked.saturating_add(lp_delta);
        
        if is_new_user {
            global_state.total_users = global_state.total_users.saturating_add(1);
        }
        
        global_state.last_reward_update = env.ledger().timestamp();
        
        env.storage().instance().set(&DataKey::GlobalState, &global_state);
        Ok(())
    }

    /// Update global state including BLUB supply

    fn update_reward_rates(env: &Env, kind: u32, distributed_amount: i128) -> Result<(), Error> {
        let mut global_state = Self::get_global_state(env.clone())?;
        
        if kind == 0 && global_state.total_lp_staked > 0 {
            let rate_increase = (distributed_amount * 1_000_000) / global_state.total_lp_staked;
            global_state.reward_per_lp_token = global_state.reward_per_lp_token.saturating_add(rate_increase);
        } else if kind == 1 && global_state.total_locked > 0 {
            let rate_increase = (distributed_amount * 1_000_000) / global_state.total_locked;
            global_state.reward_per_locked_token = global_state.reward_per_locked_token.saturating_add(rate_increase);
        }
        
        env.storage().instance().set(&DataKey::GlobalState, &global_state);
        Ok(())
    }

    fn update_user_reward_totals(env: &Env, user: &Address, lp_amount: i128, locked_amount: i128, timestamp: u64) -> Result<(), Error> {
        let mut totals: UserRewardTotals = env
            .storage()
            .persistent()
            .get(&DataKey::UserRewards(user.clone()))
            .unwrap_or(UserRewardTotals { 
                lp_total: 0, 
                locked_total: 0, 
                last_update_ts: 0,
                pending_lp: 0,
                pending_locked: 0,
            });

        totals.lp_total = totals.lp_total.saturating_add(lp_amount);
        totals.locked_total = totals.locked_total.saturating_add(locked_amount);
        totals.last_update_ts = timestamp;
        
        env.storage().persistent().set(&DataKey::UserRewards(user.clone()), &totals);
        Ok(())
    }

    /// Update POL contribution tracking
    fn update_pol_contribution(env: &Env, aqua_amount: i128, blub_amount: i128) -> Result<(), Error> {
        let mut pol: ProtocolOwnedLiquidity = env
            .storage()
            .instance()
            .get(&DataKey::ProtocolOwnedLiquidity)
            .unwrap_or_default();

        pol.total_aqua_contributed = pol.total_aqua_contributed.saturating_add(aqua_amount);
        pol.total_blub_contributed = pol.total_blub_contributed.saturating_add(blub_amount);

        env.storage().instance().set(&DataKey::ProtocolOwnedLiquidity, &pol);

        Ok(())
    }

    /// Get Protocol Owned Liquidity state
    fn get_pol(env: &Env) -> ProtocolOwnedLiquidity {
        env.storage()
            .instance()
            .get(&DataKey::ProtocolOwnedLiquidity)
            .unwrap_or_default()
    }

    fn update_lock_totals(env: &Env, amount: i128, _reward_multiplier: i128) -> Result<(), Error> {
        let mut totals: LockTotals = env
            .storage()
            .persistent()
            .get(&DataKey::LockTotals)
            .unwrap_or(LockTotals {
                total_locked_aqua: 0,
                total_blub_minted: 0,
                total_entries: 0,
                last_update_ts: 0,
                accumulated_rewards: 0,
            });

        totals.total_locked_aqua = totals.total_locked_aqua.saturating_add(amount);
        totals.total_entries = totals.total_entries.saturating_add(1);
        totals.last_update_ts = env.ledger().timestamp();

        env.storage().persistent().set(&DataKey::LockTotals, &totals);
        Ok(())
    }

    /// Update lock totals including BLUB minted
    fn update_lock_totals_with_blub(env: &Env, aqua_amount: i128, blub_amount: i128, _reward_multiplier: i128) -> Result<(), Error> {
        let mut totals: LockTotals = env
            .storage()
            .persistent()
            .get(&DataKey::LockTotals)
            .unwrap_or(LockTotals {
                total_locked_aqua: 0,
                total_blub_minted: 0,
                total_entries: 0,
                last_update_ts: 0,
                accumulated_rewards: 0,
            });

        totals.total_locked_aqua = totals.total_locked_aqua.saturating_add(aqua_amount);
        totals.total_blub_minted = totals.total_blub_minted.saturating_add(blub_amount);
        totals.total_entries = totals.total_entries.saturating_add(1);
        totals.last_update_ts = env.ledger().timestamp();

        env.storage().persistent().set(&DataKey::LockTotals, &totals);
        Ok(())
    }

    fn calculate_lock_multiplier(duration_minutes: u64) -> i128 {
        // Calculate bonus based on elapsed time: 1 day (1440 min) = 100 bps (1%), max = 10000 bps (100%)
        // Base 100% + up to 100% bonus for longer time staked
        let duration_bonus = ((duration_minutes as i128 * 100) / 1440).min(10000);
        10000 + duration_bonus // The longer staked, the higher the rewards
    }

    fn calculate_lp_shares(amount_a: i128, amount_b: i128) -> i128 {
        if amount_a <= 0 || amount_b <= 0 { return 0; }
        Self::integer_sqrt(amount_a.saturating_mul(amount_b))
    }

    fn integer_sqrt(value: i128) -> i128 {
        if value < 2 { return value; }
        let mut x = value;
        let mut y = (x + 1) / 2;
        while y < x {
            x = y;
            y = (x + value / x) / 2;
        }
        x
    }

    // Old reward system functions (calculate_pending_rewards, get_user_total_multiplier) removed.
    // Rewards are now handled exclusively by the Synthetix-style system (v1.2.0).

    /// Retrieves the global contract state.
    ///
    /// # Returns
    /// * `Ok(GlobalState)` - The current global state including locked amounts, supply, and reward rates
    /// * `Err(Error::NotInitialized)` if contract is not initialized
    pub fn get_global_state(env: Env) -> Result<GlobalState, Error> {
        env.storage()
            .instance()
            .get(&DataKey::GlobalState)
            .ok_or(Error::NotInitialized)
    }

    // Getters (gas-optimized, return only essential data)
    
    /// Retrieves the lock totals for a specific user.
    ///
    /// # Arguments
    /// * `user` - The address of the user
    ///
    /// # Returns
    /// * `Some(LockTotals)` if user has locks
    /// * `None` if user has no locks
    pub fn get_user_lock_totals(env: Env, user: Address) -> Option<LockTotals> {
        env.storage().persistent().get(&DataKey::UserLockTotals(user))
    }

    /// Gets the number of lock entries for a user.
    ///
    /// # Arguments
    /// * `user` - The address of the user
    ///
    /// # Returns
    /// The count of lock entries (0 if none)
    pub fn get_user_lock_count(env: Env, user: Address) -> u32 {
        let user_locks: Vec<Bytes> = env
            .storage()
            .persistent()
            .get(&DataKey::UserLocks(user))
            .unwrap_or(Vec::new(&env));
        user_locks.len()
    }

    /// Retrieves a specific lock entry by index for a user.
    ///
    /// # Arguments
    /// * `user` - The address of the user
    /// * `index` - The index of the lock entry
    ///
    /// # Returns
    /// * `Some(LockEntry)` if the entry exists
    /// * `None` if the entry doesn't exist
    pub fn get_user_lock_by_index(env: Env, user: Address, index: u32) -> Option<LockEntry> {
        let user_locks: Vec<Bytes> = env
            .storage()
            .persistent()
            .get(&DataKey::UserLocks(user.clone()))
            .unwrap_or(Vec::new(&env));
        
        if let Some(tx_hash) = user_locks.get(index) {
            env.storage().persistent().get(&DataKey::UserLockByTxHash(user, tx_hash))
        } else {
            None
        }
    }

    /// Gets all pool IDs that a user has LP positions in.
    ///
    /// # Arguments
    /// * `user` - The address of the user
    ///
    /// # Returns
    /// A vector of pool IDs (empty if none)
    pub fn get_user_pools(env: Env, user: Address) -> Vec<Bytes> {
        env.storage().persistent().get(&DataKey::UserPools(user)).unwrap_or(Vec::new(&env))
    }

    /// Retrieves a user's LP position for a specific pool.
    ///
    /// # Arguments
    /// * `user` - The address of the user
    /// * `pool_id` - The pool identifier
    ///
    /// # Returns
    /// * `Some(LpPosition)` if the position exists
    /// * `None` if no position found
    pub fn get_user_lp(env: Env, user: Address, pool_id: Bytes) -> Option<LpPosition> {
        env.storage().persistent().get(&DataKey::UserLp(user, pool_id))
    }

    /// Retrieves accumulated reward totals for a user.
    ///
    /// # Arguments
    /// * `user` - The address of the user
    ///
    /// # Returns
    /// * `Some(UserRewardTotals)` if user has rewards
    /// * `None` if no rewards found
    pub fn get_user_rewards(env: Env, user: Address) -> Option<UserRewardTotals> {
        env.storage().persistent().get(&DataKey::UserRewards(user))
    }

    /// Gets the number of unlock entries for a user.
    ///
    /// # Arguments
    /// * `user` - The address of the user
    ///
    /// # Returns
    /// The count of unlock entries (0 if none)
    pub fn get_unlock_count(env: Env, user: Address) -> u32 {
        let user_unlocks: Vec<Bytes> = env
            .storage()
            .persistent()
            .get(&DataKey::UserUnlocks(user))
            .unwrap_or(Vec::new(&env));
        user_unlocks.len()
    }

    /// Retrieves a specific unlock entry by index for a user.
    ///
    /// # Arguments
    /// * `user` - The address of the user
    /// * `index` - The index of the unlock entry
    ///
    /// # Returns
    /// * `Some(UnlockEntry)` if the entry exists
    /// * `None` if the entry doesn't exist
    pub fn get_unlock_by_index(env: Env, user: Address, index: u32) -> Option<UnlockEntry> {
        let user_unlocks: Vec<Bytes> = env
            .storage()
            .persistent()
            .get(&DataKey::UserUnlocks(user.clone()))
            .unwrap_or(Vec::new(&env));
        
        if let Some(tx_hash) = user_unlocks.get(index) {
            env.storage().persistent().get(&DataKey::UserUnlockByTxHash(user, tx_hash))
        } else {
            None
        }
    }

    /// Gets the number of BLUB restake entries for a user.
    ///
    /// # Arguments
    /// * `user` - The address of the user
    ///
    /// # Returns
    /// The count of BLUB restake entries (0 if none)
    pub fn get_blub_restake_count(env: Env, user: Address) -> u32 {
        let user_restakes: Vec<Bytes> = env
            .storage()
            .persistent()
            .get(&DataKey::UserBlubRestakes(user))
            .unwrap_or(Vec::new(&env));
        user_restakes.len()
    }

    /// Retrieves a specific BLUB restake entry by index for a user.
    ///
    /// # Arguments
    /// * `user` - The address of the user
    /// * `index` - The index of the restake entry
    ///
    /// # Returns
    /// * `Some(BlubRestakeEntry)` if the entry exists
    /// * `None` if the entry doesn't exist
    pub fn get_blub_restake_by_index(env: Env, user: Address, index: u32) -> Option<BlubRestakeEntry> {
        let user_restakes: Vec<Bytes> = env
            .storage()
            .persistent()
            .get(&DataKey::UserBlubRestakes(user.clone()))
            .unwrap_or(Vec::new(&env));
        
        if let Some(tx_hash) = user_restakes.get(index) {
            env.storage().persistent().get(&DataKey::UserBlubRestakeByTxHash(user, tx_hash))
        } else {
            None
        }
    }

    /// Gets the total number of reward distributions recorded.
    ///
    /// # Returns
    /// The count of distribution entries (0 if none)
    pub fn get_distribution_count(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::DistributionCount).unwrap_or(0)
    }

    /// Retrieves a specific reward distribution entry by index.
    ///
    /// # Arguments
    /// * `index` - The index of the distribution entry
    ///
    /// # Returns
    /// * `Some(RewardDistribution)` if the entry exists
    /// * `None` if the entry doesn't exist
    pub fn get_distribution_by_index(env: Env, index: u32) -> Option<RewardDistribution> {
        env.storage().instance().get(&DataKey::DistributionByIndex(index))
    }

    /// Retrieves the Protocol Owned Liquidity (POL) state.
    ///
    /// # Returns
    /// The current POL state including AQUA/BLUB contributions and LP positions
    pub fn get_protocol_owned_liquidity(env: Env) -> ProtocolOwnedLiquidity {
        Self::get_pol(&env)
    }

    /// Retrieves a daily POL snapshot for a specific day.
    ///
    /// # Arguments
    /// * `day` - The day number (timestamp / 86400)
    ///
    /// # Returns
    /// * `Some(ProtocolOwnedLiquidity)` if a snapshot exists for that day
    /// * `None` if no snapshot found
    pub fn get_daily_pol_snapshot(env: Env, day: u64) -> Option<ProtocolOwnedLiquidity> {
        env.storage().instance().get(&DataKey::DailyPolSnapshot(day))
    }

    /// Calculates the total POL contribution for a specific user.
    ///
    /// Sums up all POL contributions from the user's lock entries.
    ///
    /// # Arguments
    /// * `user` - The address of the user
    ///
    /// # Returns
    /// The total amount of AQUA contributed to POL by this user
    pub fn get_user_pol_contribution(env: Env, user: Address) -> i128 {
        let user_locks: Vec<Bytes> = env
            .storage()
            .persistent()
            .get(&DataKey::UserLocks(user.clone()))
            .unwrap_or(Vec::new(&env));

        let mut total_contribution = 0i128;
        for i in 0..user_locks.len() {
            if let Some(tx_hash) = user_locks.get(i) {
                if let Some(lock) = env.storage().persistent().get::<DataKey, LockEntry>(&DataKey::UserLockByTxHash(user.clone(), tx_hash)) {
                    total_contribution = total_contribution.saturating_add(lock.pol_contributed);
                }
            }
        }

        total_contribution
    }

    /// Retrieves the current reserves from the AQUA/BLUB liquidity pool.
    ///
    /// # Returns
    /// * `Ok((i128, i128))` - A tuple of (aqua_reserve, blub_reserve)
    /// * `Err(Error::InvalidInput)` if the pool query fails
    pub fn get_pool_reserves(env: Env) -> Result<(i128, i128), Error> {
        let config = Self::get_config(env.clone())?;
        
        use soroban_sdk::IntoVal;
        
        // Call get_reserves() -> vec<u128>
        let result = env.try_invoke_contract::<soroban_sdk::Vec<u128>, soroban_sdk::Error>(
            &config.liquidity_contract,
            &soroban_sdk::Symbol::new(&env, "get_reserves"),
            ().into_val(&env),
        );
        
        match result {
            Ok(Ok(reserves)) => {
                if reserves.len() >= 2 {
                    let aqua_reserve = reserves.get(0).unwrap_or(0) as i128;
                    let blub_reserve = reserves.get(1).unwrap_or(0) as i128;
                    Ok((aqua_reserve, blub_reserve))
                } else {
                    Err(Error::InvalidInput)
                }
            }
            Ok(Err(_)) => Err(Error::InvalidInput),
            Err(_) => Err(Error::InvalidInput)
        }
    }

    /// Retrieves the LP share token address from the liquidity pool.
    ///
    /// # Returns
    /// * `Ok(Address)` - The share token contract address
    /// * `Err(Error::InvalidInput)` if the pool query fails
    pub fn get_pool_share_token(env: Env) -> Result<Address, Error> {
        let config = Self::get_config(env.clone())?;
        
        use soroban_sdk::IntoVal;
        
        let result = env.try_invoke_contract::<Address, soroban_sdk::Error>(
            &config.liquidity_contract,
            &soroban_sdk::Symbol::new(&env, "share_id"),
            ().into_val(&env),
        );
        
        match result {
            Ok(Ok(addr)) => Ok(addr),
            _ => Err(Error::InvalidInput)
        }
    }

    /// Withdraws liquidity from the pool (admin-only).
    ///
    /// Used to manage Protocol Owned Liquidity or rebalance the pool.
    ///
    /// # Arguments
    /// * `admin` - The admin address authorizing this operation
    /// * `share_amount` - The amount of LP share tokens to burn
    /// * `min_aqua` - Minimum AQUA to receive (slippage protection)
    /// * `min_blub` - Minimum BLUB to receive (slippage protection)
    ///
    /// # Returns
    /// * `Ok((i128, i128))` - A tuple of (aqua_withdrawn, blub_withdrawn)
    /// * `Err(Error::Unauthorized)` if caller is not the admin
    /// * `Err(Error::InvalidInput)` if parameters are invalid or withdrawal fails
    ///
    /// # Authorization
    /// Requires authorization from the `admin` address.
    ///
    /// # State Changes
    /// - Reduces POL LP position tracking
    /// - Burns LP share tokens
    /// - Transfers withdrawn tokens to contract
    /// Withdraws LP from the POL pool.
    /// Protected by admin (multisig) — manager cannot drain LP principal.
    pub fn withdraw_from_pool(
        env: Env,
        admin: Address,
        share_amount: i128,
        min_aqua: i128,
        min_blub: i128,
    ) -> Result<(i128, i128), Error> {
        let config = Self::get_config(env.clone())?;
        admin.require_auth();
        let stored_admin = env.storage()
            .instance()
            .get::<DataKey, Address>(&DataKey::AdminAddress)
            .ok_or(Error::Unauthorized)?;
        if stored_admin != admin {
            return Err(Error::Unauthorized);
        }

        if share_amount <= 0 {
            return Err(Error::InvalidInput);
        }

        let contract_address = env.current_contract_address();

        use soroban_sdk::IntoVal;

        // Prepare min_amounts vector
        let mut min_amounts = soroban_sdk::Vec::new(&env);
        min_amounts.push_back(min_aqua as u128);
        min_amounts.push_back(min_blub as u128);

        // Call withdraw(user: address, share_amount: u128, min_amounts: vec<u128>) -> vec<u128>
        let result = env.try_invoke_contract::<soroban_sdk::Vec<u128>, soroban_sdk::Error>(
            &config.liquidity_contract,
            &soroban_sdk::Symbol::new(&env, "withdraw"),
            (contract_address.clone(), share_amount as u128, min_amounts).into_val(&env),
        );
        
        match result {
            Ok(Ok(withdrawn_amounts)) => {
                if withdrawn_amounts.len() >= 2 {
                    let aqua_withdrawn = withdrawn_amounts.get(0).unwrap_or(0) as i128;
                    let blub_withdrawn = withdrawn_amounts.get(1).unwrap_or(0) as i128;
                    
                    // Update POL tracking
                    let mut pol = Self::get_pol(&env);
                    pol.aqua_blub_lp_position = pol.aqua_blub_lp_position.saturating_sub(share_amount);
                    env.storage().instance().set(&DataKey::ProtocolOwnedLiquidity, &pol);
                    
                    // Emit withdrawal event
                    env.events().publish(
                        (symbol_short!("pol_wdrw"),),
                        (share_amount, aqua_withdrawn, blub_withdrawn),
                    );
                    
                    Ok((aqua_withdrawn, blub_withdrawn))
                } else {
                    Err(Error::InvalidInput)
                }
            }
            Ok(Err(_)) => Err(Error::InvalidInput),
            Err(_) => Err(Error::InvalidInput)
        }
    }

    /// Retrieves the virtual price of the liquidity pool.
    ///
    /// The virtual price represents the price of an LP token in terms of underlying assets.
    ///
    /// # Returns
    /// * `Ok(i128)` - The virtual price
    /// * `Err(Error::InvalidInput)` if the pool query fails
    pub fn get_pool_virtual_price(env: Env) -> Result<i128, Error> {
        let config = Self::get_config(env.clone())?;
        
        use soroban_sdk::IntoVal;
        
        let result = env.try_invoke_contract::<u128, soroban_sdk::Error>(
            &config.liquidity_contract,
            &soroban_sdk::Symbol::new(&env, "get_virtual_price"),
            ().into_val(&env),
        );
        
        match result {
            Ok(Ok(price)) => Ok(price as i128),
            _ => Err(Error::InvalidInput)
        }
    }

    /// Claims accumulated rewards from the liquidity pool (admin-only).
    ///
    /// # Arguments
    /// * `admin` - The admin address authorizing this operation
    ///
    /// # Returns
    /// * `Ok(i128)` - The amount of rewards claimed
    /// * `Err(Error::Unauthorized)` if caller is not the admin
    /// * `Err(Error::InvalidInput)` if the claim fails
    ///
    /// # Authorization
    /// Requires authorization from the `admin` address.
    ///
    /// # State Changes
    /// - Updates POL total rewards earned
    /// - Updates last reward claim timestamp
    pub fn claim_pool_rewards(
        env: Env,
        manager: Address,
    ) -> Result<i128, Error> {
        let config = Self::get_config(env.clone())?;
        Self::require_manager_auth(&env, &manager)?;

        let contract_address = env.current_contract_address();
        
        use soroban_sdk::IntoVal;
        
        // Call claim(user: address) -> u128
        let result = env.try_invoke_contract::<u128, soroban_sdk::Error>(
            &config.liquidity_contract,
            &soroban_sdk::Symbol::new(&env, "claim"),
            (contract_address.clone(),).into_val(&env),
        );
        
        match result {
            Ok(Ok(reward_amount)) => {
                let mut pol = Self::get_pol(&env);
                pol.total_pol_rewards_earned = pol.total_pol_rewards_earned.saturating_add(reward_amount as i128);
                pol.last_reward_claim = env.ledger().timestamp();
                env.storage().instance().set(&DataKey::ProtocolOwnedLiquidity, &pol);
                
                env.events().publish(
                    (symbol_short!("pool_clm"),),
                    reward_amount as i128,
                );
                
                Ok(reward_amount as i128)
            }
            Ok(Err(_)) => Err(Error::InvalidInput),
            Err(_) => Err(Error::InvalidInput)
        }
    }

    /// Retrieves the pending rewards available from the liquidity pool.
    ///
    /// # Returns
    /// * `Ok(i128)` - The amount of pending rewards
    /// * `Err(Error::InvalidInput)` if the pool query fails
    pub fn get_pool_pending_rewards(env: Env) -> Result<i128, Error> {
        let config = Self::get_config(env.clone())?;
        let contract_address = env.current_contract_address();
        
        use soroban_sdk::IntoVal;
        
        let result = env.try_invoke_contract::<u128, soroban_sdk::Error>(
            &config.liquidity_contract,
            &soroban_sdk::Symbol::new(&env, "get_user_reward"),
            (contract_address,).into_val(&env),
        );
        
        match result {
            Ok(Ok(reward)) => Ok(reward as i128),
            _ => Err(Error::InvalidInput)
        }
    }

    // Admin functions for gas optimization
    
    /// Updates the base reward rate (admin-only).
    ///
    /// # Arguments
    /// * `admin` - The admin address authorizing this operation
    /// * `new_rate` - The new reward rate in basis points per period (max 1000 = 10%)
    ///
    /// # Returns
    /// * `Ok(())` on success
    /// * `Err(Error::Unauthorized)` if caller is not the admin
    /// * `Err(Error::InvalidInput)` if new_rate > 1000
    ///
    /// # Authorization
    /// Requires authorization from the `admin` address.
    pub fn update_reward_rate(env: Env, admin: Address, new_rate: i128) -> Result<(), Error> {
        let mut cfg = Self::get_config(env.clone())?;
        admin.require_auth();
        if cfg.admin != admin { return Err(Error::Unauthorized); }
        if new_rate > 1000 { return Err(Error::InvalidInput); }

        cfg.reward_rate = new_rate;
        env.storage().instance().set(&DataKey::Config, &cfg);
        Ok(())
    }

    /// Manually deposits accumulated POL to the AQUA-BLUB LP pool (admin-only).
    ///
    /// # Arguments
    /// * `admin` - The admin address authorizing this operation
    /// * `aqua_amount` - The amount of AQUA to deposit to LP
    /// * `blub_amount` - The amount of BLUB to deposit to LP
    ///
    /// # Returns
    /// * `Ok(())` on success
    /// * `Err(Error::Unauthorized)` if caller is not the admin
    /// * `Err(Error::InvalidInput)` if amounts are <= 0
    /// * `Err(Error::InsufficientBalance)` if contract doesn't have enough tokens
    ///
    /// # Authorization
    /// Requires authorization from the `admin` address.
    ///
    /// # State Changes
    /// - Transfers tokens to LP pool
    /// - Updates POL LP position tracking
    pub fn manual_deposit_pol(
        env: Env,
        manager: Address,
        aqua_amount: i128,
        blub_amount: i128,
    ) -> Result<(), Error> {
        let cfg = Self::get_config(env.clone())?;
        Self::require_manager_auth(&env, &manager)?;

        if aqua_amount <= 0 || blub_amount <= 0 {
            return Err(Error::InvalidInput);
        }

        // Check that contract has enough balance
        use soroban_sdk::token;
        let contract_address = env.current_contract_address();
        
        let aqua_client = token::Client::new(&env, &cfg.aqua_token);
        let aqua_balance = aqua_client.balance(&contract_address);
        if aqua_balance < aqua_amount {
            return Err(Error::InsufficientBalance);
        }

        // Check external BLUB balance
        let blub_client = token::Client::new(&env, &cfg.blub_token);
        let blub_balance = blub_client.balance(&contract_address);
        if blub_balance < blub_amount {
            return Err(Error::InsufficientBalance);
        }

        // Deposit to LP
        Self::deposit_pol_to_lp(&env, &cfg, aqua_amount, blub_amount)?;

        env.events().publish(
            (symbol_short!("man_pol"),),
            (aqua_amount, blub_amount),
        );

        Ok(())
    }


    /// Updates the liquidity pool contract address (admin-only).
    ///
    /// # Arguments
    /// * `admin` - The admin address authorizing this operation
    /// * `new_liquidity_contract` - The new liquidity pool contract address
    ///
    /// # Returns
    /// * `Ok(())` on success
    /// * `Err(Error::Unauthorized)` if caller is not the admin
    ///
    /// # Authorization
    /// Requires authorization from the `admin` address.
    pub fn update_liquidity_contract(env: Env, admin: Address, new_liquidity_contract: Address) -> Result<(), Error> {
        let mut cfg = Self::get_config(env.clone())?;
        admin.require_auth();
        if cfg.admin != admin { return Err(Error::Unauthorized); }

        cfg.liquidity_contract = new_liquidity_contract.clone();
        env.storage().instance().set(&DataKey::Config, &cfg);
        
        env.events().publish(
            (symbol_short!("liq_upd"),),
            new_liquidity_contract,
        );

        Ok(())
    }

    /// Updates BLUB token contract address (admin-only).
    ///
    /// # Arguments
    /// * `admin` - The admin address authorizing this operation
    /// * `new_blub_token` - The new BLUB token contract address
    ///
    /// # Returns
    /// * `Ok(())` on success
    /// * `Err(Error::Unauthorized)` if caller is not the admin
    ///
    /// # Authorization
    /// Requires authorization from the `admin` address.
    pub fn update_blub_token(
        env: Env,
        admin: Address,
        new_blub_token: Address,
    ) -> Result<(), Error> {
        let mut cfg = Self::get_config(env.clone())?;
        admin.require_auth();
        if cfg.admin != admin {
            return Err(Error::Unauthorized);
        }

        cfg.blub_token = new_blub_token.clone();
        env.storage().instance().set(&DataKey::Config, &cfg);

        env.events().publish(
            (symbol_short!("blub_upd"),),
            new_blub_token,
        );

        Ok(())
    }

    /// Updates vault treasury address (admin-only).
    pub fn update_vault_treasury(env: Env, admin: Address, new_treasury: Address) -> Result<(), Error> {
        let mut cfg = Self::get_config(env.clone())?;
        admin.require_auth();
        if cfg.admin != admin { return Err(Error::Unauthorized); }

        cfg.vault_treasury = new_treasury.clone();
        env.storage().instance().set(&DataKey::Config, &cfg);

        env.events().publish(
            (symbol_short!("vtrs_upd"),),
            new_treasury,
        );

        Ok(())
    }

    /// Updates vault fee in basis points (admin-only).
    /// Max 5000 (50%).
    pub fn update_vault_fee_bps(env: Env, admin: Address, new_fee_bps: u32) -> Result<(), Error> {
        let mut cfg = Self::get_config(env.clone())?;
        admin.require_auth();
        if cfg.admin != admin { return Err(Error::Unauthorized); }
        if new_fee_bps > 5000 { return Err(Error::InvalidInput); }

        cfg.vault_fee_bps = new_fee_bps;
        env.storage().instance().set(&DataKey::Config, &cfg);

        env.events().publish(
            (symbol_short!("vfee_upd"),),
            new_fee_bps,
        );

        Ok(())
    }

    /// Updates ICE token addresses (admin-only).
    pub fn update_ice_tokens(
        env: Env,
        admin: Address,
        ice_token: Address,
        govern_ice_token: Address,
        upvote_ice_token: Address,
        downvote_ice_token: Address,
    ) -> Result<(), Error> {
        let mut cfg = Self::get_config(env.clone())?;
        admin.require_auth();
        if cfg.admin != admin { return Err(Error::Unauthorized); }

        cfg.ice_token = ice_token.clone();
        cfg.govern_ice_token = govern_ice_token.clone();
        cfg.upvote_ice_token = upvote_ice_token.clone();
        cfg.downvote_ice_token = downvote_ice_token.clone();
        env.storage().instance().set(&DataKey::Config, &cfg);

        env.events().publish(
            (symbol_short!("ice_upd"),),
            ice_token,
        );

        Ok(())
    }

    // ============================================================================
    // Contract Upgrade & Migration Functions
    // ============================================================================

    /// Upgrades the contract to a new WASM hash (admin-only).
    ///
    /// # Arguments
    /// * `admin` - The admin address authorizing this operation
    /// * `new_wasm_hash` - The hash of the new WASM to upgrade to
    ///
    /// # Authorization
    /// Requires authorization from the `admin` address.
    pub fn upgrade(env: Env, admin: Address, new_wasm_hash: soroban_sdk::BytesN<32>) -> Result<(), Error> {
        admin.require_auth();

        // STEP 1: Verify admin using the stable AdminAddress key first.
        // This key stores just an Address and will never break due to
        // Config struct changes, preventing the contract from being bricked.
        let is_admin = if let Some(stored_admin) = env.storage().instance().get::<DataKey, Address>(&DataKey::AdminAddress) {
            stored_admin == admin
        } else if let Ok(cfg) = Self::get_config(env.clone()) {
            cfg.admin == admin
        } else if let Some(cfg_v1_1) = env.storage().instance().get::<DataKey, ConfigV1_1>(&DataKey::Config) {
            cfg_v1_1.admin == admin
        } else {
            let old_cfg: OldConfig = env.storage().instance()
                .get(&DataKey::Config)
                .ok_or(Error::NotInitialized)?;
            old_cfg.admin == admin
        };

        if !is_admin {
            return Err(Error::Unauthorized);
        }

        // STEP 2: Ensure AdminAddress key exists for future upgrades.
        // This handles contracts initialized before this key was added.
        if !env.storage().instance().has(&DataKey::AdminAddress) {
            env.storage().instance().set(&DataKey::AdminAddress, &admin);
        }

        env.deployer().update_current_contract_wasm(new_wasm_hash);

        env.events().publish(
            (symbol_short!("upgraded"),),
            env.current_contract_address(),
        );

        Ok(())
    }

    /// Migrate contract from v1.1.0 to v1.2.0
    /// - Adds cooldown fields to Config
    /// - Initializes RewardStateV2 with correct total_staked
    ///
    /// # Arguments
    /// * `admin` - Admin address for authorization
    ///
    /// # Returns
    /// * `Ok(())` on success
    /// * `Err(Error::AlreadyInitialized)` if already v1.2.0
    /// * `Err(Error::Unauthorized)` if not admin
    pub fn migrate_v1_2_0(env: Env, admin: Address) -> Result<(), Error> {
        admin.require_auth();

        // Try to read as v1.1.0 config (15 fields, no cooldowns)
        let old_config: ConfigV1_1 = env.storage().instance()
            .get(&DataKey::Config)
            .ok_or(Error::NotInitialized)?;

        // Check admin authorization
        if old_config.admin != admin {
            return Err(Error::Unauthorized);
        }

        // Check if already migrated to v1.2.0
        if old_config.version >= 10200 {
            return Err(Error::AlreadyInitialized);
        }

        // Create new Config with cooldown fields
        let new_config = Config {
            admin: old_config.admin,
            version: 10200, // v1.2.0
            total_supply: old_config.total_supply,
            treasury_address: old_config.treasury_address,
            reward_rate: old_config.reward_rate,
            aqua_token: old_config.aqua_token,
            blub_token: old_config.blub_token,
            liquidity_contract: old_config.liquidity_contract,
            ice_token: old_config.ice_token,
            govern_ice_token: old_config.govern_ice_token,
            upvote_ice_token: old_config.upvote_ice_token,
            downvote_ice_token: old_config.downvote_ice_token,
            period_unit_minutes: old_config.period_unit_minutes,
            vault_treasury: old_config.vault_treasury,
            vault_fee_bps: old_config.vault_fee_bps,
            // New cooldown fields with defaults
            unstake_cooldown_seconds: 864000,      // 10 days
            claim_reward_cooldown_seconds: 604800, // 7 days
        };

        // Save new config
        env.storage().instance().set(&DataKey::Config, &new_config);

        // Get total staked from GlobalState
        // Use total_locked (AQUA) which equals staked BLUB (1:1 ratio)
        // total_blub_supply includes 0.1x that goes to LP, not staked
        let global_state = Self::get_global_state(env.clone())?;
        let total_staked = global_state.total_locked;

        // Initialize RewardStateV2 if not exists
        let reward_state_exists: bool = env.storage()
            .instance()
            .has(&DataKey::RewardStateV2);

        if !reward_state_exists {
            let reward_state = RewardState {
                reward_per_token_stored: 0,
                last_update_time: env.ledger().timestamp(),
                total_staked,
                total_rewards_added: 0,
                total_rewards_claimed: 0,
            };
            env.storage().instance().set(&DataKey::RewardStateV2, &reward_state);
        }

        // Emit migration event
        env.events().publish(
            (symbol_short!("migrated"),),
            10200u32,
        );

        Ok(())
    }

    /// Sets the manager address (admin-only).
    ///
    /// The manager is a single-sig backend wallet (e.g. blub-issuer-v2) that handles
    /// routine backend operations: adding rewards, compounding, claiming POL rewards, etc.
    /// The admin (multisig cold wallet) retains upgrade/config/pool authority.
    ///
    /// # Authorization
    /// Requires admin authorization (via AdminAddress key).
    pub fn set_manager(env: Env, admin: Address, new_manager: Address) -> Result<(), Error> {
        admin.require_auth();
        let stored_admin = env.storage()
            .instance()
            .get::<DataKey, Address>(&DataKey::AdminAddress)
            .ok_or(Error::Unauthorized)?;
        if stored_admin != admin {
            return Err(Error::Unauthorized);
        }
        env.storage().instance().set(&DataKey::ManagerAddress, &new_manager);
        env.events().publish((symbol_short!("set_op"),), new_manager);
        Ok(())
    }

    /// Returns the current manager address, or None if not yet set.
    pub fn get_manager_address(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::ManagerAddress)
    }

    /// Migration from v1.2.0 to v1.4.0: sets ManagerAddress = current admin.
    ///
    /// After this migration:
    /// 1. Transfer admin to the new multisig cold wallet via `set_admin` (or re-initialize).
    /// 2. The existing blub-issuer-v2 will continue as manager unchanged.
    ///
    /// # Authorization
    /// Requires current admin authorization.
    pub fn migrate_v1_4_0(env: Env, admin: Address) -> Result<(), Error> {
        admin.require_auth();
        let stored_admin = env.storage()
            .instance()
            .get::<DataKey, Address>(&DataKey::AdminAddress)
            .ok_or(Error::Unauthorized)?;
        if stored_admin != admin {
            return Err(Error::Unauthorized);
        }
        // Only set if not already configured — idempotent
        if !env.storage().instance().has(&DataKey::ManagerAddress) {
            env.storage().instance().set(&DataKey::ManagerAddress, &admin);
        }
        env.events().publish((symbol_short!("migrated"),), 10400u32);
        Ok(())
    }

    /// Migrate vault from broken ratio system to vault-share model (v1.8.0).
    ///
    /// Fixes critical bug where share_ratios could sum to >100%, causing LP
    /// double-counting. Converts to ERC-4626-style shares where:
    ///   user_lp = user_shares * total_lp / total_shares
    ///
    /// Compensates affected_user with LP from POL if their fair LP > current LP.
    ///
    /// # Arguments
    /// * `admin` - Admin address (requires auth)
    /// * `primary_user` - User with inflated 100% share (GAO3EX)
    /// * `affected_user` - User who lost LP due to the bug (GBTU)
    ///
    /// Must be called ONCE after upgrading to v1.8.0 WASM.
    pub fn migrate_v1_8_0(
        env: Env,
        admin: Address,
        primary_user: Address,
        affected_user: Address,
    ) -> Result<(), Error> {
        admin.require_auth();
        let stored_admin = env.storage()
            .instance()
            .get::<DataKey, Address>(&DataKey::AdminAddress)
            .ok_or(Error::Unauthorized)?;
        if stored_admin != admin {
            return Err(Error::Unauthorized);
        }

        let pool_id: u32 = 0;
        let mut pool_info: PoolInfo = env
            .storage()
            .persistent()
            .get(&DataKey::PoolInfo(pool_id))
            .ok_or(Error::PoolNotFound)?;

        let old_total_lp = pool_info.total_lp_tokens;

        // Read affected user's position (old ratio-based)
        let affected_key = DataKey::UserVaultPosition(affected_user.clone(), pool_id);
        let affected_pos: Option<UserVaultPosition> = env.storage().persistent().get(&affected_key);

        let primary_key = DataKey::UserVaultPosition(primary_user.clone(), pool_id);
        let primary_pos: Option<UserVaultPosition> = env.storage().persistent().get(&primary_key);

        // Calculate fair LP amounts
        let affected_current_lp = if let Some(ref a) = affected_pos {
            old_total_lp
                .checked_mul(a.share_ratio)
                .unwrap_or(0)
                .checked_div(1_000_000_000_000)
                .unwrap_or(0)
        } else {
            0
        };

        // Affected user's deposited LP (net of withdrawals) = fair minimum
        let affected_deposited: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::UserDepositedLp(affected_user.clone(), pool_id))
            .unwrap_or(0);

        // Fair LP = max(current calculated LP, net deposits)
        let affected_fair_lp = if affected_deposited > affected_current_lp {
            affected_deposited
        } else {
            affected_current_lp
        };

        // Primary user gets remainder of old total
        let primary_fair_lp = old_total_lp.saturating_sub(affected_fair_lp);

        // If compensation needed, increase total_lp with LP from POL
        if affected_fair_lp > affected_current_lp {
            let extra = affected_fair_lp - affected_current_lp;
            pool_info.total_lp_tokens = old_total_lp.saturating_add(extra);
        }

        // Set up vault share model: initial shares = LP amounts (1:1)
        // After migration: total_shares = primary_lp + affected_lp = total_lp
        let new_total_shares = primary_fair_lp.saturating_add(affected_fair_lp);

        // Update primary user position: shares = fair LP
        if let Some(mut p_pos) = primary_pos {
            p_pos.share_ratio = primary_fair_lp;
            env.storage().persistent().set(&primary_key, &p_pos);
        }

        // Update affected user position: shares = fair LP
        if let Some(mut a_pos) = affected_pos {
            a_pos.share_ratio = affected_fair_lp;
            env.storage().persistent().set(&affected_key, &a_pos);
        }

        // Store total shares
        env.storage()
            .persistent()
            .set(&DataKey::VaultTotalShares(pool_id), &new_total_shares);
        env.storage()
            .persistent()
            .set(&DataKey::PoolInfo(pool_id), &pool_info);

        env.events().publish(
            (symbol_short!("v180_fix"),),
            (affected_fair_lp, affected_current_lp, primary_fair_lp, new_total_shares, pool_info.total_lp_tokens),
        );

        env.events().publish((symbol_short!("migrated"),), 10800u32);
        Ok(())
    }

    /// Admin function to adjust a user's vault shares and LP.
    /// Used for one-time corrections. Adjusts both user shares and total shares/LP.
    /// Extra LP comes from POL (protocol-owned liquidity).
    pub fn admin_adjust_vault_position(
        env: Env,
        admin: Address,
        user: Address,
        pool_id: u32,
        new_shares: i128,
        lp_delta: i128,
    ) -> Result<(), Error> {
        admin.require_auth();
        let stored_admin = env.storage()
            .instance()
            .get::<DataKey, Address>(&DataKey::AdminAddress)
            .ok_or(Error::Unauthorized)?;
        if stored_admin != admin {
            return Err(Error::Unauthorized);
        }

        let mut pool_info: PoolInfo = env
            .storage()
            .persistent()
            .get(&DataKey::PoolInfo(pool_id))
            .ok_or(Error::PoolNotFound)?;

        let pos_key = DataKey::UserVaultPosition(user.clone(), pool_id);
        let mut user_position: UserVaultPosition = env
            .storage()
            .persistent()
            .get(&pos_key)
            .ok_or(Error::PositionNotFound)?;

        let old_shares = user_position.share_ratio;
        let share_delta = new_shares - old_shares;

        user_position.share_ratio = new_shares;
        user_position.active = new_shares > 0;

        // Adjust total shares and LP
        let total_shares: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::VaultTotalShares(pool_id))
            .unwrap_or(0);
        let new_total_shares = total_shares.saturating_add(share_delta);

        pool_info.total_lp_tokens = pool_info.total_lp_tokens.saturating_add(lp_delta);

        env.storage().persistent().set(&pos_key, &user_position);
        env.storage()
            .persistent()
            .set(&DataKey::PoolInfo(pool_id), &pool_info);
        env.storage()
            .persistent()
            .set(&DataKey::VaultTotalShares(pool_id), &new_total_shares);

        env.events().publish(
            (symbol_short!("adj_pos"), user, pool_id),
            (old_shares, new_shares, share_delta, lp_delta),
        );

        Ok(())
    }

    /// Returns the current config version.
    /// Transfers admin role to a new address (e.g. multisig cold wallet).
    ///
    /// Updates both `AdminAddress` (upgrade key) and `Config.admin`.
    /// After this call, the old admin has no special authority.
    ///
    /// # Authorization
    /// Requires current admin authorization.
    pub fn transfer_admin(env: Env, admin: Address, new_admin: Address) -> Result<(), Error> {
        admin.require_auth();
        let stored_admin = env.storage()
            .instance()
            .get::<DataKey, Address>(&DataKey::AdminAddress)
            .ok_or(Error::Unauthorized)?;
        if stored_admin != admin {
            return Err(Error::Unauthorized);
        }

        // Update stable AdminAddress key
        env.storage().instance().set(&DataKey::AdminAddress, &new_admin);

        // Update Config.admin
        if let Ok(mut cfg) = Self::get_config(env.clone()) {
            cfg.admin = new_admin.clone();
            env.storage().instance().set(&DataKey::Config, &cfg);
        }

        env.events().publish((symbol_short!("adm_xfer"),), new_admin);
        Ok(())
    }

    /// For old config: returns the old version number
    /// For new config: returns encoded version (10100 = v1.1.0)
    pub fn get_version(env: Env) -> Result<u32, Error> {
        // Try new config first
        if let Ok(cfg) = Self::get_config(env.clone()) {
            return Ok(cfg.version);
        }

        // Fall back to old config
        let old_cfg: OldConfig = env.storage().instance()
            .get(&DataKey::Config)
            .ok_or(Error::NotInitialized)?;

        Ok(old_cfg.version)
    }

    /// Test function to validate staking calculations without executing transactions.
    ///
    /// # Arguments
    /// * `aqua_amount` - The amount of AQUA to simulate staking
    ///
    /// # Returns
    /// * `Ok((i128, i128, i128, i128, i128))` - A tuple containing:
    ///   - blub_minted: Total BLUB tokens that would be minted (1.1x AQUA)
    ///   - blub_staked: BLUB amount that would be staked (1x AQUA)
    ///   - blub_to_lp: BLUB amount that would go to LP (0.1x AQUA)
    ///   - pol_aqua: AQUA amount for POL (10% of AQUA)
    ///   - ice_aqua: AQUA amount to ICE contract (90% of AQUA)
    /// * `Err(Error::InvalidInput)` if aqua_amount is <= 0
    pub fn test_staking_calculations(_env: Env, aqua_amount: i128) -> Result<(i128, i128, i128, i128, i128), Error> {
        if aqua_amount <= 0 {
            return Err(Error::InvalidInput);
        }
        
        let pol_aqua = aqua_amount / 10;                // 10% AQUA for POL
        let ice_aqua = aqua_amount - pol_aqua;          // 90% AQUA to ICE for governance
        
        let blub_minted = (aqua_amount * 11) / 10;      // 1.1x AQUA amount
        let blub_staked = aqua_amount;                   // 1x AQUA amount staked
        let blub_to_lp = blub_minted - blub_staked;     // 0.1x AQUA amount to LP
        
        Ok((blub_minted, blub_staked, blub_to_lp, pol_aqua, ice_aqua))
    }

    /// Retrieves the available POL balance that can be deposited to the LP pool.
    ///
    /// Calculates available POL by subtracting currently locked/staked amounts from total balances.
    ///
    /// # Returns
    /// * `Ok((i128, i128))` - A tuple of (available_aqua, available_blub)
    /// * `Err(Error)` if unable to retrieve state
    pub fn get_available_pol_balance(env: Env) -> Result<(i128, i128), Error> {
        let cfg = Self::get_config(env.clone())?;
        let contract_address = env.current_contract_address();
        
        use soroban_sdk::token;
        let aqua_client = token::Client::new(&env, &cfg.aqua_token);
        let blub_client = token::Client::new(&env, &cfg.blub_token);
        
        let aqua_balance = aqua_client.balance(&contract_address);
        let blub_balance = blub_client.balance(&contract_address);
        
        let global_state = Self::get_global_state(env.clone())?;
        let _pol = Self::get_pol(&env);
        
        // Available POL = total contributed - already deposited
        let available_aqua = aqua_balance.saturating_sub(global_state.total_locked);
        let available_blub = blub_balance.saturating_sub(global_state.total_blub_supply);
        
        Ok((available_aqua, available_blub))
    }

    /// Processes pending stake entries in batches.
    ///
    /// This function avoids reentrancy by processing stakes in a separate transaction.
    ///
    /// # Arguments
    /// * `max_count` - Maximum number of pending stakes to process (capped at 10)
    ///
    /// # Returns
    /// * `Ok(u32)` - The number of stakes actually processed
    /// * `Err(Error)` if processing fails
    pub fn process_pending_stakes(env: Env, max_count: u32) -> Result<u32, Error> {
        let pending_count: u32 = env.storage().instance().get(&DataKey::PendingStakeCount).unwrap_or(0);
        
        let mut processed = 0u32;
        let process_limit = max_count.min(pending_count).min(10);
        
        // Get global state to access lock counter
        let mut global_state = Self::get_global_state(env.clone())?;
        
        for i in 0..process_limit {
            if let Some(mut pending) = env.storage().instance().get::<DataKey, PendingStake>(&DataKey::PendingStakeByIndex(i)) {
                if !pending.processed {
                    let now = env.ledger().timestamp();
                    
                    // Get and increment lock counter
                    let lock_id = global_state.lock_counter;
                    global_state.lock_counter = global_state.lock_counter.saturating_add(1);
                    
                    let _ = Self::create_blub_stake_entry(
                        &env,
                        pending.user.clone(),
                        pending.amount,
                        pending.duration_minutes,
                        now,
                        lock_id,
                    );
                    
                    pending.processed = true;
                    env.storage().instance().set(&DataKey::PendingStakeByIndex(i), &pending);
                    
                    env.events().publish(
                        (symbol_short!("stk_proc"), pending.user.clone()),
                        (pending.amount, i),
                    );
                    
                    processed += 1;
                }
            }
        }
        
        // Save updated global state with new lock counter
        env.storage().instance().set(&DataKey::GlobalState, &global_state);
        
        Ok(processed)
    }

    /// Retrieves the total number of pending stake entries.
    ///
    /// # Returns
    /// The count of pending stake entries (0 if none)
    pub fn get_pending_stake_count(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::PendingStakeCount).unwrap_or(0)
    }

    /// Retrieves a specific pending stake entry by index.
    ///
    /// # Arguments
    /// * `index` - The index of the pending stake entry
    ///
    /// # Returns
    /// * `Some(PendingStake)` if the entry exists
    /// * `None` if the entry doesn't exist
    pub fn get_pending_stake(env: Env, index: u32) -> Option<PendingStake> {
        env.storage().instance().get(&DataKey::PendingStakeByIndex(index))
    }

    // ============================================================================
    // ADMIN FUNCTIONS - Staking Period Configuration
    // ============================================================================

    /// Updates the staking period unit in minutes (admin-only).
    ///
    /// # Arguments
    /// * `admin` - The admin address authorizing this operation
    /// * `period_unit_minutes` - The new period unit in minutes (must be > 0)
    ///
    /// # Returns
    /// * `Ok(())` on success
    /// * `Err(Error::Unauthorized)` if caller is not the admin
    /// * `Err(Error::InvalidPeriod)` if period_unit_minutes is 0
    ///
    /// # Authorization
    /// Requires authorization from the `admin` address.
    pub fn update_period_unit(
        env: Env,
        admin: Address,
        period_unit_minutes: u64,
    ) -> Result<(), Error> {
        admin.require_auth();

        let mut config = Self::get_config(env.clone())?;
        
        if config.admin != admin {
            return Err(Error::Unauthorized);
        }

        if period_unit_minutes == 0 {
            return Err(Error::InvalidPeriod);
        }

        config.period_unit_minutes = period_unit_minutes;
        env.storage().instance().set(&DataKey::Config, &config);

        env.events().publish(
            (symbol_short!("period_up"),),
            period_unit_minutes,
        );

        Ok(())
    }

    // ============================================================================
    // USER STAKING INFO
    // ===========================================================================

    /// Retrieves comprehensive staking information for a user.
    ///
    /// # Arguments
    /// * `user` - The address of the user
    ///
    /// # Returns
    /// * `Ok(UserStakingInfo)` - Detailed staking information including:
    ///   - total_staked_blub: Total BLUB currently locked/staked
    ///   - unstaking_available: BLUB available to unstake (from unlocked positions)
    ///   - accumulated_rewards: Total accumulated rewards
    ///   - pending_rewards: Rewards not yet accumulated
    ///   - total_locked_entries: Number of currently locked positions
    ///   - total_unlocked_entries: Number of unlocked positions ready to unstake
    /// * `Err(Error)` if calculation fails
    pub fn get_user_staking_info(env: Env, user: Address) -> Result<UserStakingInfo, Error> {
        
        let user_locks: Vec<Bytes> = env
            .storage()
            .persistent()
            .get(&DataKey::UserLocks(user.clone()))
            .unwrap_or(Vec::new(&env));

        let mut total_staked_blub = 0i128;
        let mut unstaking_available = 0i128;
        let mut total_locked_entries = 0u32;
        let mut total_unlocked_entries = 0u32;

        for i in 0..user_locks.len() {
            if let Some(tx_hash) = user_locks.get(i) {
                if let Some(entry) = env.storage().persistent().get::<DataKey, LockEntry>(&DataKey::UserLockByTxHash(user.clone(), tx_hash)) {
                    if entry.unlocked {
                        // Already unstaked - count as available
                        unstaking_available = unstaking_available.saturating_add(entry.blub_locked);
                        total_unlocked_entries += 1;
                    } else {
                        // Currently staked - all are immediately unstakable
                        total_staked_blub = total_staked_blub.saturating_add(entry.blub_locked);
                        total_locked_entries += 1;
                    }
                }
            }
        }

        // Get pending rewards from Synthetix reward system (v1.2.0)
        let reward_state = Self::get_reward_state(&env);
        let user_reward_state = Self::get_user_reward_state(&env, &user);
        let pending_rewards = Self::calculate_user_pending_rewards(&reward_state, &user_reward_state);

        Ok(UserStakingInfo {
            total_staked_blub,
            unstaking_available,
            accumulated_rewards: user_reward_state.total_claimed,
            pending_rewards,
            total_locked_entries,
            total_unlocked_entries,
        })
    }

    /// Unstakes tokens and transfers them along with accumulated rewards to the user.
    ///
    /// Users can unstake immediately without waiting for unlock periods.
    /// This function automatically calculates and includes pending rewards.
    ///
    /// # Arguments
    /// * `user` - The address of the user unstaking tokens
    /// * `amount` - The amount of BLUB to unstake
    ///
    /// # Returns
    /// * `Ok(())` on success
    /// * `Err(Error::InvalidInput)` if amount is <= 0
    /// * `Err(Error::NotFound)` if user has no lock entries
    /// * `Err(Error::NoUnlockableAmount)` if no tokens available to unstake
    /// * `Err(Error::ReentrancyDetected)` if a reentrant call is detected
    /// * `Err(Error::InsufficientBalance)` if contract doesn't have enough BLUB
    ///
    /// # Authorization
    /// Requires authorization from the `user` address.
    ///
    /// # State Changes
    /// - Marks lock entries as unlocked
    /// - Updates user lock totals
    /// - Updates global state
    /// - Transfers BLUB and rewards to user
    pub fn unstake(
        env: Env,
        user: Address,
        amount: i128,
    ) -> Result<(), Error> {
        user.require_auth();

        if amount <= 0 {
            return Err(Error::InvalidInput);
        }

        // ===== RE-ENTRANCY GUARD =====
        let mut global_state = Self::get_global_state(env.clone())?;
        if global_state.locked {
            return Err(Error::ReentrancyDetected);
        }
        global_state.locked = true;
        env.storage().instance().set(&DataKey::GlobalState, &global_state);

        let now = env.ledger().timestamp();
        let contract_address = env.current_contract_address();
        let config = Self::get_config(env.clone())?;

        let user_locks: Vec<Bytes> = env
            .storage()
            .persistent()
            .get(&DataKey::UserLocks(user.clone()))
            .unwrap_or(Vec::new(&env));

        if user_locks.is_empty() {
            global_state.locked = false;
            env.storage().instance().set(&DataKey::GlobalState, &global_state);
            return Err(Error::NotFound);
        }

        let mut remaining_amount = amount;
        let mut total_blub_unstaked = 0i128;
        let mut total_aqua_unlocked = 0i128;

        // Find and mark entries for unstaking (with cooldown check)
        for i in 0..user_locks.len() {
            if remaining_amount <= 0 {
                break;
            }

            if let Some(tx_hash) = user_locks.get(i) {
                if let Some(mut entry) = env.storage().persistent().get::<DataKey, LockEntry>(&DataKey::UserLockByTxHash(user.clone(), tx_hash.clone())) {
                    // Check cooldown: lock_timestamp + unstake_cooldown_seconds <= now
                    let cooldown_end = entry.lock_timestamp.saturating_add(config.unstake_cooldown_seconds);
                    let cooldown_passed = now >= cooldown_end;

                    if entry.blub_locked > 0 && cooldown_passed {
                        let unstake_from_entry = remaining_amount.min(entry.blub_locked);
                        let original_blub = entry.blub_locked;

                        total_blub_unstaked = total_blub_unstaked.saturating_add(unstake_from_entry);

                        entry.blub_locked = entry.blub_locked.saturating_sub(unstake_from_entry);

                        // Only mark fully consumed entries as unlocked;
                        // partial unstakes keep the entry active for the remaining balance
                        if entry.blub_locked == 0 {
                            entry.unlocked = true;
                            total_aqua_unlocked = total_aqua_unlocked.saturating_add(entry.amount);
                        } else {
                            // Proportional AQUA unlock for partial unstake
                            let proportional_aqua = (entry.amount as i128)
                                .saturating_mul(unstake_from_entry)
                                / (original_blub as i128).max(1);
                            total_aqua_unlocked = total_aqua_unlocked.saturating_add(proportional_aqua as i128);
                        }

                        env.storage().persistent().set(&DataKey::UserLockByTxHash(user.clone(), tx_hash), &entry);

                        remaining_amount = remaining_amount.saturating_sub(unstake_from_entry);
                    }
                }
            }
        }

        if total_blub_unstaked == 0 {
            global_state.locked = false;
            env.storage().instance().set(&DataKey::GlobalState, &global_state);
            return Err(Error::NoUnlockableAmount);
        }

        // Transfer unstaked BLUB to user
        // Rewards are claimed separately via claim_rewards() (Synthetix system)
        if total_blub_unstaked > 0 {
            use soroban_sdk::token;
            let blub_client = token::Client::new(&env, &config.blub_token);
            let transfer_result = blub_client.try_transfer(&contract_address, &user, &total_blub_unstaked);
            if transfer_result.is_err() {
                global_state.locked = false;
                env.storage().instance().set(&DataKey::GlobalState, &global_state);
                return Err(Error::InsufficientBalance);
            }
        }

        // Update per-user lock totals
        let mut totals: LockTotals = env
            .storage()
            .persistent()
            .get(&DataKey::UserLockTotals(user.clone()))
            .unwrap_or(LockTotals {
                total_locked_aqua: 0,
                total_blub_minted: 0,
                total_entries: 0,
                last_update_ts: 0,
                accumulated_rewards: 0,
            });
        totals.total_locked_aqua = totals.total_locked_aqua.saturating_sub(total_aqua_unlocked).max(0);
        totals.total_blub_minted = totals.total_blub_minted.saturating_sub(total_blub_unstaked).max(0);
        totals.last_update_ts = now;
        env.storage().persistent().set(&DataKey::UserLockTotals(user.clone()), &totals);

        // Update global state directly (avoid helper overwrite bug)
        global_state.total_locked = global_state.total_locked.saturating_sub(total_aqua_unlocked).max(0);
        global_state.total_blub_supply = global_state.total_blub_supply.saturating_sub(total_blub_unstaked).max(0);
        global_state.locked = false;
        env.storage().instance().set(&DataKey::GlobalState, &global_state);

        env.events().publish(
            (symbol_short!("unstake"), user.clone()),
            total_blub_unstaked,
        );

        // ===== SYNC REWARD BALANCE (v1.2.0) =====
        // Checkpoint and update user's staked balance for reward tracking
        let new_total_staked = Self::get_user_total_staked_blub(&env, &user);
        Self::sync_user_reward_balance(&env, &user, new_total_staked);

        Ok(())
    }

    // ============================================================================
    // SYNTHETIX-STYLE REWARD SYSTEM (v1.2.0)
    // ============================================================================

    /// Internal: Get the global reward state
    fn get_reward_state(env: &Env) -> RewardState {
        env.storage()
            .instance()
            .get(&DataKey::RewardStateV2)
            .unwrap_or(RewardState {
                reward_per_token_stored: 0,
                last_update_time: env.ledger().timestamp(),
                total_staked: 0,
                total_rewards_added: 0,
                total_rewards_claimed: 0,
            })
    }

    /// Internal: Require manager authorization.
    /// Falls back to admin if ManagerAddress is not yet set (pre-migration).
    fn require_manager_auth(env: &Env, manager: &Address) -> Result<(), Error> {
        manager.require_auth();
        let stored = env.storage()
            .instance()
            .get::<DataKey, Address>(&DataKey::ManagerAddress);
        match stored {
            Some(op) => {
                if op != *manager {
                    return Err(Error::Unauthorized);
                }
            }
            None => {
                // Pre-migration: fall back to admin check
                let stored_admin = env.storage()
                    .instance()
                    .get::<DataKey, Address>(&DataKey::AdminAddress)
                    .ok_or(Error::Unauthorized)?;
                if stored_admin != *manager {
                    return Err(Error::Unauthorized);
                }
            }
        }
        Ok(())
    }

    /// Internal: Get a user's reward state
    fn get_user_reward_state(env: &Env, user: &Address) -> UserRewardState {
        env.storage()
            .persistent()
            .get(&DataKey::UserRewardStateV2(user.clone()))
            .unwrap_or(UserRewardState {
                staked_balance: 0,
                reward_per_token_paid: 0,
                rewards_earned: 0,
                last_claim_time: 0,
                total_claimed: 0,
            })
    }

    // get_user_reward_state removed - not needed for fresh deployment
    // Use get_user_reward_state directly instead

    /// Internal: Calculate pending rewards for a user
    /// Formula: earned = balance * (reward_per_token - user_paid) / PRECISION + user_earned
    fn calculate_user_pending_rewards(
        reward_state: &RewardState,
        user_state: &UserRewardState,
    ) -> i128 {
        if user_state.staked_balance == 0 {
            return user_state.rewards_earned;
        }

        let reward_delta = reward_state
            .reward_per_token_stored
            .saturating_sub(user_state.reward_per_token_paid);

        let new_rewards = user_state
            .staked_balance
            .saturating_mul(reward_delta)
            / REWARD_PRECISION;

        user_state.rewards_earned.saturating_add(new_rewards)
    }

    /// Internal: Checkpoint a user's rewards before any balance change
    /// This MUST be called BEFORE changing a user's staked balance
    /// It locks in all earned rewards up to this point
    fn checkpoint_user_internal(
        env: &Env,
        user: &Address,
        reward_state: &RewardState,
    ) -> UserRewardState {
        let mut user_state = Self::get_user_reward_state(env, user);

        // Calculate and save earned rewards based on current staked_balance
        user_state.rewards_earned =
            Self::calculate_user_pending_rewards(reward_state, &user_state);

        // Update the user's paid reward_per_token to current
        user_state.reward_per_token_paid = reward_state.reward_per_token_stored;

        // Save user state
        env.storage()
            .persistent()
            .set(&DataKey::UserRewardStateV2(user.clone()), &user_state);

        user_state
    }

    /// Internal: Update user's staked balance after checkpoint
    /// Called after checkpoint_user_internal
    fn update_user_staked_balance(
        env: &Env,
        user: &Address,
        new_balance: i128,
        reward_state: &mut RewardState,
        old_balance: i128,
    ) {
        let mut user_state = Self::get_user_reward_state(env, user);

        // Update global total_staked
        reward_state.total_staked = reward_state
            .total_staked
            .saturating_sub(old_balance)
            .saturating_add(new_balance);

        // Update user's staked balance
        user_state.staked_balance = new_balance;

        // Save both states
        env.storage()
            .instance()
            .set(&DataKey::RewardStateV2, reward_state);
        env.storage()
            .persistent()
            .set(&DataKey::UserRewardStateV2(user.clone()), &user_state);
    }

    /// Backend calls this to add BLUB rewards to the pool
    /// The rewards are distributed proportionally to all stakers based on their share
    ///
    /// # Arguments
    /// * `admin` - Admin address for authorization
    /// * `amount` - Amount of BLUB rewards to add
    ///
    /// # Authorization
    /// Requires admin authorization
    pub fn add_rewards(env: Env, manager: Address, amount: i128) -> Result<(), Error> {
        let config = Self::get_config(env.clone())?;
        Self::require_manager_auth(&env, &manager)?;

        if amount <= 0 {
            return Err(Error::InvalidInput);
        }

        // Hard cap: 100,000 BLUB (7 decimals) per call
        const MAX_BLUB_PER_CALL: i128 = 1_000_000_000_000;
        if amount > MAX_BLUB_PER_CALL {
            return Err(Error::InvalidInput);
        }

        let contract_address = env.current_contract_address();
        let mut reward_state = Self::get_reward_state(&env);
        let now = env.ledger().timestamp();

        // Transfer BLUB from manager to contract
        use soroban_sdk::token;
        let blub_client = token::Client::new(&env, &config.blub_token);
        let transfer_result = blub_client.try_transfer(&manager, &contract_address, &amount);
        if transfer_result.is_err() {
            return Err(Error::InsufficientBalance);
        }

        // Update reward_per_token: how much reward each token earns
        // Only update if there are stakers
        if reward_state.total_staked > 0 {
            let reward_per_token_increase = amount
                .saturating_mul(REWARD_PRECISION)
                / reward_state.total_staked;

            reward_state.reward_per_token_stored = reward_state
                .reward_per_token_stored
                .saturating_add(reward_per_token_increase);
        }

        reward_state.total_rewards_added = reward_state
            .total_rewards_added
            .saturating_add(amount);
        reward_state.last_update_time = now;

        env.storage()
            .instance()
            .set(&DataKey::RewardStateV2, &reward_state);

        // Emit event
        let event = RewardsAddedEvent {
            amount,
            total_staked: reward_state.total_staked,
            reward_per_token: reward_state.reward_per_token_stored,
            timestamp: now,
        };
        env.events().publish((symbol_short!("rwd_add"),), event);

        Ok(())
    }

    /// Emergency: drain incorrectly added BLUB and reset reward accumulator.
    ///
    /// Call this when `add_rewards` was accidentally called with a bad amount
    /// (e.g. the BLUB issuer's sentinel balance i64::MAX). The function:
    ///   1. Transfers all BLUB currently held by the contract back to `admin`.
    ///   2. Resets `reward_per_token_stored` to `correct_reward_per_token`.
    ///   3. Resets `total_rewards_added` to `correct_total_rewards_added`.
    ///
    /// Per-user states (reward_per_token_paid, rewards_earned) are NOT modified.
    /// Users who had already checkpointed against the corrupted accumulator will
    /// see 0 pending rewards until new legitimate rewards are added (safe outcome).
    ///
    /// # Authorization
    /// Requires admin (multisig) auth.
    pub fn admin_emergency_reset_rewards(
        env: Env,
        admin: Address,
        correct_reward_per_token: i128,
        correct_total_rewards_added: i128,
    ) -> Result<i128, Error> {
        admin.require_auth();
        let stored_admin = env
            .storage()
            .instance()
            .get::<DataKey, Address>(&DataKey::AdminAddress)
            .ok_or(Error::Unauthorized)?;
        if stored_admin != admin {
            return Err(Error::Unauthorized);
        }

        let config = Self::get_config(env.clone())?;
        let contract_address = env.current_contract_address();

        use soroban_sdk::token;
        let blub_client = token::Client::new(&env, &config.blub_token);
        let blub_balance = blub_client.balance(&contract_address);

        // Burn BLUB directly from the contract — no trustline required on any account.
        // The contract self-authorizes the burn since it is the token holder.
        if blub_balance > 0 {
            blub_client.burn(&contract_address, &blub_balance);
        }

        // Reset the global reward accumulator to the correct pre-corruption values
        let mut reward_state = Self::get_reward_state(&env);
        reward_state.reward_per_token_stored = correct_reward_per_token;
        reward_state.total_rewards_added = correct_total_rewards_added;
        reward_state.last_update_time = env.ledger().timestamp();

        env.storage()
            .instance()
            .set(&DataKey::RewardStateV2, &reward_state);

        env.events().publish(
            (symbol_short!("emrg_rst"),),
            blub_balance,
        );

        Ok(blub_balance)
    }

    /// Accepts AQUA protocol revenue and mints equivalent BLUB as staker rewards.
    ///
    /// The admin specifies both the AQUA amount (protocol revenue collected) and
    /// the BLUB reward amount (based on off-chain market rate lookup). The AQUA is
    /// transferred to the contract (tracked as POL), and BLUB is minted and
    /// distributed to stakers via the Synthetix reward accumulator.
    ///
    /// # Arguments
    /// * `admin` - Admin address (must match config.admin)
    /// * `aqua_amount` - Amount of AQUA to transfer from admin to contract
    /// * `blub_reward_amount` - Amount of BLUB to mint as staker rewards
    ///
    /// # Returns
    /// * `Ok(())` on success
    /// * `Err(Unauthorized)` if caller is not admin
    /// * `Err(InvalidInput)` if either amount <= 0
    /// * `Err(InsufficientBalance)` if AQUA transfer fails
    pub fn add_rewards_from_aqua(
        env: Env,
        manager: Address,
        aqua_amount: i128,
        blub_reward_amount: i128,
    ) -> Result<(), Error> {
        let config = Self::get_config(env.clone())?;
        Self::require_manager_auth(&env, &manager)?;

        if aqua_amount <= 0 || blub_reward_amount <= 0 {
            return Err(Error::InvalidInput);
        }

        // Hard cap: 100,000 BLUB (7 decimals) per call
        const MAX_BLUB_PER_CALL: i128 = 1_000_000_000_000;
        if blub_reward_amount > MAX_BLUB_PER_CALL {
            return Err(Error::InvalidInput);
        }

        let contract_address = env.current_contract_address();
        let mut reward_state = Self::get_reward_state(&env);
        let now = env.ledger().timestamp();

        // Transfer AQUA from manager to contract
        use soroban_sdk::token;
        let aqua_client = token::Client::new(&env, &config.aqua_token);
        let transfer_result = aqua_client.try_transfer(&manager, &contract_address, &aqua_amount);
        if transfer_result.is_err() {
            return Err(Error::InsufficientBalance);
        }

        // Transfer BLUB from manager to contract (manager swaps AQUA→BLUB on AMM off-chain)
        let blub_client = token::Client::new(&env, &config.blub_token);
        let blub_transfer_result = blub_client.try_transfer(&manager, &contract_address, &blub_reward_amount);
        if blub_transfer_result.is_err() {
            return Err(Error::InsufficientBalance);
        }

        // Future: mint BLUB directly instead of transferring (when minting is enabled)
        // let blub_sac_client = token::StellarAssetClient::new(&env, &config.blub_token);
        // blub_sac_client.mint(&contract_address, &blub_reward_amount);

        // Update reward_per_token (same math as add_rewards)
        if reward_state.total_staked > 0 {
            let reward_per_token_increase = blub_reward_amount
                .saturating_mul(REWARD_PRECISION)
                / reward_state.total_staked;

            reward_state.reward_per_token_stored = reward_state
                .reward_per_token_stored
                .saturating_add(reward_per_token_increase);
        }

        reward_state.total_rewards_added = reward_state
            .total_rewards_added
            .saturating_add(blub_reward_amount);
        reward_state.last_update_time = now;

        env.storage()
            .instance()
            .set(&DataKey::RewardStateV2, &reward_state);

        // Track AQUA in Protocol Owned Liquidity
        let mut pol = Self::get_pol(&env);
        pol.total_aqua_contributed = pol.total_aqua_contributed.saturating_add(aqua_amount);
        env.storage()
            .instance()
            .set(&DataKey::ProtocolOwnedLiquidity, &pol);

        // Emit event
        let event = AquaRewardsConvertedEvent {
            aqua_amount,
            blub_reward_amount,
            total_staked: reward_state.total_staked,
            reward_per_token: reward_state.reward_per_token_stored,
            timestamp: now,
        };
        env.events()
            .publish((symbol_short!("rwd_aqua"),), event);

        Ok(())
    }

    /// User claims their accumulated BLUB rewards
    /// Subject to claim cooldown (default 7 days)
    ///
    /// # Arguments
    /// * `user` - User address claiming rewards
    ///
    /// # Returns
    /// * `Ok(i128)` - Amount of rewards claimed
    /// * `Err(ClaimCooldownActive)` - If cooldown hasn't elapsed
    /// * `Err(NoRewardsToClaim)` - If no rewards available
    pub fn claim_rewards(env: Env, user: Address) -> Result<i128, Error> {
        user.require_auth();

        let config = Self::get_config(env.clone())?;
        let now = env.ledger().timestamp();

        // Get current states (with migration fix for pre-migration stakers)
        let reward_state = Self::get_reward_state(&env);
        let mut user_state = Self::get_user_reward_state(&env, &user);

        // Check cooldown
        let cooldown_end = user_state
            .last_claim_time
            .saturating_add(config.claim_reward_cooldown_seconds);
        if now < cooldown_end && user_state.last_claim_time > 0 {
            return Err(Error::ClaimCooldownActive);
        }

        // Calculate pending rewards
        let pending = Self::calculate_user_pending_rewards(&reward_state, &user_state);

        if pending <= 0 {
            return Err(Error::NoRewardsToClaim);
        }

        // Update user state
        user_state.rewards_earned = 0;
        user_state.reward_per_token_paid = reward_state.reward_per_token_stored;
        user_state.last_claim_time = now;
        user_state.total_claimed = user_state.total_claimed.saturating_add(pending);

        // Update global claimed amount
        let mut reward_state_mut = reward_state.clone();
        reward_state_mut.total_rewards_claimed = reward_state_mut
            .total_rewards_claimed
            .saturating_add(pending);

        // Save states
        env.storage()
            .instance()
            .set(&DataKey::RewardStateV2, &reward_state_mut);
        env.storage()
            .persistent()
            .set(&DataKey::UserRewardStateV2(user.clone()), &user_state);

        // Transfer rewards to user
        use soroban_sdk::token;
        let blub_client = token::Client::new(&env, &config.blub_token);
        let contract_address = env.current_contract_address();
        let transfer_result = blub_client.try_transfer(&contract_address, &user, &pending);
        if transfer_result.is_err() {
            return Err(Error::InsufficientBalance);
        }

        // Emit event
        let event = RewardsClaimedEvent {
            user: user.clone(),
            amount: pending,
            total_claimed: user_state.total_claimed,
            timestamp: now,
        };
        env.events().publish((symbol_short!("rwd_clm"),), event);

        Ok(pending)
    }

    /// View function: Get user's pending rewards (without claiming)
    ///
    /// # Arguments
    /// * `user` - User address to check
    ///
    /// # Returns
    /// Amount of pending BLUB rewards
    pub fn get_pending_rewards(env: Env, user: Address) -> i128 {
        let reward_state = Self::get_reward_state(&env);
        let user_state = Self::get_user_reward_state(&env, &user);
        Self::calculate_user_pending_rewards(&reward_state, &user_state)
    }

    /// View function: Get comprehensive reward info for a user
    ///
    /// # Arguments
    /// * `user` - User address to check
    ///
    /// # Returns
    /// UserRewardInfo with pending, claimed, balance, and cooldown status
    pub fn get_user_reward_info(env: Env, user: Address) -> UserRewardInfo {
        let config = Self::get_config(env.clone()).unwrap_or(Config {
            admin: user.clone(),
            version: 0,
            total_supply: 0,
            treasury_address: user.clone(),
            reward_rate: 0,
            aqua_token: user.clone(),
            blub_token: user.clone(),
            liquidity_contract: user.clone(),
            ice_token: user.clone(),
            govern_ice_token: user.clone(),
            upvote_ice_token: user.clone(),
            downvote_ice_token: user.clone(),
            period_unit_minutes: 1,
            vault_treasury: user.clone(),
            vault_fee_bps: 0,
            unstake_cooldown_seconds: 864000,
            claim_reward_cooldown_seconds: 604800,
        });

        let now = env.ledger().timestamp();
        let reward_state = Self::get_reward_state(&env);
        let user_state = Self::get_user_reward_state(&env, &user);

        let pending = Self::calculate_user_pending_rewards(&reward_state, &user_state);
        let claim_available_at = user_state
            .last_claim_time
            .saturating_add(config.claim_reward_cooldown_seconds);
        let can_claim = now >= claim_available_at || user_state.last_claim_time == 0;

        UserRewardInfo {
            pending_rewards: pending,
            total_claimed: user_state.total_claimed,
            staked_balance: user_state.staked_balance,
            last_claim_time: user_state.last_claim_time,
            can_claim: can_claim && pending > 0,
            claim_available_at,
        }
    }

    /// View function: Check if a specific lock entry can be unstaked
    ///
    /// # Arguments
    /// * `user` - User address
    /// * `lock_index` - Index of the lock entry
    ///
    /// # Returns
    /// UnstakeStatus with availability info
    pub fn get_unstake_status(env: Env, user: Address, lock_index: u32) -> UnstakeStatus {
        let config = Self::get_config(env.clone()).unwrap_or(Config {
            admin: user.clone(),
            version: 0,
            total_supply: 0,
            treasury_address: user.clone(),
            reward_rate: 0,
            aqua_token: user.clone(),
            blub_token: user.clone(),
            liquidity_contract: user.clone(),
            ice_token: user.clone(),
            govern_ice_token: user.clone(),
            upvote_ice_token: user.clone(),
            downvote_ice_token: user.clone(),
            period_unit_minutes: 1,
            vault_treasury: user.clone(),
            vault_fee_bps: 0,
            unstake_cooldown_seconds: 864000,
            claim_reward_cooldown_seconds: 604800,
        });

        let now = env.ledger().timestamp();

        let user_locks: Vec<Bytes> = env
            .storage()
            .persistent()
            .get(&DataKey::UserLocks(user.clone()))
            .unwrap_or(Vec::new(&env));

        if let Some(tx_hash) = user_locks.get(lock_index) {
            if let Some(entry) = env
                .storage()
                .persistent()
                .get::<DataKey, LockEntry>(&DataKey::UserLockByTxHash(user, tx_hash))
            {
                let unstake_available_at = entry
                    .lock_timestamp
                    .saturating_add(config.unstake_cooldown_seconds);
                let can_unstake = now >= unstake_available_at && entry.blub_locked > 0;

                return UnstakeStatus {
                    can_unstake,
                    unstake_available_at,
                    blub_amount: entry.blub_locked,
                };
            }
        }

        UnstakeStatus {
            can_unstake: false,
            unstake_available_at: 0,
            blub_amount: 0,
        }
    }

    /// Get the global reward state (view function)
    pub fn get_reward_state_view(env: Env) -> RewardState {
        Self::get_reward_state(&env)
    }

    /// Admin: Update the unstake cooldown period
    ///
    /// # Arguments
    /// * `admin` - Admin address
    /// * `cooldown_seconds` - New cooldown in seconds
    pub fn update_unstake_cooldown(
        env: Env,
        admin: Address,
        cooldown_seconds: u64,
    ) -> Result<(), Error> {
        admin.require_auth();

        let mut config = Self::get_config(env.clone())?;
        if config.admin != admin {
            return Err(Error::Unauthorized);
        }

        config.unstake_cooldown_seconds = cooldown_seconds;
        env.storage().instance().set(&DataKey::Config, &config);

        env.events().publish(
            (symbol_short!("cfg_upd"),),
            (symbol_short!("unstk_cd"), cooldown_seconds),
        );

        Ok(())
    }

    /// Admin: Update the claim reward cooldown period
    ///
    /// # Arguments
    /// * `admin` - Admin address
    /// * `cooldown_seconds` - New cooldown in seconds
    pub fn update_claim_cooldown(
        env: Env,
        admin: Address,
        cooldown_seconds: u64,
    ) -> Result<(), Error> {
        admin.require_auth();

        let mut config = Self::get_config(env.clone())?;
        if config.admin != admin {
            return Err(Error::Unauthorized);
        }

        config.claim_reward_cooldown_seconds = cooldown_seconds;
        env.storage().instance().set(&DataKey::Config, &config);

        env.events().publish(
            (symbol_short!("cfg_upd"),),
            (symbol_short!("clm_cd"), cooldown_seconds),
        );

        Ok(())
    }

    /// Internal helper: Checkpoint and update staked balance for reward tracking
    /// Call this after modifying a user's staked BLUB balance
    fn sync_user_reward_balance(env: &Env, user: &Address, new_blub_balance: i128) {
        let mut reward_state = Self::get_reward_state(env);
        let user_state = Self::checkpoint_user_internal(env, user, &reward_state);
        let old_balance = user_state.staked_balance;
        Self::update_user_staked_balance(env, user, new_blub_balance, &mut reward_state, old_balance);
    }

    /// Get user's total staked BLUB from all lock entries
    fn get_user_total_staked_blub(env: &Env, user: &Address) -> i128 {
        let user_locks: Vec<Bytes> = env
            .storage()
            .persistent()
            .get(&DataKey::UserLocks(user.clone()))
            .unwrap_or(Vec::new(env));

        let mut total = 0i128;
        for i in 0..user_locks.len() {
            if let Some(tx_hash) = user_locks.get(i) {
                if let Some(entry) = env
                    .storage()
                    .persistent()
                    .get::<DataKey, LockEntry>(&DataKey::UserLockByTxHash(user.clone(), tx_hash))
                {
                    if entry.blub_locked > 0 {
                        total = total.saturating_add(entry.blub_locked);
                    }
                }
            }
        }
        total
    }

    // ============================================================================
    // ICE LOCKING FUNCTIONS (Request 1)
    // ============================================================================

    /// One-time setup to establish trustlines for all 4 ICE token types.
    /// Must be called by admin before contract can receive ICE tokens.
    ///
    /// # Authorization
    /// Requires admin authorization
    pub fn setup_ice_trustlines(env: Env, manager: Address) -> Result<(), Error> {
        let config = Self::get_config(env.clone())?;
        Self::require_manager_auth(&env, &manager)?;

        use soroban_sdk::token;
        let contract_address = env.current_contract_address();

        // Establish trustlines by calling balance() on each SAC token
        // This ensures the contract can receive these tokens
        let ice_client = token::Client::new(&env, &config.ice_token);
        let _ = ice_client.balance(&contract_address);

        let govern_ice_client = token::Client::new(&env, &config.govern_ice_token);
        let _ = govern_ice_client.balance(&contract_address);

        let upvote_ice_client = token::Client::new(&env, &config.upvote_ice_token);
        let _ = upvote_ice_client.balance(&contract_address);

        let downvote_ice_client = token::Client::new(&env, &config.downvote_ice_token);
        let _ = downvote_ice_client.balance(&contract_address);

        env.events().publish(
            (symbol_short!("ice_tl"),),
            symbol_short!("setup"),
        );

        Ok(())
    }

    /// Authorizes an ICE lock for a specific amount and duration.
    /// Backend cron will execute the actual locking on Stellar Classic.
    ///
    /// # Arguments
    /// * `aqua_amount` - Amount of AQUA to lock for ICE
    /// * `duration_years` - Lock duration (1-5 years)
    ///
    /// # Returns
    /// Lock ID for tracking
    ///
    /// # Authorization
    /// Requires admin authorization
    pub fn authorize_ice_lock(
        env: Env,
        manager: Address,
        aqua_amount: i128,
        duration_years: u64,
    ) -> Result<u64, Error> {
        let config = Self::get_config(env.clone())?;
        Self::require_manager_auth(&env, &manager)?;

        if aqua_amount <= 0 || duration_years == 0 || duration_years > 5 {
            return Err(Error::InvalidInput);
        }

        let mut global_state: GlobalState = env
            .storage()
            .instance()
            .get(&DataKey::GlobalState)
            .ok_or(Error::NotInitialized)?;

        if global_state.pending_aqua_for_ice < aqua_amount {
            return Err(Error::InsufficientPendingAqua);
        }

        let lock_id = global_state.ice_lock_counter;
        global_state.ice_lock_counter += 1;

        let authorization = IceLockAuthorization {
            lock_id,
            aqua_amount,
            duration_years,
            authorized_at: env.ledger().timestamp(),
            executed: false,
        };

        env.storage()
            .persistent()
            .set(&DataKey::IceLockAuth(lock_id), &authorization);

        env.storage()
            .instance()
            .set(&DataKey::GlobalState, &global_state);

        env.events().publish(
            (symbol_short!("ice_auth"), lock_id),
            (aqua_amount, duration_years),
        );

        Ok(lock_id)
    }

    /// Transfers authorized AQUA from contract to admin for ICE locking.
    /// Backend calls this after authorization to move AQUA to admin wallet,
    /// then creates claimable balance on Stellar Classic.
    ///
    /// # Arguments
    /// * `lock_id` - The authorization ID
    ///
    /// # Authorization
    /// Requires admin authorization
    pub fn transfer_authorized_aqua(env: Env, manager: Address, lock_id: u64) -> Result<(), Error> {
        let config = Self::get_config(env.clone())?; // needed for aqua_token address
        Self::require_manager_auth(&env, &manager)?;

        let mut authorization: IceLockAuthorization = env
            .storage()
            .persistent()
            .get(&DataKey::IceLockAuth(lock_id))
            .ok_or(Error::NotFound)?;

        if authorization.executed {
            return Err(Error::AlreadyExecuted);
        }

        let mut global_state: GlobalState = env
            .storage()
            .instance()
            .get(&DataKey::GlobalState)
            .ok_or(Error::NotInitialized)?;

        if global_state.pending_aqua_for_ice < authorization.aqua_amount {
            return Err(Error::InsufficientPendingAqua);
        }

        // Transfer AQUA to admin wallet
        use soroban_sdk::token;
        let aqua_client = token::Client::new(&env, &config.aqua_token);
        let contract_address = env.current_contract_address();

        aqua_client.transfer(
            &contract_address,
            &manager,
            &authorization.aqua_amount,
        );

        // Update state
        global_state.pending_aqua_for_ice = global_state
            .pending_aqua_for_ice
            .saturating_sub(authorization.aqua_amount);
        authorization.executed = true;

        env.storage()
            .persistent()
            .set(&DataKey::IceLockAuth(lock_id), &authorization);
        env.storage()
            .instance()
            .set(&DataKey::GlobalState, &global_state);

        env.events().publish(
            (symbol_short!("ice_xfer"), lock_id),
            authorization.aqua_amount,
        );

        Ok(())
    }

    /// Syncs all ICE token balances from SAC contracts.
    /// Backend calls this after ICE tokens are received.
    ///
    /// # Authorization
    /// Requires admin authorization
    pub fn sync_all_ice_balances(env: Env, manager: Address) -> Result<(), Error> {
        let config = Self::get_config(env.clone())?;
        Self::require_manager_auth(&env, &manager)?;

        use soroban_sdk::token;
        let contract_address = env.current_contract_address();

        let ice_client = token::Client::new(&env, &config.ice_token);
        let ice_balance = ice_client.balance(&contract_address);

        let govern_ice_client = token::Client::new(&env, &config.govern_ice_token);
        let govern_ice_balance = govern_ice_client.balance(&contract_address);

        let upvote_ice_client = token::Client::new(&env, &config.upvote_ice_token);
        let upvote_ice_balance = upvote_ice_client.balance(&contract_address);

        let downvote_ice_client = token::Client::new(&env, &config.downvote_ice_token);
        let downvote_ice_balance = downvote_ice_client.balance(&contract_address);

        let mut global_state: GlobalState = env
            .storage()
            .instance()
            .get(&DataKey::GlobalState)
            .ok_or(Error::NotInitialized)?;

        global_state.ice_balance = ice_balance;
        global_state.govern_ice_balance = govern_ice_balance;
        global_state.upvote_ice_balance = upvote_ice_balance;
        global_state.downvote_ice_balance = downvote_ice_balance;

        env.storage()
            .instance()
            .set(&DataKey::GlobalState, &global_state);

        env.events().publish(
            (symbol_short!("ice_sync"),),
            (ice_balance, govern_ice_balance, upvote_ice_balance, downvote_ice_balance),
        );

        Ok(())
    }

    // ============================================================================
    // VAULT FUNCTIONS (Request 2 - Boost Farming)
    // ============================================================================

    /// Adds a new pool to the vault (max 10 pools).
    ///
    /// # Arguments
    /// * `pool_address` - Aquarius pool contract address
    /// * `token_a` - First token in the pair
    /// * `token_b` - Second token in the pair
    /// * `share_token` - LP token address
    ///
    /// # Authorization
    /// Requires admin authorization
    pub fn add_pool(
        env: Env,
        manager: Address,
        pool_address: Address,
        token_a: Address,
        token_b: Address,
        share_token: Address,
    ) -> Result<u32, Error> {
        Self::require_manager_auth(&env, &manager)?;

        let mut global_state: GlobalState = env
            .storage()
            .instance()
            .get(&DataKey::GlobalState)
            .ok_or(Error::NotInitialized)?;

        if global_state.pool_count >= 10 {
            return Err(Error::MaxPoolsReached);
        }

        let pool_id = global_state.pool_count;
        global_state.pool_count += 1;

        let pool_info = PoolInfo {
            pool_id,
            pool_address: pool_address.clone(),
            token_a: token_a.clone(),
            token_b: token_b.clone(),
            share_token: share_token.clone(),
            total_lp_tokens: 0,
            active: true,
            added_at: env.ledger().timestamp(),
        };

        env.storage()
            .persistent()
            .set(&DataKey::PoolInfo(pool_id), &pool_info);

        env.storage()
            .instance()
            .set(&DataKey::GlobalState, &global_state);

        env.events().publish(
            (symbol_short!("pool_add"), pool_id),
            (pool_address, token_a, token_b),
        );

        Ok(pool_id)
    }

    /// Updates a pool's active status.
    ///
    /// # Authorization
    /// Requires admin authorization
    pub fn update_pool_status(env: Env, pool_id: u32, active: bool) -> Result<(), Error> {
        let config = Self::get_config(env.clone())?;
        config.admin.require_auth();

        let mut pool_info: PoolInfo = env
            .storage()
            .persistent()
            .get(&DataKey::PoolInfo(pool_id))
            .ok_or(Error::PoolNotFound)?;

        pool_info.active = active;

        env.storage()
            .persistent()
            .set(&DataKey::PoolInfo(pool_id), &pool_info);

        env.events().publish(
            (symbol_short!("pool_upd"), pool_id),
            active,
        );

        Ok(())
    }

    /// Deposits tokens to a vault pool.
    /// User deposits token_a + token_b, contract adds liquidity to Aquarius pool.
    ///
    /// # Arguments
    /// * `user` - User address
    /// * `pool_id` - Pool ID
    /// * `desired_a` - Amount of token_a to deposit
    /// * `desired_b` - Amount of token_b to deposit
    /// * `min_shares` - Minimum LP shares to receive (slippage protection)
    ///
    /// # Authorization
    /// Requires user authorization
    pub fn vault_deposit(
        env: Env,
        user: Address,
        pool_id: u32,
        desired_a: i128,
        desired_b: i128,
        min_shares: u128,
    ) -> Result<(), Error> {
        user.require_auth();

        if desired_a <= 0 || desired_b <= 0 {
            return Err(Error::InvalidInput);
        }

        let mut pool_info: PoolInfo = env
            .storage()
            .persistent()
            .get(&DataKey::PoolInfo(pool_id))
            .ok_or(Error::PoolNotFound)?;

        if !pool_info.active {
            return Err(Error::PoolNotActive);
        }

        let contract_address = env.current_contract_address();

        // STEP 1: Transfer full desired amounts from user to contract.
        // We transfer the exact function parameters so auth entries are
        // deterministic and won't break if pool reserves shift between
        // simulation and execution.
        use soroban_sdk::token;
        let token_a_client = token::Client::new(&env, &pool_info.token_a);
        let token_b_client = token::Client::new(&env, &pool_info.token_b);

        token_a_client.transfer(&user, &contract_address, &desired_a);
        token_b_client.transfer(&user, &contract_address, &desired_b);

        // STEP 2: Query pool reserves and token order from Aquarius pool.
        let aquarius_pool = AquariusPoolClient::new(&env, &pool_info.pool_address);
        let reserves = aquarius_pool.get_reserves();

        // Determine Aquarius pool token ordering so reserves, auth entries, and
        // deposit amounts all match what the pool expects.
        // token_a_is_idx0 = true  → Aquarius token[0]=token_a, token[1]=token_b
        // token_a_is_idx0 = false → Aquarius token[0]=token_b, token[1]=token_a
        let pool_tokens_result = env.try_invoke_contract::<Vec<Address>, soroban_sdk::Error>(
            &pool_info.pool_address,
            &Symbol::new(&env, "get_tokens"),
            ().into_val(&env),
        );
        let token_a_is_idx0 = match pool_tokens_result {
            Ok(Ok(ref tokens)) if tokens.len() >= 2 => {
                tokens.get(0).unwrap() == pool_info.token_a
            }
            _ => true, // fallback: assume aligned
        };

        // Map reserves to token_a / token_b using Aquarius ordering.
        let (r_a, r_b): (u128, u128) = if reserves.len() >= 2 {
            let r0 = reserves.get(0).unwrap();
            let r1 = reserves.get(1).unwrap();
            if token_a_is_idx0 { (r0, r1) } else { (r1, r0) }
        } else {
            (0, 0)
        };

        let (deposit_a, deposit_b): (i128, i128) = if r_a > 0 && r_b > 0 {
            // Pool has liquidity – calculate proportional amounts.
            let optimal_b = (desired_a as u128)
                .checked_mul(r_b)
                .unwrap_or(0)
                .checked_div(r_a)
                .unwrap_or(0);

            if optimal_b <= desired_b as u128 {
                (desired_a, optimal_b as i128)
            } else {
                let optimal_a = (desired_b as u128)
                    .checked_mul(r_a)
                    .unwrap_or(0)
                    .checked_div(r_b)
                    .unwrap_or(0);
                (optimal_a as i128, desired_b)
            }
        } else {
            (desired_a, desired_b)
        };

        if deposit_a <= 0 || deposit_b <= 0 {
            // Refund everything before failing
            token_a_client.transfer(&contract_address, &user, &desired_a);
            token_b_client.transfer(&contract_address, &user, &desired_b);
            return Err(Error::InvalidInput);
        }

        // STEP 3: Authorize token transfers in the order Aquarius will call them.
        let (auth_token_0, auth_amount_0, auth_token_1, auth_amount_1) = if token_a_is_idx0 {
            (pool_info.token_a.clone(), deposit_a, pool_info.token_b.clone(), deposit_b)
        } else {
            (pool_info.token_b.clone(), deposit_b, pool_info.token_a.clone(), deposit_a)
        };
        let auth_entries = soroban_sdk::vec![
            &env,
            InvokerContractAuthEntry::Contract(SubContractInvocation {
                context: ContractContext {
                    contract: auth_token_0,
                    fn_name: Symbol::new(&env, "transfer"),
                    args: (
                        contract_address.clone(),
                        pool_info.pool_address.clone(),
                        auth_amount_0,
                    ).into_val(&env),
                },
                sub_invocations: soroban_sdk::vec![&env],
            }),
            InvokerContractAuthEntry::Contract(SubContractInvocation {
                context: ContractContext {
                    contract: auth_token_1,
                    fn_name: Symbol::new(&env, "transfer"),
                    args: (
                        contract_address.clone(),
                        pool_info.pool_address.clone(),
                        auth_amount_1,
                    ).into_val(&env),
                },
                sub_invocations: soroban_sdk::vec![&env],
            }),
        ];
        env.authorize_as_current_contract(auth_entries);

        // STEP 4: Deposit tokens to Aquarius pool in Aquarius token order.
        let mut deposit_amounts = Vec::new(&env);
        if token_a_is_idx0 {
            deposit_amounts.push_back(deposit_a as u128);
            deposit_amounts.push_back(deposit_b as u128);
        } else {
            deposit_amounts.push_back(deposit_b as u128);
            deposit_amounts.push_back(deposit_a as u128);
        }

        let (_actual_amounts, lp_shares_minted) = aquarius_pool.deposit(
            &contract_address,
            &deposit_amounts,
            &min_shares,
        );

        // STEP 5: Refund excess tokens back to user
        let refund_a = desired_a - deposit_a;
        let refund_b = desired_b - deposit_b;
        if refund_a > 0 {
            token_a_client.transfer(&contract_address, &user, &refund_a);
        }
        if refund_b > 0 {
            token_b_client.transfer(&contract_address, &user, &refund_b);
        }

        // STEP 7: Mint vault shares proportional to LP deposited.
        // Vault share model: shares represent proportional ownership.
        // When compounds add LP, total_lp grows but shares stay → each share worth more.
        let lp_minted = lp_shares_minted as i128;
        let old_total_lp = pool_info.total_lp_tokens;
        let total_shares: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::VaultTotalShares(pool_id))
            .unwrap_or(0);

        let shares_to_mint = if old_total_lp == 0 || total_shares == 0 {
            // First deposit: 1 share = 1 LP
            lp_minted
        } else {
            // Proportional: new_shares = lp_minted * total_shares / total_lp
            lp_minted
                .checked_mul(total_shares)
                .unwrap_or(0)
                .checked_div(old_total_lp)
                .unwrap_or(0)
        };

        pool_info.total_lp_tokens = old_total_lp.saturating_add(lp_minted);

        // STEP 8: Get or create user position
        let mut user_position: UserVaultPosition = env
            .storage()
            .persistent()
            .get(&DataKey::UserVaultPosition(user.clone(), pool_id))
            .unwrap_or(UserVaultPosition {
                user: user.clone(),
                pool_id,
                share_ratio: 0,
                deposited_at: env.ledger().timestamp(),
                active: true,
            });

        // STEP 9: Add minted shares to user and global total
        user_position.share_ratio = user_position.share_ratio.saturating_add(shares_to_mint);
        user_position.active = true;

        let new_total_shares = total_shares.saturating_add(shares_to_mint);

        env.storage()
            .persistent()
            .set(&DataKey::PoolInfo(pool_id), &pool_info);
        env.storage()
            .persistent()
            .set(&DataKey::UserVaultPosition(user.clone(), pool_id), &user_position);
        env.storage()
            .persistent()
            .set(&DataKey::VaultTotalShares(pool_id), &new_total_shares);

        // Track user's deposited LP (excludes compound gains)
        let prev_deposited: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::UserDepositedLp(user.clone(), pool_id))
            .unwrap_or(0);
        env.storage()
            .persistent()
            .set(&DataKey::UserDepositedLp(user.clone(), pool_id), &prev_deposited.saturating_add(lp_minted));

        env.events().publish(
            (symbol_short!("vault_dep"), user.clone(), pool_id),
            (deposit_a, deposit_b, lp_shares_minted, user_position.share_ratio),
        );

        Ok(())
    }

    /// Single-asset vault deposit.
    /// Deposits a single token into an Aquarius pool. The AMM handles the
    /// internal swap to balance the deposit across both pool tokens.
    ///
    /// # Arguments
    /// * `user` - User address
    /// * `pool_id` - Pool ID
    /// * `token_in` - Address of the token being deposited (must be token_a or token_b of the pool)
    /// * `amount_in` - Amount of token_in to deposit (in raw units, 7 decimals)
    /// * `min_shares` - Minimum LP shares to receive (slippage protection)
    pub fn vault_deposit_single(
        env: Env,
        user: Address,
        pool_id: u32,
        token_in: Address,
        amount_in: i128,
        min_shares: u128,
    ) -> Result<(), Error> {
        user.require_auth();

        if amount_in <= 0 {
            return Err(Error::InvalidInput);
        }

        let mut pool_info: PoolInfo = env
            .storage()
            .persistent()
            .get(&DataKey::PoolInfo(pool_id))
            .ok_or(Error::PoolNotFound)?;

        if !pool_info.active {
            return Err(Error::PoolNotActive);
        }

        // Verify token_in is one of the pool tokens
        let is_token_a = token_in == pool_info.token_a;
        let is_token_b = token_in == pool_info.token_b;
        if !is_token_a && !is_token_b {
            return Err(Error::InvalidInput);
        }

        let contract_address = env.current_contract_address();

        // STEP 1: Transfer input token from user to contract
        use soroban_sdk::token;
        let token_client = token::Client::new(&env, &token_in);
        token_client.transfer(&user, &contract_address, &amount_in);

        // STEP 2: Determine Aquarius pool token ordering
        let pool_tokens_result = env.try_invoke_contract::<Vec<Address>, soroban_sdk::Error>(
            &pool_info.pool_address,
            &Symbol::new(&env, "get_tokens"),
            ().into_val(&env),
        );
        let token_a_is_idx0 = match pool_tokens_result {
            Ok(Ok(ref tokens)) if tokens.len() >= 2 => {
                tokens.get(0).unwrap() == pool_info.token_a
            }
            _ => true,
        };

        // STEP 3: Build deposit amounts — input token gets amount, other is 0
        let (amount_a, amount_b): (u128, u128) = if is_token_a {
            (amount_in as u128, 0u128)
        } else {
            (0u128, amount_in as u128)
        };

        // STEP 4: Authorize only the non-zero token transfer to the pool
        let auth_entries = soroban_sdk::vec![
            &env,
            InvokerContractAuthEntry::Contract(SubContractInvocation {
                context: ContractContext {
                    contract: token_in.clone(),
                    fn_name: Symbol::new(&env, "transfer"),
                    args: (
                        contract_address.clone(),
                        pool_info.pool_address.clone(),
                        amount_in,
                    ).into_val(&env),
                },
                sub_invocations: soroban_sdk::vec![&env],
            }),
        ];
        env.authorize_as_current_contract(auth_entries);

        // STEP 5: Deposit to Aquarius pool (single-asset — AMM handles internal swap)
        let aquarius_pool = AquariusPoolClient::new(&env, &pool_info.pool_address);
        let mut deposit_amounts = Vec::new(&env);
        if token_a_is_idx0 {
            deposit_amounts.push_back(amount_a);
            deposit_amounts.push_back(amount_b);
        } else {
            deposit_amounts.push_back(amount_b);
            deposit_amounts.push_back(amount_a);
        }

        let (_actual_amounts, lp_shares_minted) = aquarius_pool.deposit(
            &contract_address,
            &deposit_amounts,
            &min_shares,
        );

        // STEP 6: Mint vault shares proportional to LP deposited
        let lp_minted = lp_shares_minted as i128;
        let old_total_lp = pool_info.total_lp_tokens;
        let total_shares: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::VaultTotalShares(pool_id))
            .unwrap_or(0);

        let shares_to_mint = if old_total_lp == 0 || total_shares == 0 {
            lp_minted
        } else {
            lp_minted
                .checked_mul(total_shares)
                .unwrap_or(0)
                .checked_div(old_total_lp)
                .unwrap_or(0)
        };

        pool_info.total_lp_tokens = old_total_lp.saturating_add(lp_minted);

        // STEP 7: Get or create user position
        let mut user_position: UserVaultPosition = env
            .storage()
            .persistent()
            .get(&DataKey::UserVaultPosition(user.clone(), pool_id))
            .unwrap_or(UserVaultPosition {
                user: user.clone(),
                pool_id,
                share_ratio: 0,
                deposited_at: env.ledger().timestamp(),
                active: true,
            });

        // STEP 8: Add minted shares to user and global total
        user_position.share_ratio = user_position.share_ratio.saturating_add(shares_to_mint);
        user_position.active = true;

        let new_total_shares = total_shares.saturating_add(shares_to_mint);

        env.storage()
            .persistent()
            .set(&DataKey::PoolInfo(pool_id), &pool_info);
        env.storage()
            .persistent()
            .set(&DataKey::UserVaultPosition(user.clone(), pool_id), &user_position);
        env.storage()
            .persistent()
            .set(&DataKey::VaultTotalShares(pool_id), &new_total_shares);

        // Track user's deposited LP (excludes compound gains)
        let prev_deposited: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::UserDepositedLp(user.clone(), pool_id))
            .unwrap_or(0);
        env.storage()
            .persistent()
            .set(&DataKey::UserDepositedLp(user.clone(), pool_id), &prev_deposited.saturating_add(lp_minted));

        env.events().publish(
            (symbol_short!("vault_dep"), user.clone(), pool_id),
            (amount_in, 0i128, lp_shares_minted, user_position.share_ratio),
        );

        Ok(())
    }

    /// Withdraws tokens from a vault pool.
    /// User withdraws their share, contract removes liquidity from Aquarius pool.
    ///
    /// # Arguments
    /// * `user` - User address
    /// * `pool_id` - Pool ID
    /// * `share_percent` - Percentage of user's position to withdraw (0-10000 = 0-100%)
    /// * `min_a` - Minimum amount of token_a to receive (slippage protection)
    /// * `min_b` - Minimum amount of token_b to receive (slippage protection)
    ///
    /// # Authorization
    /// Requires user authorization
    pub fn vault_withdraw(
        env: Env,
        user: Address,
        pool_id: u32,
        share_percent: u32,
        min_a: u128,
        min_b: u128,
    ) -> Result<(), Error> {
        user.require_auth();

        if share_percent == 0 || share_percent > 10000 {
            return Err(Error::InvalidInput);
        }

        let mut pool_info: PoolInfo = env
            .storage()
            .persistent()
            .get(&DataKey::PoolInfo(pool_id))
            .ok_or(Error::PoolNotFound)?;

        let mut user_position: UserVaultPosition = env
            .storage()
            .persistent()
            .get(&DataKey::UserVaultPosition(user.clone(), pool_id))
            .ok_or(Error::PositionNotFound)?;

        if !user_position.active {
            return Err(Error::PositionNotFound);
        }

        // STEP 1: Convert user's shares to LP amount
        let total_shares: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::VaultTotalShares(pool_id))
            .unwrap_or(0);

        let user_shares = user_position.share_ratio;

        if user_shares <= 0 || total_shares <= 0 {
            return Err(Error::InsufficientBalance);
        }

        // User's LP = shares * total_lp / total_shares
        let user_total_lp = user_shares
            .checked_mul(pool_info.total_lp_tokens)
            .unwrap_or(0)
            .checked_div(total_shares)
            .unwrap_or(0);

        if user_total_lp <= 0 {
            return Err(Error::InsufficientBalance);
        }

        // Calculate LP and shares to withdraw based on percentage
        let lp_to_withdraw = user_total_lp
            .checked_mul(share_percent as i128)
            .unwrap_or(0)
            .checked_div(10000)
            .unwrap_or(0);

        let shares_to_burn = user_shares
            .checked_mul(share_percent as i128)
            .unwrap_or(0)
            .checked_div(10000)
            .unwrap_or(0);

        if lp_to_withdraw <= 0 {
            return Err(Error::InvalidInput);
        }

        // STEP 2: Authorize Aquarius pool to burn LP tokens from this contract
        let contract_address = env.current_contract_address();

        // Determine Aquarius pool token ordering for min_amounts and withdrawn amounts.
        let pool_tokens_result = env.try_invoke_contract::<Vec<Address>, soroban_sdk::Error>(
            &pool_info.pool_address,
            &Symbol::new(&env, "get_tokens"),
            ().into_val(&env),
        );
        let token_a_is_idx0 = match pool_tokens_result {
            Ok(Ok(ref tokens)) if tokens.len() >= 2 => {
                tokens.get(0).unwrap() == pool_info.token_a
            }
            _ => true,
        };

        // Note: Aquarius pool calls burn(from, amount), not transfer
        let auth_entries = soroban_sdk::vec![
            &env,
            InvokerContractAuthEntry::Contract(SubContractInvocation {
                context: ContractContext {
                    contract: pool_info.share_token.clone(),
                    fn_name: Symbol::new(&env, "burn"),
                    args: (
                        contract_address.clone(),
                        lp_to_withdraw,
                    ).into_val(&env),
                },
                sub_invocations: soroban_sdk::vec![&env],
            }),
        ];
        env.authorize_as_current_contract(auth_entries);

        // STEP 3: Withdraw from Aquarius pool
        let aquarius_pool = AquariusPoolClient::new(&env, &pool_info.pool_address);

        // Build min_amounts in Aquarius token order.
        let mut min_amounts = Vec::new(&env);
        if token_a_is_idx0 {
            min_amounts.push_back(min_a);
            min_amounts.push_back(min_b);
        } else {
            min_amounts.push_back(min_b); // token_b at Aquarius idx0
            min_amounts.push_back(min_a); // token_a at Aquarius idx1
        }

        let withdrawn_amounts = aquarius_pool.withdraw(
            &contract_address,
            &(lp_to_withdraw as u128),
            &min_amounts,
        );

        // STEP 4: Transfer tokens to user, mapping Aquarius indices back to token_a/token_b.
        use soroban_sdk::token;
        let token_a_client = token::Client::new(&env, &pool_info.token_a);
        let token_b_client = token::Client::new(&env, &pool_info.token_b);

        let amount_a = if token_a_is_idx0 {
            withdrawn_amounts.get(0).unwrap_or(0)
        } else {
            withdrawn_amounts.get(1).unwrap_or(0)
        };
        let amount_b = if token_a_is_idx0 {
            withdrawn_amounts.get(1).unwrap_or(0)
        } else {
            withdrawn_amounts.get(0).unwrap_or(0)
        };

        token_a_client.transfer(&contract_address, &user, &(amount_a as i128));
        token_b_client.transfer(&contract_address, &user, &(amount_b as i128));

        // STEP 4: Update pool total LP
        pool_info.total_lp_tokens = pool_info.total_lp_tokens.saturating_sub(lp_to_withdraw);

        // STEP 5: Burn shares and update totals
        let remaining_shares = user_shares.saturating_sub(shares_to_burn);

        if remaining_shares > 0 {
            user_position.share_ratio = remaining_shares;
        } else {
            user_position.share_ratio = 0;
            user_position.active = false;
        }

        let new_total_shares = total_shares.saturating_sub(shares_to_burn);

        env.storage()
            .persistent()
            .set(&DataKey::PoolInfo(pool_id), &pool_info);
        env.storage()
            .persistent()
            .set(&DataKey::UserVaultPosition(user.clone(), pool_id), &user_position);
        env.storage()
            .persistent()
            .set(&DataKey::VaultTotalShares(pool_id), &new_total_shares);

        // Proportionally reduce user's deposited LP tracking
        let prev_deposited: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::UserDepositedLp(user.clone(), pool_id))
            .unwrap_or(0);
        if prev_deposited > 0 && user_total_lp > 0 {
            // Reduce proportionally: deposited *= (1 - withdrawn/total)
            let withdrawn_fraction = lp_to_withdraw
                .checked_mul(prev_deposited)
                .unwrap_or(0)
                .checked_div(user_total_lp)
                .unwrap_or(0);
            let new_deposited = prev_deposited.saturating_sub(withdrawn_fraction);
            env.storage()
                .persistent()
                .set(&DataKey::UserDepositedLp(user.clone(), pool_id), &new_deposited);
        }

        env.events().publish(
            (symbol_short!("vault_wd"), user.clone(), pool_id),
            (lp_to_withdraw, amount_a, amount_b),
        );

        Ok(())
    }

    /// Claims boosted rewards from a pool and auto-compounds.
    /// Treasury cut is `config.vault_fee_bps` (default 1500 = 15%); remainder auto-compounds.
    /// Pool 0 (POL+vault mixed): backend applies an additional cut on the POL share
    /// in `handleStakingRewardDistribution` so POL effectively pays 30%.
    /// Backend cron calls this 4x daily using ICE balance for boost.
    ///
    /// # Arguments
    /// * `pool_id` - Pool ID to claim rewards from
    ///
    /// # Authorization
    /// Requires admin authorization
    /// Claims boosted rewards from a pool, sends `vault_fee_bps` to treasury and the rest to admin.
    /// The admin (backend) must then swap the AQUA to both pool tokens and call
    /// `admin_compound_deposit` to complete the compound cycle.
    ///
    /// Returns: (total_rewards, treasury_amount, compound_amount) — all in AQUA raw units.
    pub fn claim_and_compound(env: Env, manager: Address, pool_id: u32) -> Result<(i128, i128, i128), Error> {
        let config = Self::get_config(env.clone())?;
        Self::require_manager_auth(&env, &manager)?;

        let pool_info: PoolInfo = env
            .storage()
            .persistent()
            .get(&DataKey::PoolInfo(pool_id))
            .ok_or(Error::PoolNotFound)?;

        if !pool_info.active {
            return Err(Error::PoolNotActive);
        }

        let contract_address = env.current_contract_address();

        // STEP 1: Claim AQUA rewards from Aquarius pool
        let aquarius_pool = AquariusPoolClient::new(&env, &pool_info.pool_address);
        let total_rewards = aquarius_pool.claim(&contract_address);

        if total_rewards == 0 {
            env.events().publish(
                (symbol_short!("compound"), pool_id),
                symbol_short!("no_reward"),
            );
            return Ok((0, 0, 0));
        }

        // STEP 2: Split rewards — `vault_fee_bps` to treasury, remainder to admin for compounding
        let treasury_amount = (total_rewards as u128)
            .checked_mul(config.vault_fee_bps as u128)
            .unwrap_or(0)
            .checked_div(10000)
            .unwrap_or(0);

        let compound_amount = total_rewards.saturating_sub(treasury_amount);

        use soroban_sdk::token;
        let aqua_client = token::Client::new(&env, &config.aqua_token);

        // STEP 3: Transfer treasury cut to vault treasury
        if treasury_amount > 0 {
            aqua_client.transfer(&contract_address, &config.vault_treasury, &(treasury_amount as i128));
        }

        // STEP 4: Transfer remainder to manager wallet for off-chain swap + compound
        if compound_amount > 0 {
            aqua_client.transfer(&contract_address, &manager, &(compound_amount as i128));
        }

        env.events().publish(
            (symbol_short!("compound"), pool_id),
            (total_rewards as i128, treasury_amount as i128, compound_amount as i128),
        );

        Ok((total_rewards as i128, treasury_amount as i128, compound_amount as i128))
    }

    /// Deposits tokens from admin into an Aquarius pool on behalf of the contract.
    /// Called by backend after swapping AQUA into both pool tokens.
    /// This completes the compound cycle started by `claim_and_compound`.
    ///
    /// # Arguments
    /// * `pool_id` - Pool ID to deposit into
    /// * `amount_a` - Amount of token_a to deposit (from admin wallet)
    /// * `amount_b` - Amount of token_b to deposit (from admin wallet)
    pub fn admin_compound_deposit(
        env: Env,
        manager: Address,
        pool_id: u32,
        amount_a: i128,
        amount_b: i128,
    ) -> Result<i128, Error> {
        let config = Self::get_config(env.clone())?;
        Self::require_manager_auth(&env, &manager)?;

        let mut pool_info: PoolInfo = env
            .storage()
            .persistent()
            .get(&DataKey::PoolInfo(pool_id))
            .ok_or(Error::PoolNotFound)?;

        if !pool_info.active {
            return Err(Error::PoolNotActive);
        }

        if amount_a <= 0 || amount_b <= 0 {
            return Err(Error::InvalidInput);
        }

        let contract_address = env.current_contract_address();

        // STEP 1: Transfer both tokens from admin to contract
        use soroban_sdk::token;
        let token_a_client = token::Client::new(&env, &pool_info.token_a);
        let token_b_client = token::Client::new(&env, &pool_info.token_b);

        token_a_client.transfer(&manager, &contract_address, &amount_a);
        token_b_client.transfer(&manager, &contract_address, &amount_b);

        // STEP 2: Deposit to Aquarius pool
        // Aquarius pools order tokens by contract address (sorted).
        // desired_amounts and auth entries must follow the pool's token order,
        // which may differ from our PoolInfo (token_a, token_b) order.
        let aquarius_pool = AquariusPoolClient::new(&env, &pool_info.pool_address);

        let (first_token, first_amount, second_token, second_amount) =
            if pool_info.token_a < pool_info.token_b {
                // token_a comes first in pool order
                (pool_info.token_a.clone(), amount_a, pool_info.token_b.clone(), amount_b)
            } else {
                // token_b comes first in pool order
                (pool_info.token_b.clone(), amount_b, pool_info.token_a.clone(), amount_a)
            };

        let auth_entries = soroban_sdk::vec![
            &env,
            InvokerContractAuthEntry::Contract(SubContractInvocation {
                context: ContractContext {
                    contract: first_token,
                    fn_name: Symbol::new(&env, "transfer"),
                    args: (
                        contract_address.clone(),
                        pool_info.pool_address.clone(),
                        first_amount,
                    ).into_val(&env),
                },
                sub_invocations: soroban_sdk::vec![&env],
            }),
            InvokerContractAuthEntry::Contract(SubContractInvocation {
                context: ContractContext {
                    contract: second_token,
                    fn_name: Symbol::new(&env, "transfer"),
                    args: (
                        contract_address.clone(),
                        pool_info.pool_address.clone(),
                        second_amount,
                    ).into_val(&env),
                },
                sub_invocations: soroban_sdk::vec![&env],
            }),
        ];
        env.authorize_as_current_contract(auth_entries);

        let mut desired_amounts = Vec::new(&env);
        desired_amounts.push_back(first_amount as u128);
        desired_amounts.push_back(second_amount as u128);

        let (_actual_amounts, lp_shares_minted) = aquarius_pool.deposit(
            &contract_address,
            &desired_amounts,
            &0u128,
        );

        // STEP 3: Update pool LP tracking
        pool_info.total_lp_tokens = pool_info
            .total_lp_tokens
            .saturating_add(lp_shares_minted as i128);

        env.storage()
            .persistent()
            .set(&DataKey::PoolInfo(pool_id), &pool_info);

        // STEP 4: Update compound stats
        let mut stats: PoolCompoundStats = env
            .storage()
            .persistent()
            .get(&DataKey::PoolCompoundStats(pool_id))
            .unwrap_or(PoolCompoundStats {
                total_compounded_lp: 0,
                total_rewards_claimed: 0,
                total_treasury_fees: 0,
                last_compound_time: 0,
                compound_count: 0,
            });
        stats.total_compounded_lp = stats.total_compounded_lp.saturating_add(lp_shares_minted as i128);
        stats.last_compound_time = env.ledger().timestamp();
        stats.compound_count = stats.compound_count.saturating_add(1);
        env.storage()
            .persistent()
            .set(&DataKey::PoolCompoundStats(pool_id), &stats);

        env.events().publish(
            (symbol_short!("cmp_dep"), pool_id),
            (lp_shares_minted, pool_info.total_lp_tokens),
        );

        Ok(lp_shares_minted as i128)
    }

    // ============================================================================
    // QUERY FUNCTIONS - ICE & Vault
    // ============================================================================

    /// Gets pending AQUA available for ICE locking.
    pub fn get_pending_aqua_for_ice(env: Env) -> Result<i128, Error> {
        let global_state: GlobalState = env
            .storage()
            .instance()
            .get(&DataKey::GlobalState)
            .ok_or(Error::NotInitialized)?;

        Ok(global_state.pending_aqua_for_ice)
    }

    /// Gets all 4 ICE token balances.
    pub fn get_all_ice_balances(env: Env) -> Result<(i128, i128, i128, i128), Error> {
        let global_state: GlobalState = env
            .storage()
            .instance()
            .get(&DataKey::GlobalState)
            .ok_or(Error::NotInitialized)?;

        Ok((
            global_state.ice_balance,
            global_state.govern_ice_balance,
            global_state.upvote_ice_balance,
            global_state.downvote_ice_balance,
        ))
    }

    /// Gets upvoteICE balance for voting.
    pub fn get_upvote_ice_balance(env: Env) -> Result<i128, Error> {
        let global_state: GlobalState = env
            .storage()
            .instance()
            .get(&DataKey::GlobalState)
            .ok_or(Error::NotInitialized)?;

        Ok(global_state.upvote_ice_balance)
    }

    /// Gets ICE lock authorization by ID.
    pub fn get_ice_lock_authorization(env: Env, lock_id: u64) -> Result<IceLockAuthorization, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::IceLockAuth(lock_id))
            .ok_or(Error::NotFound)
    }

    /// Gets pool information by ID.
    pub fn get_pool_info(env: Env, pool_id: u32) -> Result<PoolInfo, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::PoolInfo(pool_id))
            .ok_or(Error::PoolNotFound)
    }

    /// Gets total vault shares for a pool (v1.8.0+).
    pub fn get_vault_total_shares(env: Env, pool_id: u32) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::VaultTotalShares(pool_id))
            .unwrap_or(0)
    }

    /// Gets user's vault position in a specific pool.
    pub fn get_user_vault_position(env: Env, user: Address, pool_id: u32) -> Result<UserVaultPosition, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::UserVaultPosition(user, pool_id))
            .ok_or(Error::PositionNotFound)
    }

    /// Gets total number of vault pools.
    /// Gets compound stats for a vault pool.
    pub fn get_pool_compound_stats(env: Env, pool_id: u32) -> PoolCompoundStats {
        env.storage()
            .persistent()
            .get(&DataKey::PoolCompoundStats(pool_id))
            .unwrap_or(PoolCompoundStats {
                total_compounded_lp: 0,
                total_rewards_claimed: 0,
                total_treasury_fees: 0,
                last_compound_time: 0,
                compound_count: 0,
            })
    }

    /// Gets user's compound gains for a specific pool.
    /// Returns (current_lp, deposited_lp, compound_gain_lp).
    pub fn get_user_compound_gains(env: Env, user: Address, pool_id: u32) -> (i128, i128, i128) {
        let pool_info: PoolInfo = env
            .storage()
            .persistent()
            .get(&DataKey::PoolInfo(pool_id))
            .unwrap_or(PoolInfo {
                pool_id,
                pool_address: env.current_contract_address(),
                token_a: env.current_contract_address(),
                token_b: env.current_contract_address(),
                share_token: env.current_contract_address(),
                total_lp_tokens: 0,
                active: false,
                added_at: 0,
            });

        let user_position: UserVaultPosition = env
            .storage()
            .persistent()
            .get(&DataKey::UserVaultPosition(user.clone(), pool_id))
            .unwrap_or(UserVaultPosition {
                user: user.clone(),
                pool_id,
                share_ratio: 0,
                deposited_at: 0,
                active: false,
            });

        // Convert shares to LP: user_lp = shares * total_lp / total_shares
        let total_shares: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::VaultTotalShares(pool_id))
            .unwrap_or(0);

        let current_lp = if total_shares > 0 {
            user_position.share_ratio
                .checked_mul(pool_info.total_lp_tokens)
                .unwrap_or(0)
                .checked_div(total_shares)
                .unwrap_or(0)
        } else {
            0
        };

        let deposited_lp: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::UserDepositedLp(user, pool_id))
            .unwrap_or(0);

        let compound_gain = current_lp.saturating_sub(deposited_lp);

        (current_lp, deposited_lp, compound_gain)
    }

    /// Gets total number of vault pools.
    pub fn get_pool_count(env: Env) -> Result<u32, Error> {
        let global_state: GlobalState = env
            .storage()
            .instance()
            .get(&DataKey::GlobalState)
            .ok_or(Error::NotInitialized)?;

        Ok(global_state.pool_count)
    }
}

// Default implementation for POL
impl Default for ProtocolOwnedLiquidity {
    fn default() -> Self {
        Self {
            total_aqua_contributed: 0,
            total_blub_contributed: 0,
            aqua_blub_lp_position: 0,
            total_pol_rewards_earned: 0,
            last_reward_claim: 0,
            ice_voting_power_used: 0,
        }
    }
} 