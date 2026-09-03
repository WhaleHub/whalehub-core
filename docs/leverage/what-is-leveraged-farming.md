# What Is Leveraged Farming

Leveraged farming lets you multiply an Aquarius liquidity position without adding more capital. You supply
LP as equity, the vault borrows against it on [Blend](https://docs.blend.capital) and turns the borrowed
asset into more LP — all in one signed transaction.

> **Status: testnet preview.** The leverage vault runs on Stellar **testnet** at
> [app.whalehub.io/leverage](https://app.whalehub.io/leverage). It is not live on mainnet, has not been
> audited, and holds no real funds. Mainnet requires the production oracle, an external audit and a funded
> Blend pool.

## What you get

| | Plain liquidity providing | Leveraged farming |
|---|---|---|
| What you deposit | LP (or a token pair) | The same LP, as equity |
| Exposure | 1× your deposit | Up to ~1.67× your deposit |
| Debt | None | A borrow on Blend, against your LP |
| Yield | Pool fees + AQUA rewards | The same yield on a larger position, minus borrow cost |
| Can be liquidated | No | **Yes** |
| Exit | Withdraw anytime | Unwind anytime, partially or fully |

## It is a spread trade, not a yield boost

Leverage does not create yield. It buys you more of the pool's yield with borrowed money, and you pay the
borrow rate on the borrowed part only:

```
net APY on equity = (LP APY × L) − (borrow APR × (L − 1))

where L = leverage, e.g. 1.55
```

Leverage pays **only while the borrow rate sits below the LP yield**. If the borrow rate rises above it,
levering up earns less than simply providing liquidity. That is why the interface shows the live borrow rate,
your net APY, and the **break-even borrow rate** for your chosen leverage before you sign anything.

Worked example on measured rates (Aquarius XLM/USDC concentrated at 10.77% unboosted, Blend XLM borrow at
0.10%, 16 Aug 2026):

| Leverage | LP exposure on $1,000 | Debt | Net APY on equity |
|---|---|---|---|
| 1.00× (plain LP) | $1,000 | — | 10.77% |
| 1.55× | $1,550 | $550 of XLM | ~14.8% |

These are arithmetic outputs of the rates above, not projections. Blend rates move with utilisation and can
change without notice.

## Why the borrowed asset is XLM

Blend prices each asset by how much of it is being borrowed. On Stellar, borrow demand is for dollars, not
for XLM — so USDC borrows at roughly 11% while XLM sits near its rate floor at **0.10%**. Borrowing USDC at
11% against a 10.77% LP yield would *lose* money at any leverage. Borrowing XLM is what makes the product
work, and it is a Stellar-specific advantage.

## What you are taking on

- **Liquidation.** If the value of your LP collateral falls far enough against your debt, Blend liquidates
  part of the position. The interface caps leverage at 92% of the liquidation boundary to leave headroom.
- **Direction.** Borrowing XLM against an LP that is half XLM makes the position partly *short* XLM. A large
  XLM rally grows the debt faster than the collateral — that is the move that liquidates, and it also means a
  rally returns less than plain liquidity providing would have.
- **The spread inverting.** If the borrow rate climbs above the LP yield, unwind or deleverage.
- **Shared losses (v1).** In the current design the vault holds one Blend position and depositors hold shares
  of it, so a liquidation is shared across the vault rather than falling only on the position that caused it.
  Per-user isolation is planned before mainnet.

## Fees

One fee is planned: **10% of net profit after borrow costs**, measured against a per-share high-water mark.
No management fee, no deposit fee, no withdrawal fee. A fee on principal or on gross yield would consume the
few percentage points that leverage adds in the first place.

| | |
|---|---|
| What is charged | 10% of profit, after the interest paid on your debt |
| When nothing is charged | In a drawdown, and while a position recovers to its previous peak |
| High-water mark | Per share — the same gain is never charged twice |
| Deposit / withdrawal / management fee | None |

Of the fee collected, **30% is routed to the BLUB-AQUA pool** as two-sided liquidity, which stays
protocol-owned. That is pool depth rather than a buyback: the leverage product generates fees, and those
fees deepen the pool behind AQUA staking and the BLUB vault.

The fee is not live yet — the testnet vault charges nothing, and the fee module ships with mainnet.

## Next

- [How Leverage Works](how-leverage-works.md) — the one-transaction mechanism, step by step.
- [Oracle and Risk Controls](oracle-and-risk.md) — how the collateral is priced and what stops it being gamed.
