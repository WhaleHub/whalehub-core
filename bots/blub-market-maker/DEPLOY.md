# Deploy runbook — BLUB/AQUA market maker

Five stages, each of which can be stopped at. Nothing places an order until
stage 4, and stage 4 is one environment variable.

**Bot wallet:** `GDUAOUODWWMHA6KKSJXHLKMBEPJBJELLW33LL5KAPDWPPUO7M2D6S5TC`
(alias `whalehub-mm-bot`; secret in the local keystore — move it to a secret
manager and delete the local copy before going live).

---

## Two things that must not be got wrong

**1. Never run this inside whalehub-server.** That app runs **two** DigitalOcean
instances with separate filesystems. Two instances means two bots quoting the
same order book with the same key: duplicate offers, sequence-number collisions,
and double the exposure configured. The file lock is per-filesystem and cannot
coordinate across them — the same reason the bribe cron had to be balance-based.
This is a separate app with `instance_count: 1`.

**2. Stopping the container is the real kill switch.** `src/index.ts` handles
SIGTERM by cancelling every resting offer before it exits, and the Dockerfile
runs node as PID 1 so the signal actually arrives. Scaling to 0 or redeploying
therefore leaves a clean book. Do not `kill -9`.

---

## Stage 0 — verify the wallet (done)

| Asset | Balance | |
| --- | ---: | --- |
| XLM | 50.00 | ✅ 48 free after two trustline reserves |
| AQUA | 0 | trustline live, **no inventory** |
| BLUB | 0 | trustline live, **no inventory** |

Trustlines added 3 Sep: `66f414ad…` (AQUA), `8296bfbb…` (BLUB).

```bash
stellar keys address whalehub-mm-bot
curl -s "https://horizon.stellar.org/accounts/GDUAOUODWWMHA6KKSJXHLKMBEPJBJELLW33LL5KAPDWPPUO7M2D6S5TC" | jq '.balances'
```

## Stage 1 — deploy inert

```bash
doctl apps create --spec bots/blub-market-maker/.do/app.yaml
doctl apps logs <app-id> --follow
```

`DRY_RUN=true` is set in the spec *and* defaulted in the config schema, so the
bot computes and logs the offers it would place and submits nothing.

**What a healthy log line looks like:**

```json
{"mode":"DRY_RUN (no orders placed)","wallet":"(none — dry-run without BOT_SECRET)"}
{"intent":"CREATE","side":"ask","level":0,"price":0.80066,"amount":10000}
{"intent":"CREATE","side":"bid","level":0,"price":0.79269,"amount":10000}
{"mid":0.796,"sources":{"poolQuote":0.796,"primarySource":"poolQuote"},"desiredCount":2}
```

Check three things before moving on:

- `primarySource` is `poolQuote` — it is pricing from the pool's own
  `estimate_swap`, not local math or the off-chain API
- the bid is below the ask, and both sit inside `PRICE_FLOOR`/`PEG_CEILING`
- `breakerTrips` stays 0 across several cycles

## Stage 2 — fund inventory

The bot caps every ladder level at the actual on-chain balance in live mode, so
**with zero inventory it will run and quote nothing.** For one level at the
current ~0.796 mid:

| Asset | Amount |
| --- | ---: |
| BLUB | 10,000 |
| AQUA | ~8,000 |

Balance them by *value*, not by count — `TARGET_BLUB_FRACTION=0.5` skews quotes
to push back toward a 50/50 split, so a lopsided start makes it quote
aggressively to correct.

> **Decide where BLUB comes from before doing this.** The issuer holds none of
> its own asset, so BLUB sent from `blub-issuer-v2` is **newly minted supply**,
> on top of the open liability discrepancy. The AQUA now sitting on the manager
> is bribe harvest earmarked for the 50/30/20 reward engine — spending it here
> takes it from stakers, vault LPs and POL.

## Stage 3 — secret in, still inert

Set `BOT_SECRET` in the DO dashboard as an encrypted secret. Leave
`DRY_RUN=true` and redeploy.

This is the stage most people skip, and it is the one that earns its keep: with
a secret the bot loads the real account, reads real balances, lists real offers
and runs the full reconciler — while still submitting nothing. It is the only
way to see the reconcile path before it can cost anything.

Now the log should show `wallet: G...`, real `inventory`, and a `freeXlm` figure.

## Stage 4 — go live

Set `DRY_RUN=false` and redeploy. Keep `LADDER_LEVELS=1` and the wide
`HALF_SPREAD_BPS=150` for the first session; tighten only after watching a full
day.

Watch for, in order:

1. a `submitted offer batch` line with a tx hash
2. the offers appearing on the account (`/offers` on Horizon)
3. `offersUpdated` rising and `offersCreated` flat on later cycles — that means
   churn suppression is working and it is not paying fees to re-post the same
   quotes
4. `submitErrors` staying at 0

## Stage 5 — stopping

| Situation | Do this |
| --- | --- |
| Routine stop | Scale the worker to 0, or redeploy with `DRY_RUN=true`. SIGTERM cancels all offers first. |
| Immediate halt, keep the process | Console into the container and `touch STOP`. Next cycle cancels everything and idles. |
| Something is badly wrong | Scale to 0. Then cancel any stragglers manually from the wallet. |

After any stop, confirm the book is clean:

```bash
curl -s "https://horizon.stellar.org/accounts/GDUAOUODWWMHA6KKSJXHLKMBEPJBJELLW33LL5KAPDWPPUO7M2D6S5TC/offers" | jq '._embedded.records | length'
```

---

## What this bot does and does not do

It quotes **both sides** — it buys BLUB on its bid and sells BLUB on its ask,
and the inventory skew pushes it back toward flat. It is not a buy programme and
will not raise the price. What it changes is the *displayed* price: the book is
currently a canyon (best bid ~0.667, best ask ~0.896), and tight two-sided
quotes make the shown price coherent while earning the spread.

Restoring any particular price level needs real backing. A bot cannot manufacture
that, and this one does not try.
