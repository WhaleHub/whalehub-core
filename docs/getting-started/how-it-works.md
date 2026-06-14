# How It Works

Whalehub connects users, smart contracts, liquidity pools, and a backend automation server into a single yield-generating system.

> **Status (2026-06):** staker rewards are active. Income is driven by the [Bribes Harvesting Module (v2)](../tokenomics/bribes-harvesting.md) — Whalehub votes its ICE on the **highest-yielding Aquarius market** and routes the harvested bribes to stakers as BLUB. The legacy POL pool-emissions leg (BLUB-AQUA) is paused pending Aquarius re-whitelisting and resumes automatically if approved — but it is no longer required for rewards.

## System Overview

```mermaid
graph TB
    subgraph Users
        WALLET[User Wallet<br/>Freighter / LOBSTR / WalletConnect]
    end

    subgraph Website
        PAGE_STAKE[Stake AQUA]
        PAGE_YIELD[Unstake & Claim]
        PAGE_LP[Liquidity Vaults]
    end

    subgraph Stellar Blockchain
        subgraph Smart Contracts
            STAKING[Staking Contract]
        end
        subgraph Tokens
            AQUA[AQUA]
            BLUB[BLUB]
        end
        subgraph Liquidity Pools
            POOL_BA[BLUB-AQUA Pool]
            POOL_XA[XLM-AQUA Pool]
        end
    end

    subgraph Backend
        CRON[Auto-compounder<br/>runs every 30 min]
    end

    subgraph Admin
        ADMIN[Protocol Manager<br/>blub-issuer-v2]
    end

    WALLET --> PAGE_STAKE & PAGE_YIELD & PAGE_LP
    PAGE_STAKE & PAGE_YIELD & PAGE_LP --> STAKING
    STAKING --> AQUA & BLUB
    STAKING --> POOL_BA
    CRON --> STAKING
    CRON --> ADMIN
    ADMIN --> POOL_BA
```

## The Yield Cycle

1. **User locks AQUA** — 90% stays in the contract (queued for ICE governance locking), 10% goes to the admin wallet for liquidity pool deposits
2. **BLUB is minted** — 1.0 BLUB per AQUA locked goes to the user's staking balance, 0.1 BLUB goes to the admin for pool liquidity
3. **Liquidity earns rewards** — AQUA and BLUB deposited into Aquarius AMM pools earn trading fees and AQUA farming rewards
4. **Rewards are distributed** — Every 30 minutes, the backend claims pool rewards, swaps to BLUB, and distributes to stakers
5. **User claims BLUB** — Stakers can claim their accumulated BLUB rewards (7-day cooldown between claims)

## Two Ways to Earn

### Staking
Lock AQUA for a chosen duration. Earn BLUB rewards from pool earnings distributed proportionally to all stakers. Longer locks = higher reward multiplier.

### Liquidity Vaults
Deposit token pairs into auto-compounding AMM pools. The backend automatically claims rewards and re-deposits them 48 times per day, growing your LP position through compound interest.
