# Yield Mechanics

WhaleHub is a yield optimization protocol on Stellar. It aggregates ICE voting power from all BLUB stakers to maximize AQUA rewards through [Aqua.network](https://aqua.network), then compounds those rewards back to stakers through an automated flywheel. Think of it as **Convex for Stellar** — you get amplified yield without needing to manage votes, lock tokens for years, or chase bribes yourself.

> **TL;DR:** You stake BLUB -> WhaleHub uses its massive ICE voting power to earn outsized AQUA rewards -> those rewards flow back to you as a staker, compounding over time. No emissions farming. No ponzi loops. Real yield from real protocol activity.

---

## The WhaleHub Flywheel

```
                    ┌─────────────────────────┐
                    │   You Stake BLUB Tokens  │
                    └────────────┬────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │  WhaleHub Accumulates    │
                    │  Massive ICE Position    │
                    └────────────┬────────────┘
                                 │
                    ┌────────────┴────────────┐
                    │                         │
                    ▼                         ▼
         ┌──────────────────┐     ┌──────────────────┐
         │  Votes on AQUA-  │     │  Earns Bribes    │
         │  BLUB Pool for   │     │  from Protocols   │
         │  Max Rewards     │     │  Wanting Votes    │
         └────────┬─────────┘     └────────┬─────────┘
                  │                         │
                  └────────────┬────────────┘
                               │
                               ▼
                  ┌─────────────────────────┐
                  │  AQUA Rewards Earned    │
                  │  Every Epoch            │
                  └────────────┬────────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
              ▼                ▼                ▼
    ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
    │  Distributed │  │  Reinvested  │  │  Grows POL   │
    │  to BLUB     │  │  into More   │  │  (Protocol-  │
    │  Stakers     │  │  ICE Voting  │  │  Owned       │
    │              │  │  Power       │  │  Liquidity)  │
    └──────────────┘  └──────────────┘  └──────┬───────┘
                                               │
                                               ▼
                                     ┌──────────────────┐
                                     │ POL Earns More   │
                                     │ AQUA → Buys BLUB │
                                     │ → Cycle Repeats  │
                                     └──────────────────┘
```

The more BLUB staked -> the more ICE WhaleHub controls -> the bigger the rewards -> the more value flows back to stakers. This is a **compounding flywheel**, not a one-time payout.

---

## Three Yield Sources

WhaleHub generates yield from three distinct, complementary mechanisms:

### 1. ICE Voting Rewards (Core Yield)

WhaleHub locks AQUA into ICE at maximum duration to achieve the highest possible voting multiplier (up to **10x** boost). This concentrated ICE position is directed toward the AQUA-BLUB liquidity pool to ensure it qualifies for — and ranks highly in — the Aquarius reward zone.

**Why this matters for you:** As an individual AQUA holder, you'd need to lock your own AQUA for up to 3 years and manually manage your votes every epoch to earn these rewards. WhaleHub does this at scale, with a far larger ICE position than any individual could realistically accumulate — meaning higher ranking, bigger share of the reward pool, better returns.

A portion of the AQUA rewards earned each epoch is allocated to all BLUB stakers and distributed automatically.

### 2. Bribe Revenue (Bonus Yield)

In the Aquarius ecosystem, protocols and projects can offer **bribes** — incentive payments in AQUA or other tokens — to ICE holders who vote for their preferred liquidity pools. The larger WhaleHub's ICE position grows, the more attractive it becomes as a voting bloc for bribe-seeking projects.

**How it works:**
- Projects want their trading pair to enter or rank higher in the Aquarius reward zone
- They offer bribes to large ICE holders to vote for their pool
- WhaleHub earns these bribes, swaps them to BLUB, and allocates the proceeds to stakers

**Why this matters for you:** Bribe markets are a proven DeFi primitive (see: Curve Wars, Convex, Votium). As Stellar's DeFi ecosystem grows, bribe revenue is expected to increase. You get access to this revenue stream simply by staking BLUB.

### 3. Protocol-Owned Liquidity — POL (Compounding Yield)

WhaleHub maintains and continuously grows its own liquidity position in AQUA-BLUB pools. This **Protocol-Owned Liquidity (POL)** serves two critical functions:

- **Earns swap fees and AQUA rewards** from providing liquidity — revenue that belongs to the protocol, not mercenary LPs
- **Provides permanent price support** for BLUB, ensuring deep liquidity is always available regardless of market conditions

AQUA rewards and fees earned by POL are used to **buy BLUB from the open market**, creating consistent buy pressure and adding value back to stakers.

> **Why buy, not mint?** Buying BLUB from existing liquidity pools supports the token price directly. Minting would increase supply and dilute existing holders. WhaleHub prioritizes buying from the market to create real demand.

**Live BLUB-AQUA pool:** [`CAMXZXXBD7DFBLYLHUW24U4MY37X7SU5XXT5ZVVUBXRXWLAIM7INI7G2`](https://stellar.expert/explorer/public/contract/CAMXZXXBD7DFBLYLHUW24U4MY37X7SU5XXT5ZVVUBXRXWLAIM7INI7G2) on Aquarius (StableSwap). This is the active POL pool; any older liquidity-contract address (e.g. from earlier deploy scripts) is deprecated.

> **Note on current rewards:** staker rewards are active and now flow primarily from the [Bribes Harvesting Module (v2)](../tokenomics/bribes-harvesting.md) rather than POL pool emissions. Whalehub votes its ICE on the **highest-yielding Aquarius market** each epoch, harvests the bribes, and distributes them to stakers as BLUB. POL liquidity remains in place; the pool-emissions leg resumes automatically if the BLUB-AQUA pool is re-whitelisted.

---

## Why This Yield is Sustainable

Most DeFi yield comes from one of two sources: inflationary token emissions (unsustainable) or real economic activity (sustainable). Here's where WhaleHub's yield actually comes from:

| Source | Type | Sustainability |
|--------|------|---------------|
| AQUA rewards from voting | Protocol-level incentives from Aqua.network | Backed by Aquarius — an established protocol with significant TVL |
| Bribe revenue | Payment from projects seeking liquidity | Grows with ecosystem adoption; projects pay because liquidity has real value |
| POL swap fees | Trading activity on AQUA-BLUB pair | Organic — generated by actual trading volume |

**WhaleHub does not print tokens to pay yield.** Your rewards come from vote-directed AQUA emissions, bribe markets, and real trading fees — not from inflating BLUB supply.

---

## Comparison: Staking BLUB vs. Going Solo

| | Staking with WhaleHub | Managing AQUA/ICE Yourself |
|---|---|---|
| Lock period | None — stake and unstake BLUB | Must lock AQUA for up to 3 years for max ICE boost |
| Voting | Automated, optimized by protocol | Manual every epoch |
| Bribe access | Aggregated — protocol negotiates | Must find and claim individually |
| ICE multiplier | Leverages massive pooled position | Limited to your personal holdings |
| Compounding | Automatic via POL reinvestment | Manual — you must re-lock and re-vote |
| Complexity | Stake once, earn | High — multiple transactions per epoch |

---

## Key Terms

- **BLUB** — WhaleHub's native utility token. Stake it to earn yield from the protocol's aggregated ICE voting power.
- **ICE** — Received by freezing (locking) AQUA on Aqua.network. Grants boosted voting power and increased rewards. The longer the lock, the more ICE (up to 10x for 3-year locks). ICE melts over time as the unlock date approaches.
- **AQUA** — The native token of the Aquarius protocol, used for voting, governance, and as the primary reward token.
- **Epoch** — A voting period in the Aquarius system after which votes are tallied and rewards are distributed.
- **POL (Protocol-Owned Liquidity)** — Liquidity positions owned by the WhaleHub protocol itself, not by external providers. This ensures permanent liquidity and generates ongoing revenue.
- **Bribes** — Incentive payments offered by projects to ICE holders in exchange for directing votes toward their preferred liquidity pools.
- **Reward Zone** — The set of liquidity pools on Aqua.network that qualify for AQUA rewards based on community voting.
