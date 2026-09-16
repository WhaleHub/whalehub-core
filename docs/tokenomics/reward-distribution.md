# Reward Distribution

Whalehub earns income by voting its pooled **ICE** power on Aquarius and collecting the voting revenue that power attracts. That revenue arrives as **AQUA**.

Since v3, stakers are paid in **AQUA** — the same asset the revenue arrives in. Nothing is swapped on your behalf and nothing is minted to cover a payout.

The revenue is split four ways. The proportions are on-chain parameters, set by the multisig and readable at any time via `get_reward_policy`:

| Stream | Share | Who it pays | What it becomes |
|---|---:|---|---|
| **A — Stakers** | 50% | Everyone staking BLUB | AQUA, claimable directly |
| **B — Vault LPs** | 30% | BLUB-AQUA vault depositors | AQUA deposited as liquidity → deeper positions |
| **C — Protocol liquidity** | 10% | The protocol's own POL | AQUA deposited as liquidity → deeper pool |
| **D — Treasury** | 10% | Runway, audits, operations | Held |

> **Status (16 September 2026):** v3 is live on mainnet and stakers are paid in AQUA. Stream D is now wired up — the treasury destination is configured and the split runs the full 50 / 30 / 10 / 10 from the next distribution onward. Between 14 and 16 September the distributor was misconfigured and routed 100% of revenue to stakers; that is fixed. The on-chain policy is the source of truth and is readable by anyone via `get_reward_policy`.

> BLUB is a **floating** asset. It is not pegged and not redeemable. Its market price is set by the pool, not maintained by the protocol. Rewards are paid from revenue the pooled ICE position already earned — never minted — so distributions are non-dilutive.

---

## What changed in v3, and why

v2 paid Stream A in BLUB. To do that it took the AQUA it had just earned and bought BLUB with it on the open market, then handed that BLUB to stakers.

That made every single reward a buy order into the BLUB-AQUA pool, and most of it was promptly sold by recipients who wanted AQUA anyway. The protocol was spending its revenue to move its own market in one direction and paying the round-trip cost on both legs.

v3 stops. The AQUA that pooled ICE voting earns is handed to stakers as AQUA. The protocol buys nothing, the pool is left alone, and stakers receive the asset they were always going to end up holding.

Deposits still build the engine; the engine's revenue is what pays you. Your deposited AQUA is frozen as ICE permanently and is not what gets paid out — the payouts are new AQUA that the frozen position earns by voting.

## Stream A — Stakers (50%)

The staker tranche goes straight to the staking contract via `add_rewards` and accrues through the **Synthetix reward model**: when the protocol distributes `R` AQUA against `T` BLUB staked, the global rate rises by `R / T`, and your earned amount is

```
your staked BLUB × (current rate − your last checkpoint rate)
```

Hold 1% of staked BLUB, earn 1% of every distribution. The checkpoint updates whenever you lock, unstake, or claim. Nothing accrues to a wallet that is not staking.

### Getting paid in BLUB instead

AQUA is the default. If you would rather receive BLUB, call `set_reward_preference` once and the contract swaps your AQUA for BLUB through the pool at claim time.

Two things to understand before electing it:

- **You wear the cost.** The swap is executed for your claim alone, and you receive whatever the pool returns after price impact. A slippage floor (`max_swap_slippage_bps`) protects you from a bad fill by reverting the claim, not by improving it.
- **It is your trade, not a protocol subsidy.** v3 removed protocol-funded BLUB buying precisely because the protocol should not be trading on stakers' behalf by default. Electing BLUB opts you back into that trade individually.

Clear the election at any time by setting your preference back to none, which returns you to the AQUA default.

## Stream B — Vault LPs (30%)

This tranche is deposited into the BLUB-AQUA pool as **AQUA only** — it is not half-swapped into BLUB first. Two reasons:

- The pool holds more BLUB than AQUA, so AQUA is the scarce leg. The StableSwap imbalance term therefore *rewards* adding it: at recent reserves, 100,000 AQUA deposited single-sided minted roughly **137,357 LP**, against roughly **118,108 LP** for the same value added balanced. Buying BLUB first discarded that premium.
- Adding the scarce leg moves the pool toward balance instead of further away from it.

### Who receives Stream B

**Stream B goes entirely to depositors who entered with AQUA only.** If you deposited a pair, you earn your share of the pool's swap fees and nothing from Stream B.

The reason is the same one that makes the tranche AQUA-only in the first place: the pool is short of AQUA, so an AQUA-only deposit is the one that improves it. Stream B pays for that, and a balanced deposit does not provide it.

Mechanically this is two vault buckets pointing at the same Aquarius pool and sharing one LP balance — the contract separates the reward classes, not the liquidity.

> **Not live yet.** The second bucket does not exist on-chain at the time of writing, so every vault depositor is currently in one bucket and earns identically. Until it ships, the paragraph above describes intent rather than behaviour. Check `get_pool_count` if you want to know where it stands.

Deposits land via `admin_compound_deposit`, which raises the class's `total_lp_tokens` **without minting vault shares**. Every depositor in the class grows pro-rata, automatically. There is nothing to claim and no sell pressure — the reward becomes depth.

Protocol-owned liquidity is tracked separately in `aqua_blub_lp_position`, outside `total_lp_tokens`, so **POL earns nothing from Stream B**. That exclusion is structural, not a filter that could be misconfigured. POL is funded by Stream C instead.

Liquidity added directly on aqua.network, outside the vault, earns nothing from this stream. That is the design: the yield exists through the platform.

## Stream C — Protocol-owned liquidity (10%)

Transferred to the staking contract and deposited single-sided as AQUA via `manual_deposit_pol`, for the same two reasons as Stream B. The contract credits `ProtocolOwnedLiquidity.aqua_blub_lp_position`; vault accounting is untouched.

Stream C was 20% under v2. Half of it now funds Stream D.

## Stream D — Treasury (10%)

v2 took no cut of reward income. v3 takes 10%, for runway, audits and operations.

**Active since 16 September 2026.** The destination is configured and the share is paid as a plain AQUA transfer — no swap, no pool interaction.

Between 14 and 16 September this line was configured but unrouted, and a validator bug meant the whole revenue split fell back to paying stakers 100%. For those two days vault LPs, POL and the treasury received nothing. The cause was a partial configuration that did not total 100%, and the distributor now reports its own split so the same failure cannot pass unnoticed.

This is a deliberate trade. Running the protocol has costs that were previously funded from elsewhere, and a revenue line that covers them is more durable than one that does not. The figure is an on-chain parameter, visible in `get_reward_policy` alongside the other three.

---

## Slippage protection

Single-sided deposits into an off-ratio stable pool are sandwichable if they accept any amount of LP back. Every deposit therefore quotes the pool's own `calc_token_amount` live and passes a `min_lp_out` floor cut by a configured tolerance. A deposit that cannot be quoted is refused rather than sent blind.

The same principle covers the optional BLUB election in Stream A: the claim-time swap carries a floor and reverts rather than accepting an arbitrary fill.

## Cadence

| Action | Frequency |
|---|---|
| Vote optimization (target market) | Weekly (each voting epoch) |
| Voting revenue collection | As it arrives (~daily) |
| Revenue split A / B / C / D | Every 6 hours |
| Vault auto-compound (other pools) | Every 4 hours |
| User claiming | Every 7 days (minimum) |

## Fees

| Fee | Amount |
|---|---|
| Treasury share of voting revenue | **10%** (Stream D) |
| Staking, claiming, unstaking | None (gas only) |
| Vault fee on claimed pool emissions | `vault_fee_bps`, currently 15% |

The vault fee applies only to AQUA claimed from a pool's own Aquarius emissions inside `claim_and_compound`. Voting revenue never passes through that path, so none of the four streams above is reduced by it. The BLUB-AQUA pool has been de-whitelisted since mid-2026 and emits nothing, so this fee currently touches only the non-BLUB vault pools.

## Reversibility

The payout token is a parameter, not a property of the contract. If paying AQUA turns out to be wrong, the multisig can set it back to BLUB through `set_reward_policy` without deploying a new contract.

One safeguard applies in both directions: the token cannot be changed while stakers hold accrued balances. Reward units carry no record of which asset funded them, so switching mid-stream would pay people an asset they did not earn. Outstanding balances must be settled to zero first, which the contract enforces rather than trusts.

---

## Superseded design

**v2 (until September 2026)** split revenue 50 / 30 / 20 across stakers, vault LPs and POL, took no treasury cut, and paid stakers in BLUB by buying it on the open market. The BLUB buying is removed and POL's share is halved to fund the treasury line.

**Earlier still**, the protocol described income from farming protocol-owned liquidity in the BLUB-AQUA pool with a 30% treasury cut. That ended when Aquarius de-whitelisted the pool and it stopped emitting AQUA. See [Bribes Harvesting Module](bribes-harvesting.md) for how the replacement income is sourced.
