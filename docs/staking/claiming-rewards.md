# Claiming Rewards

BLUB rewards accumulate continuously while your tokens are staked. You can claim them every 7 days.

> **Status (2026-06):** new BLUB rewards are temporarily not accruing because the BLUB-AQUA pool is awaiting whitelist approval from the Aquarius team. Any rewards already accumulated before this pause remain claimable on the normal 7-day cadence; new rewards resume automatically once the pool is re-whitelisted.

## How Claiming Works

```mermaid
flowchart TD
    CLAIM[User clicks Claim Rewards] --> Q{7 days since last claim?}
    Q -- No --> REJECT[Rejected — too soon]
    Q -- Yes --> SNAP[Calculate pending rewards]
    SNAP --> PAY[Send BLUB to user's wallet]
    PAY --> RESET[Reset pending balance to 0]
    RESET --> TIME[Record claim timestamp]
```

## Important Notes

- **Rewards are NOT automatic** — you must claim them manually
- **7-day cooldown** between claims
- **Rewards are separate from unstaking** — withdrawing your locked tokens does NOT automatically send your rewards
- Rewards continue accumulating even if you don't claim them — nothing is lost by waiting

## How Rewards Are Calculated

Whalehub uses the **Synthetix reward model** — rewards are split fairly based on each user's share of the total staked pool.

```
Your pending rewards = Your staked BLUB × (Current reward rate − Your last checkpoint rate)
```

The reward rate increases every time the protocol distributes new BLUB from pool earnings. Your share is proportional to how much BLUB you have staked relative to the total.

## Where Do Rewards Come From?

Every 30 minutes, the backend:

1. Claims AQUA farming rewards from the BLUB-AQUA liquidity pool
2. Sends 30% to the protocol treasury
3. Swaps 70% to BLUB
4. Distributes that BLUB to all stakers proportionally
