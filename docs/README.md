# Introducing Whalehub

Whalehub is a DeFi protocol built on the **Stellar Network** that lets you earn yield on your AQUA tokens through staking and automated liquidity vaults.

## What You Can Do

| Feature | Description |
|---------|-------------|
| **Stake AQUA** | Lock AQUA tokens for a chosen period and earn BLUB rewards |
| **Restake BLUB** | Compound your BLUB earnings back into the staking pool |
| **Liquidity Vaults** | Deposit into auto-compounding AMM pools for hands-off yield |
| **Claim Rewards** | Collect BLUB rewards earned from your staked position |

## Quick Numbers

| Parameter | Value |
|-----------|-------|
| Token you deposit | AQUA |
| Token you earn | BLUB |
| BLUB per AQUA locked | 1.0 BLUB (+ 0.1 BLUB to liquidity) |
| Minimum lock | 7 days |
| Withdrawal cooldown | 10 days after lock expires |
| Reward claim cooldown | 7 days |
| Vault fee | `vault_fee_bps` (15%) on claimed pool emissions; none on bribe income |
| Auto-compound frequency | 4x/day (BLUB-AQUA), 6x/day (other pools) |

## How It Fits Together

Whalehub operates on three layers:

1. **Smart contracts** on Stellar (Soroban) — handle staking, rewards, and vault logic
2. **Backend server** — automates reward distribution, compounding, and ICE governance
3. **Web app** — user interface for staking, vaults, and claiming rewards

The protocol earns yield by deploying staked AQUA into Aquarius AMM liquidity pools. Rewards flow back to stakers as BLUB tokens, while a portion strengthens the protocol's own liquidity position.
