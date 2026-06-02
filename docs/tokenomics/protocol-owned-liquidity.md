# Protocol Owned Liquidity

Protocol Owned Liquidity (POL) is liquidity that belongs to the Whalehub protocol itself, not to individual users. It generates fees and rewards that are distributed to stakers.

## How POL Is Created

When users lock AQUA, a portion is allocated to building protocol liquidity:

```
User locks 100 AQUA
├── 10 AQUA → admin wallet (for BLUB-AQUA pool deposit)
└── 10 BLUB → minted to admin wallet (paired with the AQUA above)
```

The admin wallet deposits these into the BLUB-AQUA Aquarius pool — [`CAMXZXXBD7DFBLYLHUW24U4MY37X7SU5XXT5ZVVUBXRXWLAIM7INI7G2`](https://stellar.expert/explorer/public/contract/CAMXZXXBD7DFBLYLHUW24U4MY37X7SU5XXT5ZVVUBXRXWLAIM7INI7G2) — creating LP tokens owned by the protocol.

## POL in Pool 0 (BLUB-AQUA)

The BLUB-AQUA pool contains both POL and vault user LP. The contract tracks vault user LP separately, so:

```
POL LP = Total contract LP balance - Vault user LP (tracked in contract)
```

> **Note (2026-06):** the BLUB-AQUA pool is awaiting whitelist approval from the Aquarius team. Until that approval lands, the pool earns 0 AQUA emissions, so POL earnings and the staker distribution described below are temporarily paused. The POL position itself remains intact; distribution resumes automatically when the pool is re-whitelisted.

## How POL Earnings Are Distributed

```mermaid
flowchart TD
    CLAIM[Backend claims pool rewards] --> SPLIT{Split by LP ratio}
    SPLIT --> POL_SHARE[POL share of rewards]
    SPLIT --> VAULT_SHARE[Vault share of rewards]

    POL_SHARE --> TREASURY[30% → Treasury]
    POL_SHARE --> STAKERS[70% → Swap to BLUB → Distribute to stakers]

    VAULT_SHARE --> V_TREASURY[30% → Treasury]
    VAULT_SHARE --> COMPOUND[70% → Auto-compound back into pool]
```

## What POL Provides

- **Permanent liquidity** — unlike user LP, POL is never withdrawn
- **Price stability** — deeper liquidity means lower slippage for BLUB trades
- **Sustainable yield** — POL earnings fund ongoing staker rewards
- **Protocol resilience** — liquidity remains even if individual users withdraw

## POL Dashboard

The frontend displays real-time POL metrics:
- Total POL in AQUA and BLUB
- POL USD value
- POL share of the total pool
- Pool APY and compounded APY
