# What Are Vaults

Vaults are auto-compounding liquidity positions on Aquarius AMM pools. You deposit token pairs, and Whalehub automatically reinvests earned rewards back into the pool to grow your position.

## How Vaults Differ from Staking

| | Staking | Vaults |
|---|---|---|
| What you deposit | AQUA (or restake BLUB) | Token pairs (e.g. XLM + AQUA) |
| What you earn | BLUB rewards | Growing LP position |
| How you earn | Share of protocol reward pool | AMM trading fees + AQUA farming rewards |
| Compounding | Manual (claim + restake) | Automatic (4-6x per day) |
| Lock period | Fixed (your choice) | None — withdraw anytime |
| Fee | None | None on bribe income; 15% on claimed pool emissions |

## Available Pools

| Pool | Tokens | Status |
|------|--------|--------|
| Pool 0 | BLUB + AQUA | Active (also contains Protocol Owned Liquidity) |
| Pool 2 | XLM + AQUA | Active |

## How Auto-Compounding Works

BLUB-AQUA is funded by the bribe harvest (the pool itself emits nothing since Aquarius de-whitelisted it):

```
Every 6 hours:
└── 30% of the bribe harvest (Stream B), as AQUA only
    ├── 70% → single-sided-AQUA reward class
    └── 30% → balanced reward class
        └── Deposited as liquidity; your LP share grows automatically
```

The other pools compound their own emissions:

```
Every 4 hours:
├── Backend claims AQUA farming rewards from pool
├── vault_fee_bps (15%) → treasury
└── Remainder → split into both pool tokens
    └── Re-deposited into the pool as new liquidity
        └── Your LP share grows automatically
```

Compounding returns are effectively flat above about 4 cycles a day: a pool with 50% base APY compounds to roughly 64% effective APY at any cadence from 6x daily upward.

## ICE Boost for Vaults

> **Important: Due to Stellar protocol limitations, ICE tokens (which are created via classic Stellar claimable balances) cannot currently be locked directly by a Soroban smart contract. This means vault LP deposited by the contract does not benefit from the ICE 2.5x reward boost. We are actively working on a solution to route vault deposits through an ICE-holding wallet to unlock boosted yields for vault users. This feature is planned for a future release.**

## Compound APY Formula

```
Compounded APY = (1 + base_rate / 17,520)^17,520 - 1

Where 17,520 = 48 compounds/day × 365 days
```
