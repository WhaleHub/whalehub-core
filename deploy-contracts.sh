#!/bin/bash

################################################################################
# Soroban Contracts Deployment Script - Mainnet
# This script deploys and initializes the Staking, Rewards, and Governance contracts
################################################################################

set -e  # Exit on any error

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored messages
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

################################################################################
# CONFIGURATION - Update these values before deployment
################################################################################

# Network configuration
NETWORK="mainnet"
SOROBAN_RPC_URL="https://soroban-rpc.mainnet.stellar.network"
SOROBAN_NETWORK_PASSPHRASE="Public Global Stellar Network ; September 2015"
# Deployment account (the secret key should be set as an environment variable)
# Set this before running: export DEPLOYER_SECRET_KEY="S..."
if [ -z "$DEPLOYER_SECRET_KEY" ]; then
    print_error "DEPLOYER_SECRET_KEY environment variable is not set"
    print_info "Please set it using: export DEPLOYER_SECRET_KEY=\"S...\""
    exit 1
fi

# Admin address (derived from deployer secret key)
# This will be set automatically after we derive it from the secret key
ADMIN_ADDRESS="GBLH7JNNONQ7DZPL4J2FQOUWOKUKTCVRNYVPJLJBWHWCLYJHLVVGULGO"

# Contract addresses - UPDATE THESE WITH YOUR ACTUAL TOKEN/CONTRACT ADDRESSES
# AQUA token address on mainnet
AQUA_TOKEN_ADDRESS="CAUIKL3IYGMERDRUN6YSCLWVAKIFG5Q4YJHUKM4S4NJZQIA3BAS6OJPK"

# BLUB token address on mainnet  
BLUB_TOKEN_ADDRESS="CDSSDKJZACMXIE4C25TAVLWUQWLRNXSC2TLOFTTRSUAOZOMU5PXGZYEX"

# Treasury address - UPDATE THIS
TREASURY_ADDRESS="GBLH7JNNONQ7DZPL4J2FQOUWOKUKTCVRNYVPJLJBWHWCLYJHLVVGULGO"

# Liquidity contract address (for liquidity pools) - UPDATE THIS
LIQUIDITY_CONTRACT_ADDRESS="CBL7MWLEZ4SU6YC5XL4T3WXKNKNO2UQVDVONOQSW5VVCYFWORROHY4AM"

# # ICE contract address (governance token) - UPDATE THIS
# ICE_CONTRACT_ADDRESS="CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM"

# Reward token address (typically same as AQUA or BLUB) - UPDATE THIS
REWARD_TOKEN_ADDRESS="CDSSDKJZACMXIE4C25TAVLWUQWLRNXSC2TLOFTTRSUAOZOMU5PXGZYEX"

################################################################################
# Rewards Contract Configuration
################################################################################
# Minimum amount a user can claim in one transaction (in stroops, 1 token = 10^7 stroops)
REWARDS_MIN_CLAIM_AMOUNT="1000000"  # 0.1 tokens

# Maximum amount a user can claim in one transaction  
REWARDS_MAX_CLAIM_PER_TX="100000000000"  # 10,000 tokens

# Claim cooldown period in seconds (24 hours = 86400 seconds)
REWARDS_CLAIM_COOLDOWN="86400"

# Treasury fee rate in basis points (100 = 1%, 2000 = 20% max)
REWARDS_TREASURY_FEE_RATE="500"  # 5%

################################################################################
# Governance Contract Configuration
################################################################################
# Base multiplier for ICE token calculation (10000 = 1.0x)
GOVERNANCE_BASE_MULTIPLIER="10000"  # 1.0x

# Maximum time multiplier for longer locks (20000 = 2.0x)
GOVERNANCE_MAX_TIME_MULTIPLIER="20000"  # 2.0x

################################################################################
# Contract paths
################################################################################
CONTRACTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/soroban-contracts/staking-contract"
WASM_OUTPUT_DIR="$CONTRACTS_DIR/target/wasm32-unknown-unknown/release"

# Output file for deployed contract IDs
OUTPUT_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deployed-contracts.txt"

################################################################################
# Validation
################################################################################

print_info "Validating configuration..."

# Check if soroban CLI is installed
if ! command -v soroban &> /dev/null; then
    print_error "soroban CLI is not installed"
    print_info "Install it from: https://soroban.stellar.org/docs/getting-started/setup"
    exit 1
fi

# Validate addresses (basic check for Stellar address format)
validate_address() {
    local addr=$1
    local name=$2
    if [[ ! $addr =~ ^[GC][A-Z2-7]{55}$ ]]; then
        print_warning "$name does not match Stellar address format: $addr"
        print_warning "Please verify this is correct before proceeding"
    fi
}

validate_address "$TREASURY_ADDRESS" "TREASURY_ADDRESS"

print_success "Configuration validated"

################################################################################
# Derive admin address from secret key
################################################################################

print_info "Deriving admin address from deployer secret key..."

# Create a temporary identity
IDENTITY_NAME="temp_deployer_$(date +%s)"
echo "$DEPLOYER_SECRET_KEY" | soroban keys add "$IDENTITY_NAME" --secret-stdin 2>/dev/null || true

# Get the public address
ADMIN_ADDRESS=$(soroban keys address "$IDENTITY_NAME")

# Remove the temporary identity
soroban keys rm "$IDENTITY_NAME" 2>/dev/null || true

print_success "Admin address: $ADMIN_ADDRESS"

################################################################################
# Build contracts
################################################################################

print_info "Building Soroban contracts..."

cd "$CONTRACTS_DIR"

# Build all contracts in the workspace
print_info "Building staking contract..."
cargo build --release --target wasm32-unknown-unknown --package whalehub-staking

print_info "Building rewards contract..."
cargo build --release --target wasm32-unknown-unknown --package whalehub-rewards

print_info "Building governance contract..."
cargo build --release --target wasm32-unknown-unknown --package whalehub-governance

print_success "All contracts built successfully"

################################################################################
# Optimize WASM files
################################################################################

print_info "Optimizing WASM files..."

if command -v soroban contract optimize &> /dev/null; then
    soroban contract optimize --wasm "$WASM_OUTPUT_DIR/whalehub_staking.wasm"
    soroban contract optimize --wasm "$WASM_OUTPUT_DIR/whalehub_rewards.wasm"
    soroban contract optimize --wasm "$WASM_OUTPUT_DIR/whalehub_governance.wasm"
    print_success "WASM files optimized"
else
    print_warning "soroban contract optimize not available, using unoptimized WASM files"
fi

################################################################################
# Verify WASM files exist
################################################################################

print_info "Verifying WASM files..."

STAKING_WASM="$WASM_OUTPUT_DIR/whalehub_staking.wasm"
REWARDS_WASM="$WASM_OUTPUT_DIR/whalehub_rewards.wasm"
GOVERNANCE_WASM="$WASM_OUTPUT_DIR/whalehub_governance.wasm"

if [ ! -f "$STAKING_WASM" ]; then
    print_error "Staking WASM file not found: $STAKING_WASM"
    exit 1
fi

if [ ! -f "$REWARDS_WASM" ]; then
    print_error "Rewards WASM file not found: $REWARDS_WASM"
    exit 1
fi

if [ ! -f "$GOVERNANCE_WASM" ]; then
    print_error "Governance WASM file not found: $GOVERNANCE_WASM"
    exit 1
fi

print_success "All WASM files verified"

################################################################################
# Configure Soroban network
################################################################################

print_info "Configuring Soroban network..."

soroban network add "$NETWORK" \
    --rpc-url "$SOROBAN_RPC_URL" \
    --network-passphrase "$SOROBAN_NETWORK_PASSPHRASE" 2>/dev/null || true

print_success "Network configured"

################################################################################
# Create deployment identity
################################################################################

print_info "Setting up deployment identity..."

DEPLOYER_IDENTITY="deployer_mainnet"
echo "$DEPLOYER_SECRET_KEY" | soroban keys add "$DEPLOYER_IDENTITY" --secret-stdin 2>/dev/null || true

print_success "Deployment identity configured"

################################################################################
# Deploy Governance Contract
################################################################################

print_info "=========================================="
print_info "Deploying Governance Contract"
print_info "=========================================="

print_info "Deploying governance contract to $NETWORK..."

GOVERNANCE_CONTRACT_ID=$(soroban contract deploy \
    --wasm "$GOVERNANCE_WASM" \
    --source "$DEPLOYER_IDENTITY" \
    --network "$NETWORK")

print_success "Governance contract deployed!"
print_success "Contract ID: $GOVERNANCE_CONTRACT_ID"

# Save to output file
echo "# Deployed Contracts - $(date)" > "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"
echo "GOVERNANCE_CONTRACT_ID=$GOVERNANCE_CONTRACT_ID" >> "$OUTPUT_FILE"

# Wait a moment for the transaction to settle
sleep 2

################################################################################
# Deploy Rewards Contract
################################################################################

print_info "=========================================="
print_info "Deploying Rewards Contract"
print_info "=========================================="

print_info "Deploying rewards contract to $NETWORK..."

REWARDS_CONTRACT_ID=$(soroban contract deploy \
    --wasm "$REWARDS_WASM" \
    --source "$DEPLOYER_IDENTITY" \
    --network "$NETWORK")

print_success "Rewards contract deployed!"
print_success "Contract ID: $REWARDS_CONTRACT_ID"

# Save to output file
echo "REWARDS_CONTRACT_ID=$REWARDS_CONTRACT_ID" >> "$OUTPUT_FILE"

# Wait a moment for the transaction to settle
sleep 2

################################################################################
# Deploy Staking Contract
################################################################################

print_info "=========================================="
print_info "Deploying Staking Contract"
print_info "=========================================="

print_info "Deploying staking contract to $NETWORK..."

STAKING_CONTRACT_ID=$(soroban contract deploy \
    --wasm "$STAKING_WASM" \
    --source "$DEPLOYER_IDENTITY" \
    --network "$NETWORK")

print_success "Staking contract deployed!"
print_success "Contract ID: $STAKING_CONTRACT_ID"

# Save to output file
echo "STAKING_CONTRACT_ID=$STAKING_CONTRACT_ID" >> "$OUTPUT_FILE"

# Wait a moment for the transaction to settle
sleep 2

################################################################################
# Initialize Governance Contract
################################################################################

print_info "=========================================="
print_info "Initializing Governance Contract"
print_info "=========================================="

print_info "Initializing governance contract..."

soroban contract invoke \
    --id "$GOVERNANCE_CONTRACT_ID" \
    --source "$DEPLOYER_IDENTITY" \
    --network "$NETWORK" \
    -- \
    initialize \
    --admin "$ADMIN_ADDRESS" \
    --staking_contract "$STAKING_CONTRACT_ID" \
    --treasury_address "$TREASURY_ADDRESS" \
    --base_multiplier "$GOVERNANCE_BASE_MULTIPLIER" \
    --max_time_multiplier "$GOVERNANCE_MAX_TIME_MULTIPLIER"

print_success "Governance contract initialized!"

# Wait a moment for the transaction to settle
sleep 2

################################################################################
# Initialize Rewards Contract
################################################################################

print_info "=========================================="
print_info "Initializing Rewards Contract"
print_info "=========================================="

print_info "Initializing rewards contract..."

soroban contract invoke \
    --id "$REWARDS_CONTRACT_ID" \
    --source "$DEPLOYER_IDENTITY" \
    --network "$NETWORK" \
    -- \
    initialize \
    --admin "$ADMIN_ADDRESS" \
    --staking_contract "$STAKING_CONTRACT_ID" \
    --reward_token "$REWARD_TOKEN_ADDRESS" \
    --treasury_address "$TREASURY_ADDRESS" \
    --min_claim_amount "$REWARDS_MIN_CLAIM_AMOUNT" \
    --max_claim_per_tx "$REWARDS_MAX_CLAIM_PER_TX" \
    --claim_cooldown "$REWARDS_CLAIM_COOLDOWN" \
    --treasury_fee_rate "$REWARDS_TREASURY_FEE_RATE"

print_success "Rewards contract initialized!"

# Wait a moment for the transaction to settle
sleep 2

################################################################################
# Initialize Staking Contract
################################################################################

print_info "=========================================="
print_info "Initializing Staking Contract"
print_info "=========================================="

print_info "Initializing staking contract..."

soroban contract invoke \
    --id "$STAKING_CONTRACT_ID" \
    --source "$DEPLOYER_IDENTITY" \
    --network "$NETWORK" \
    -- \
    initialize \
    --admin "$ADMIN_ADDRESS" \
    --treasury_address "$TREASURY_ADDRESS" \
    --aqua_token "$AQUA_TOKEN_ADDRESS" \
    --blub_token "$BLUB_TOKEN_ADDRESS" \
    --liquidity_contract "$LIQUIDITY_CONTRACT_ADDRESS" \
    --ice_contract "$GOVERNANCE_CONTRACT_ID"

print_success "Staking contract initialized!"

################################################################################
# Finalize and output results
################################################################################

print_info "=========================================="
print_info "Deployment Summary"
print_info "=========================================="

echo "" >> "$OUTPUT_FILE"
echo "# Contract Addresses" >> "$OUTPUT_FILE"
echo "ADMIN_ADDRESS=$ADMIN_ADDRESS" >> "$OUTPUT_FILE"
echo "TREASURY_ADDRESS=$TREASURY_ADDRESS" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"
echo "# Token Addresses" >> "$OUTPUT_FILE"
echo "AQUA_TOKEN_ADDRESS=$AQUA_TOKEN_ADDRESS" >> "$OUTPUT_FILE"
echo "BLUB_TOKEN_ADDRESS=$BLUB_TOKEN_ADDRESS" >> "$OUTPUT_FILE"
echo "REWARD_TOKEN_ADDRESS=$REWARD_TOKEN_ADDRESS" >> "$OUTPUT_FILE"
echo "LIQUIDITY_CONTRACT_ADDRESS=$LIQUIDITY_CONTRACT_ADDRESS" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"
echo "# Configuration" >> "$OUTPUT_FILE"
echo "REWARDS_MIN_CLAIM_AMOUNT=$REWARDS_MIN_CLAIM_AMOUNT" >> "$OUTPUT_FILE"
echo "REWARDS_MAX_CLAIM_PER_TX=$REWARDS_MAX_CLAIM_PER_TX" >> "$OUTPUT_FILE"
echo "REWARDS_CLAIM_COOLDOWN=$REWARDS_CLAIM_COOLDOWN" >> "$OUTPUT_FILE"
echo "REWARDS_TREASURY_FEE_RATE=$REWARDS_TREASURY_FEE_RATE" >> "$OUTPUT_FILE"
echo "GOVERNANCE_BASE_MULTIPLIER=$GOVERNANCE_BASE_MULTIPLIER" >> "$OUTPUT_FILE"
echo "GOVERNANCE_MAX_TIME_MULTIPLIER=$GOVERNANCE_MAX_TIME_MULTIPLIER" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"
echo "# Deployment Info" >> "$OUTPUT_FILE"
echo "NETWORK=$NETWORK" >> "$OUTPUT_FILE"
echo "DEPLOYED_AT=$(date -u +"%Y-%m-%d %H:%M:%S UTC")" >> "$OUTPUT_FILE"

print_success "All contracts deployed and initialized successfully!"
echo ""
print_info "Contract IDs:"
echo "  Staking:    $STAKING_CONTRACT_ID"
echo "  Rewards:    $REWARDS_CONTRACT_ID"
echo "  Governance: $GOVERNANCE_CONTRACT_ID"
echo ""
print_info "Admin address: $ADMIN_ADDRESS"
echo ""
print_success "Deployment details saved to: $OUTPUT_FILE"
echo ""

print_info "=========================================="
print_info "Next Steps"
print_info "=========================================="
echo ""
echo "1. Verify the contracts on Stellar Explorer:"
echo "   https://stellar.expert/explorer/public/contract/$STAKING_CONTRACT_ID"
echo "   https://stellar.expert/explorer/public/contract/$REWARDS_CONTRACT_ID"
echo "   https://stellar.expert/explorer/public/contract/$GOVERNANCE_CONTRACT_ID"
echo ""
echo "2. Update your frontend configuration with the new contract IDs"
echo ""
echo "3. Fund the rewards contract with reward tokens:"
echo "   soroban contract invoke \\"
echo "     --id $REWARDS_CONTRACT_ID \\"
echo "     --source $DEPLOYER_IDENTITY \\"
echo "     --network $NETWORK \\"
echo "     -- \\"
echo "     fund_reward_pool \\"
echo "     --admin $ADMIN_ADDRESS \\"
echo "     --pool_type Staking \\"
echo "     --amount <amount_in_stroops>"
echo ""
echo "4. Test the contracts with small transactions before going live"
echo ""

# Cleanup
print_info "Cleaning up temporary identity..."
soroban keys rm "$DEPLOYER_IDENTITY" 2>/dev/null || true

print_success "Deployment complete! 🎉"





stellar contract invoke \ 
  --id CAIPTIO4RN5SVE3M5IKD3ME4IPH5TOHIUNXRI7NCLYRHI3SXQLJRYJU5 \ 
  --source whalehub-main \ 
  --network mainnet \ 
  -- \ 
  initialize \ 
  --admin GBLH7JNNONQ7DZPL4J2FQOUWOKUKTCVRNYVPJLJBWHWCLYJHLVVGULGO \ 
  --treasury_address GBLH7JNNONQ7DZPL4J2FQOUWOKUKTCVRNYVPJLJBWHWCLYJHLVVGULGO \ 
  --aqua_token CAUIKL3IYGMERDRUN6YSCLWVAKIFG5Q4YJHUKM4S4NJZQIA3BAS6OJPK \ 
  --blub_token CDSSDKJZACMXIE4C25TAVLWUQWLRNXSC2TLOFTTRSUAOZOMU5PXGZYEX \ 
  --liquidity_contract CBL7MWLEZ4SU6YC5XL4T3WXKNKNO2UQVDVONOQSW5VVCYFWORROHY4AM \ 
  --ice_contract CBDNVN44VHKT3HZG45U6S7TC3FYUI2PM7IS6TB4VRFQLBRXFJSG2GQTA

stellar contract invoke \ 
  --id CBDNVN44VHKT3HZG45U6S7TC3FYUI2PM7IS6TB4VRFQLBRXFJSG2GQTA \ 
  --source whalehub-main \ 
  --network mainnet \ 
  -- \ 
  initialize \ 
  --admin GBLH7JNNONQ7DZPL4J2FQOUWOKUKTCVRNYVPJLJBWHWCLYJHLVVGULGO \ 
  --staking_contract CAIPTIO4RN5SVE3M5IKD3ME4IPH5TOHIUNXRI7NCLYRHI3SXQLJRYJU5 \ 
  --treasury_address GBLH7JNNONQ7DZPL4J2FQOUWOKUKTCVRNYVPJLJBWHWCLYJHLVVGULGO \ 
  --base_multiplier 10000 \ 
  --max_time_multiplier 20000

  stellar contract invoke \ 
  --id CDITRAKZO7ZMORO4HJ267MSV5JBCMYM3J3P2J7DU4QDWIMUWUJBC3ZDS \ 
  --source  whalehub-main \ 
  --network mainnet \ 
  -- \ 
  initialize \ 
  --admin GBLH7JNNONQ7DZPL4J2FQOUWOKUKTCVRNYVPJLJBWHWCLYJHLVVGULGO \ 
  --staking_contract CAIPTIO4RN5SVE3M5IKD3ME4IPH5TOHIUNXRI7NCLYRHI3SXQLJRYJU5 \ 
  --reward_token CDSSDKJZACMXIE4C25TAVLWUQWLRNXSC2TLOFTTRSUAOZOMU5PXGZYEX \ 
  --treasury_address GBLH7JNNONQ7DZPL4J2FQOUWOKUKTCVRNYVPJLJBWHWCLYJHLVVGULGO \ 
  --fee 10000000 \ 
  --min_claim_amount 1000000 \ 
  --max_claim_per_tx 1000000000 \ 
  --claim_cooldown 86400 \ 
  --treasury_fee_rate 500


SBJJSC24J2TU73IADP64LJ2MQYXGWFHJHM74BK6WOV3ZMSBPHFJERAW6


stellar contract invoke --id CDSSDKJZACMXIE4C25TAVLWUQWLRNXSC2TLOFTTRSUAOZOMU5PXGZYEX \                                           
    --source SBJJSC24J2TU73IADP64LJ2MQYXGWFHJHM74BK6WOV3ZMSBPHFJERAW6 \                 
    --network mainnet \                                 
    -- set_admin \                                      
    --new_admin GBLH7JNNONQ7DZPL4J2FQOUWOKUKTCVRNYVPJLJBWHWCLYJHLVVGULGO

stellar contract invoke --id CDSSDKJZACMXIE4C25TAVLWUQWLRNXSC2TLOFTTRSUAOZOMU5PXGZYEX --source whalehub-main --network mainnet -- set_admin --new_admin  GBLH7JNNONQ7DZPL4J2FQOUWOKUKTCVRNYVPJLJBWHWCLYJHLVVGULGO


stellar contract invoke --id <previous staking contract> --source <previous staking contract admin secret key> --network mainnet -- update_sac_admin --admin <previous staking contract admin address> --new_admin <new updated staking contract>

soroban contract deploy --wasm $WASM_OUTPUT_DIR/whalehub_staking.wasm --source "deployer_mainnet" --network "mainnet"

soroban contract deploy --wasm $WASM_OUTPUT_DIR/whalehub_staking.wasm --source "deployer_mainnet" --network "mainnet"


soroban contract deploy --wasm "whalehub_staking.wasm" --source "whalehub-main" --network "mainnet"
soroban contract deploy --wasm "whalehub_rewards.wasm" --source "whalehub-main" --network "mainnet"

Staking = CBGYTUQDPZAKOM2YULOSBLQB4XPNSUGD6GBEK75EWEOAXLAVOD7C4HGO
Rewards = CC67FMPFQNGSFTXK53VUJ5FUTYQC6XVJPFZJCVTP4EGH7ZCQBNFOXQ5P


  stellar contract invoke --id CAIPTIO4RN5SVE3M5IKD3ME4IPH5TOHIUNXRI7NCLYRHI3SXQLJRYJU5 -- upgrade \
    --admin GBLH7JNNONQ7DZPL4J2FQOUWOKUKTCVRNYVPJLJBWHWCLYJHLVVGULGO \
    --new_wasm_hash 9e15f227bda12887d00451a1fa856878c9bf9b8887125fe5bd33ee53245f506c



stellar contract invoke \
    --id CBGYTUQDPZAKOM2YULOSBLQB4XPNSUGD6GBEK75EWEOAXLAVOD7C4HGO \
    --source whalehub-main \
    --network mainnet \
    -- \
    initialize \
    --admin GBLH7JNNONQ7DZPL4J2FQOUWOKUKTCVRNYVPJLJBWHWCLYJHLVVGULGO \
    --treasury_address GBLH7JNNONQ7DZPL4J2FQOUWOKUKTCVRNYVPJLJBWHWCLYJHLVVGULGO\
    --aqua_token CAUIKL3IYGMERDRUN6YSCLWVAKIFG5Q4YJHUKM4S4NJZQIA3BAS6OJPK \
    --blub_token CCZ6P3MF2DX5R2NTRLFUAYFTTM3AR5XMIAB7XICJYTYS72XPV6C2OZCR \
    --liquidity_contract CBL7MWLEZ4SU6YC5XL4T3WXKNKNO2UQVDVONOQSW5VVCYFWORROHY4AM \
    --ice_tokens '{"ice_token":"CARCKZ66U4AI2545NS4RAF47QVEXG3PRRCDA52H4Q3FDRAGSMP4BRU3W","govern_ice_token":"CCTE3UCZZ6RCG3IN7HGFQ6TVJS5UDSZL3BUAVC3OQVWXRLTPFGOLPSNV","upvote_ice_token":"CDSOP5Y4ZOWA7UNV76KB7QM6IZHX6UAMGYQ5THT35AEWRXF5QTKERG4R","downvote_ice_token":"CDZOOVFGMCNQNGGBYJ5BEMDXVOBE7QURYBBMXVXYXDEWIFK3BJ345QHX"}' \
    --vault_treasury GBLH7JNNONQ7DZPL4J2FQOUWOKUKTCVRNYVPJLJBWHWCLYJHLVVGULGO \
    --vault_fee_bps 100



    stellar contract invoke \
    --id CC67FMPFQNGSFTXK53VUJ5FUTYQC6XVJPFZJCVTP4EGH7ZCQBNFOXQ5P \
    --source whalehub-main \
    --network mainnet \
    -- \
    initialize \
    --admin GBLH7JNNONQ7DZPL4J2FQOUWOKUKTCVRNYVPJLJBWHWCLYJHLVVGULGO \
    --staking_contract CBGYTUQDPZAKOM2YULOSBLQB4XPNSUGD6GBEK75EWEOAXLAVOD7C4HGO \
    --reward_token CAUIKL3IYGMERDRUN6YSCLWVAKIFG5Q4YJHUKM4S4NJZQIA3BAS6OJPK \
    --treasury_address GBLH7JNNONQ7DZPL4J2FQOUWOKUKTCVRNYVPJLJBWHWCLYJHLVVGULGO \
    --min_claim_amount 10000000 \
    --max_claim_per_tx 100000000000 \
    --claim_cooldown 86400 \
    --treasury_fee_rate 500


    stellar contract invoke --id CAIPTIO4RN5SVE3M5IKD3ME4IPH5TOHIUNXRI7NCLYRHI3SXQLJRYJU5 --source whalehub-main --network mainnet -- update_sac_admin --admin GBLH7JNNONQ7DZPL4J2FQOUWOKUKTCVRNYVPJLJBWHWCLYJHLVVGULGO --new_admin CBGYTUQDPZAKOM2YULOSBLQB4XPNSUGD6GBEK75EWEOAXLAVOD7C4HGO


   stellar contract install \
    --source whalehub-main \
    --network mainnet \
    --wasm whalehub_staking.wasm


    a7fc77a01139a52eb4ed209b33222ffddada8833495fd802029d050da4f47fe0

    stellar contract invoke \
    --id CBGYTUQDPZAKOM2YULOSBLQB4XPNSUGD6GBEK75EWEOAXLAVOD7C4HGO \
    --source whalehub-main \
    --network mainnet \
    -- \
    upgrade \
    --admin GBLH7JNNONQ7DZPL4J2FQOUWOKUKTCVRNYVPJLJBWHWCLYJHLVVGULGO \
    --new_wasm_hash cac93e1c0bb350bf728945fb0d979357ca800c8b0b421c0253ed3167983f1a2d


    stellar contract invoke \
    --id CBGYTUQDPZAKOM2YULOSBLQB4XPNSUGD6GBEK75EWEOAXLAVOD7C4HGO \
    --source whalehub-main \
    --network mainnet \
    -- \
    update_blub_token \
    --admin GBLH7JNNONQ7DZPL4J2FQOUWOKUKTCVRNYVPJLJBWHWCLYJHLVVGULGO \
    --new_blub_token CDSSDKJZACMXIE4C25TAVLWUQWLRNXSC2TLOFTTRSUAOZOMU5PXGZYEX