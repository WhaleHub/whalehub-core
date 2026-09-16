# Smart Contract Functions

The staking contract exposes functions for users, the manager (backend), and the admin (multisig).

## User Functions

| Function | Description |
|----------|-------------|
| `lock(user, amount, duration)` | Lock AQUA tokens, receive BLUB into staking balance |
| `stake(user, amount, duration)` | Restake existing BLUB tokens |
| `record_unlock(user, lock_index)` | Withdraw tokens after lock + cooldown expires |
| `claim_rewards(user)` | Claim pending rewards in the policy token, default AQUA (7-day cooldown) |
| `vault_deposit(user, pool_id, amount_a, amount_b)` | Deposit token pair into a vault pool |
| `vault_withdraw(user, pool_id, share_percent, min_a, min_b)` | Withdraw a vault position as both tokens, pro-rata |
| `vault_withdraw_single(user, pool_id, share_percent, coin_index, min_amount)` | Withdraw as a single token. `coin_index` is the POOL's `get_tokens()` order (pool 0: 0 = AQUA, 1 = BLUB), **not** PoolInfo's `(token_a, token_b)` — those are reversed. Pays the pool's imbalance fee |
| `migrate_vault_position(manager, user, from_pool, to_pool)` | Move a depositor's position between two buckets sharing a `share_token`. Moves no tokens; re-credits only |
| `withdraw_pol_one_coin(admin, share_amount, coin_index, min_amount)` | Admin: withdraw protocol-owned LP as one token, into the contract |

## Manager Functions (Backend)

| Function | Description |
|----------|-------------|
| `add_rewards(manager, amount)` | Distribute rewards to all stakers in the policy token (no cap since v3) |
| `add_rewards_from_aqua(manager, aqua, blub)` | v2 only; refused while the policy pays AQUA |
| `settle_user_rewards(manager, user)` | Pay out one staker's accrued balance, ignoring cooldown (migration sweep) |
| `get_reward_policy()` | Read the payout token and revenue split |
| `set_reward_policy(admin, token, allow_choice, staker_bps, lp_bps, pol_bps, treasury_bps, slippage_bps)` | Multisig: set payout token and split. Refuses a token change while balances are outstanding |
| `set_reward_preference(user, Option<token>)` | Staker: elect a payout token; `None` restores the default |
| `get_reward_preference(user)` | Read a staker's election |
| `claim_and_compound(manager, pool_id)` | Claim pool rewards and split to treasury/manager |
| `admin_compound_deposit(manager, pool_id, amount_a, amount_b)` | Re-deposit compounded rewards into pool |
| `authorize_ice_lock(manager, amount, years)` | Authorize AQUA for ICE governance locking |
| `transfer_authorized_aqua(manager, lock_id)` | Move authorized AQUA to manager wallet |
| `sync_all_ice_balances(manager)` | Read ICE token balances and record on-chain |

## Admin Functions (Multisig)

| Function | Description |
|----------|-------------|
| `upgrade(admin, new_wasm_hash)` | Upgrade contract to new WASM code |
| `update_sac_admin(admin, new_admin)` | Change BLUB token mint authority |
| `update_vault_treasury(admin, addr)` | Change treasury fee recipient |
| `update_vault_fee_bps(admin, bps)` | Change treasury fee percentage |
| `set_manager(admin, new_manager)` | Change manager wallet address |

## View Functions (Read-only, No Fee)

| Function | Returns |
|----------|---------|
| `get_config()` | All protocol settings |
| `get_global_state()` | Total locked, total minted, reentrancy state |
| `get_reward_state()` | Global reward accumulator |
| `get_user_reward_state(user)` | User's reward snapshot and pending amount |
| `get_user_lock_count(user)` | Number of lock positions for a user |
| `get_user_lock_by_index(user, i)` | Details of a specific lock position |
| `get_user_total_staked_blub(user)` | Total BLUB in reward pool for user |
| `calculate_user_rewards(user)` | Pending BLUB available to claim |
| `get_pool_info(pool_id)` | Vault pool configuration and state |
| `get_pool_count()` | Number of vault pools |
| `get_user_vault_position(user, pool_id)` | User's LP position in a vault |
| `get_protocol_owned_liquidity()` | Full POL accounting |
