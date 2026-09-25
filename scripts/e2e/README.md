# Daily E2E smoke suite

Read-only checks against live mainnet and the deployed sites, run daily by
`.github/workflows/e2e-daily.yml` and reported to Telegram.

```bash
node scripts/e2e/run.cjs                      # everything, send report if configured
node scripts/e2e/run.cjs --no-telegram        # local run, print only
node scripts/e2e/run.cjs --only=infra,writes  # one or more groups
```

Exit code is `1` if any check fails, so CI goes red as well as notifying.
A full run takes ~15s.

## Safety

**Nothing in this suite can move funds.** `scripts/e2e/lib/chain.cjs` holds no
keys and exposes no submit path — every state-changing check goes through
`simulateTransaction` and discards the result. Keep it that way: if you ever add
a signing step here, it stops being safe to run unattended on a schedule.

Multisig and manager-only operations (`upgrade`, `transfer_admin`,
`update_sac_admin`, `withdraw_from_pool`, `admin_emergency_reset_rewards`, …)
are deliberately not exercised.

## What it covers

| Group | Checks |
|---|---|
| `infra` | Soroban RPC primary + fallback, Horizon, app.whalehub.io (and that its JS bundle actually loads), whalehub.io, `stellar.toml` served with `text/plain` + CORS `*` + a BLUB entry, **BLUB issuer `home_domain` is still `whalehub.io`**, backend health, staking-APY endpoint |
| `reads` | All 37 public getters on the staking contract, plus `get_pool_info` for every configured pool |
| `writes` | `lock`, `stake`, `unstake`, `claim_rewards`, `set_reward_preference`, `vault_deposit_single`, `vault_withdraw_single` — simulated |
| `invariants` | BLUB SAC admin is the staking contract, vault solvency (contract pool-0 LP ≥ `total_lp_tokens`), reward split sums to 10000 bps, reentrancy guard not stuck, contract holds BLUB for redemptions, ICE-locked AQUA present |

### Pass / fail semantics

A contract that answers with a **declared business error** is a healthy
contract. `claim_rewards` returning `#29 ClaimCooldownActive` is a pass — the
entry point assembled, authorised and ran. Token-moving calls can also surface
the Stellar Asset Contract's own codes (`#10 BalanceError`,
`#13 TrustlineMissing`), which mean the test subject can't fund the call, not
that anything is broken.

Only an **undeclared** error code, a host panic, or a transport failure fails a
check.

`metric()` entries are numbers shown in the report without being judged —
locked AQUA, contract balances, POL surplus, APY. Read the trend yourself.

## Telegram setup

Two repository secrets are required. Without them the suite still runs and
prints; it just says `Telegram: not sent`.

### 1. Create a bot and get `TELEGRAM_BOT_TOKEN`

1. Open Telegram and message [@BotFather](https://t.me/BotFather).
2. Send `/newbot`, pick a display name and a username ending in `bot`.
3. BotFather replies with a token like `8012345678:AAH...`. That's
   `TELEGRAM_BOT_TOKEN`.

### 2. Get `TELEGRAM_CHAT_ID`

**This is the part people get stuck on.** Pick whichever matches where you want
the report:

**A private chat with yourself (simplest)**
1. Message your new bot — send it anything, e.g. `hi`. A bot cannot message you
   until you message it first.
2. Open `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` in a browser.
3. Find `"chat":{"id":123456789,...}`. That number is your chat ID.

**A group**
1. Add the bot to the group.
2. Send any message in the group.
3. Open the same `getUpdates` URL and read `"chat":{"id":-1001234567890,...}`.
   Group IDs are **negative** — keep the minus sign.

**A channel (what you probably want for alerts)**
1. Create the channel, then add your bot as an **administrator** with
   "Post Messages" permission. A plain member can't post.
2. Post any message in the channel.
3. Open `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` and look for a
   `channel_post` entry — `"chat":{"id":-1001234567890,"title":"…"}`.
   Channel IDs start with `-100`.
   - If `getUpdates` is empty, forward a channel message into
     [@userinfobot](https://t.me/userinfobot), which replies with the origin
     chat ID.
   - Alternatively, if the channel is public you can use `@channelusername`
     directly as `TELEGRAM_CHAT_ID` instead of a numeric ID.

### 3. Add them to the repo

`Settings → Secrets and variables → Actions → New repository secret`:

| Name | Value |
|---|---|
| `TELEGRAM_BOT_TOKEN` | the BotFather token |
| `TELEGRAM_CHAT_ID` | the id from above (keep any leading `-`) |

Verify locally before trusting the schedule:

```bash
TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=... node scripts/e2e/run.cjs
```

A clean run sends with notifications muted; a failing run pings normally.

## Optional configuration

Repository *variables* (not secrets), all with working defaults:

| Name | Default | Purpose |
|---|---|---|
| `E2E_SAMPLE_USER` | the manager account | Subject for user-scoped getters. It's a real staker, so the getters return populated data. |
| `E2E_SUBJECT` | auto-discovered AQUA holder | Account used to simulate `lock` past its balance check. Pin this to a project test wallet if you'd rather not rely on discovery. |
| `E2E_SOROBAN_RPC_URL` | Validation Cloud | Primary RPC. |
| `E2E_APP_URL` / `E2E_SITE_URL` / `E2E_BACKEND_URL` | production | Point the suite at a preview deploy. |

## Adding a check

Each group in `scripts/e2e/checks/` exports `async (report) => {}` and calls
`report.pass/warn/fail/metric/check`. Add a new getter to the list in
`reads.cjs` when one is added to `lib.rs` — the suite asserts each one
individually so a getter that starts throwing after an upgrade is caught before
it reaches users as a blank panel.
