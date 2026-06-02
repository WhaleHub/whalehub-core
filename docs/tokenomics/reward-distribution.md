# Reward Distribution

Whalehub distributes rewards using the **Synthetix reward model** — a proven approach where rewards are split proportionally based on each user's share of the staking pool.

> **Status (2026-06):** the BLUB-AQUA pool is currently awaiting whitelist approval from the Aquarius team, so the AQUA-rewards leg of the flow below is **paused**. No AQUA is being earned by POL, so no BLUB is being distributed to stakers from this source. Staked positions are unaffected; distribution resumes automatically once the pool is re-whitelisted.

## How Rewards Flow

```mermaid
sequenceDiagram
    participant Aquarius Pool
    participant Backend
    participant Treasury
    participant Staking Contract
    participant Stakers

    Note over Backend: Every 30 minutes

    Backend->>Aquarius Pool: Claim farming rewards (AQUA)

    rect rgb(220, 240, 220)
        Note over Backend: Split earnings
        Backend->>Treasury: 30% to treasury
        Backend->>Backend: Swap 70% AQUA → BLUB
        Backend->>Staking Contract: Distribute BLUB as rewards
    end

    Staking Contract->>Staking Contract: Update global reward rate
    Note over Stakers: Each staker's pending rewards increase
```

## The Math

When the protocol distributes `R` BLUB and `T` BLUB is currently staked:

```
Global rate increases by:  R / T

Your earned rewards:       Your staked BLUB × (Current rate - Your last checkpoint rate)
```

This means:
- If you hold **1%** of total staked BLUB, you earn **1%** of every distribution
- Your rewards accumulate automatically — no action needed until claiming
- The rate checkpoint updates whenever you lock, unstake, or claim

## Distribution Frequency

| Action | Frequency |
|--------|-----------|
| Pool reward claiming | Every 30 minutes |
| Treasury split (30%) | Every 30 minutes |
| Staker distribution (70%) | Every 30 minutes |
| User claiming | Every 7 days (minimum) |

## Fee Structure

| Fee | Amount | Destination |
|-----|--------|-------------|
| Treasury fee | 30% of pool earnings | Protocol treasury |
| Staker share | 70% of pool earnings | Distributed as BLUB |
| Staking fee | None | — |
| Claiming fee | None (only gas) | — |
| Unstaking fee | None (only gas) | — |
