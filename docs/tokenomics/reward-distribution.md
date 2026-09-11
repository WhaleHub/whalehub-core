# Reward Distribution

Whalehub earns income by voting its locked **ICE** power on Aquarius and harvesting the bribes that income attracts. Every unit of that harvest is recycled back into the protocol — **there is no treasury cut on reward income.**

The harvest is split three ways. The proportions are on-chain-verifiable in every distribution:

| Stream | Share | Who it pays | What it becomes |
|---|---:|---|---|
| **A — Stakers** | 50% | Everyone staking BLUB | AQUA bought → BLUB → distributed pro-rata |
| **B — Vault LPs** | 30% | BLUB-AQUA vault depositors | AQUA deposited as liquidity → deeper positions |
| **C — Protocol liquidity** | 20% | The protocol's own POL | AQUA deposited as liquidity → deeper pool |

> BLUB is a **floating** asset. It is not pegged and not redeemable. Rewards are always **bought on the open market, never minted**, so distributions are non-dilutive.

---

## Stream A — Stakers (50%)

The staker tranche is swapped AQUA → BLUB on the Aquarius router (chunked to limit price impact) and handed to the staking contract via `add_rewards`. From there it accrues through the **Synthetix reward model**: when the protocol distributes `R` BLUB against `T` BLUB staked, the global rate rises by `R / T`, and your earned amount is

```
your BLUB × (current rate − your last checkpoint rate)
```

Hold 1% of staked BLUB, earn 1% of every distribution. The checkpoint updates whenever you lock, unstake, or claim. Nothing accrues to a wallet that is not staking.

## Stream B — Vault LPs (30%)

This tranche is deposited into the BLUB-AQUA pool as **AQUA only** — it is not half-swapped into BLUB first. Two reasons:

- The pool currently holds far more BLUB than AQUA, so AQUA is the scarce leg. The StableSwap imbalance term therefore *rewards* adding it: at present reserves, 100,000 AQUA deposited single-sided mints roughly **137,357 LP**, against roughly **118,108 LP** for the same value added balanced. Buying BLUB first discarded that premium.
- Adding the scarce leg moves the pool back toward par instead of deeper away from it.

The tranche is then split across **two reward classes**, both backed by the same Aquarius pool:

| Class | Share of Stream B | Who is in it |
|---|---:|---|
| **Single-sided AQUA** | 70% | Depositors who entered the vault with AQUA only |
| **Balanced** | 30% | Depositors who entered with both tokens |

Deposits land via `admin_compound_deposit`, which raises that class's `total_lp_tokens` **without minting vault shares**. Every depositor in the class grows pro-rata, automatically. There is nothing to claim and no sell pressure — the reward becomes depth.

Protocol-owned liquidity is tracked separately in `aqua_blub_lp_position`, outside every class's `total_lp_tokens`, so **POL earns nothing from Stream B**. That exclusion is structural, not a filter that could be misconfigured. POL is funded by Stream C instead.

Liquidity added directly on aqua.network, outside the vault, earns nothing from this stream. That is the design: the yield exists through the platform.

## Stream C — Protocol-owned liquidity (20%)

Transferred to the staking contract and deposited single-sided as AQUA via `manual_deposit_pol`, for the same two reasons as Stream B. The contract credits `ProtocolOwnedLiquidity.aqua_blub_lp_position`; vault accounting is untouched.

---

## Slippage protection

Single-sided deposits into an off-ratio stable pool are sandwichable if they accept any amount of LP back. Every deposit therefore quotes the pool's own `calc_token_amount` live and passes a `min_lp_out` floor cut by a configured tolerance. A deposit that cannot be quoted is refused rather than sent blind.

## Cadence

| Action | Frequency |
|---|---|
| Vote optimization (target market) | Weekly (each voting epoch) |
| Bribe collection | As bribes arrive (~daily) |
| Harvest split A / B / C | Every 6 hours |
| Vault auto-compound (other pools) | Every 4 hours |
| User claiming | Every 7 days (minimum) |

## Fees

| Fee | Amount |
|---|---|
| Treasury cut on bribe income | **None** — 100% recycled |
| Staking, claiming, unstaking | None (gas only) |
| Vault fee on claimed pool emissions | `vault_fee_bps`, currently 15% |

The vault fee applies only to AQUA claimed from a pool's own Aquarius emissions inside `claim_and_compound`. Bribe income never passes through that path, so none of the three streams above is reduced by it. The BLUB-AQUA pool has been de-whitelisted since mid-2026 and emits nothing, so this fee currently touches only the non-BLUB vault pools.

---

## Superseded design

Earlier versions of this page described income from farming protocol-owned liquidity in the BLUB-AQUA pool, with a 30% treasury cut and the remaining 70% to stakers. Both are gone: the pool stopped emitting AQUA when Aquarius de-whitelisted it, and the treasury cut on reward income was removed in July 2026. See [Bribes Harvesting Module](bribes-harvesting.md) for how the replacement income is sourced.
