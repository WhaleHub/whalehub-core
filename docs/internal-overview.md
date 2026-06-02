# WhaleHub — Internal Overview

Quick reference sheet for onboarding. Everything you need to know in one page.

---

## What Is WhaleHub

DeFi protocol on Stellar. Users lock AQUA -> earn BLUB rewards. Protocol deploys liquidity into Aquarius AMM pools, compounds earnings, and directs ICE voting power for boosted yields. Think Convex for Stellar.

---

## Key Addresses

### Contracts
| Contract | Address |
|----------|---------|
| Staking Contract | `CC72BEVVKHQ57PB5FCKAZYRXCSR6DOQSTN46QR7RZMMM64YWNRPDS24S` |
| Rewards Contract | `CC67FMPFQNGSFTXK53VUJ5FUTYQC6XVJPFZJCVTP4EGH7ZCQBNFOXQ5P` |

### Tokens
| Token | Contract | Issuer |
|-------|----------|--------|
| BLUB | `CBMFDIRY5OKI4JJURXC4SMEQPWB4UUADIADJK4NA6CYBNOYK4W4TMLLF` | `GDERSSCKJQPPXUQOZIOXGRVAGNLVPVZCJ2MAX7RCMVMWGRPVAEG7XGTK` |
| AQUA | `CAUIKL3IYGMERDRUN6YSCLWVAKIFG5Q4YJHUKM4S4NJZQIA3BAS6OJPK` | Aquarius |
| ICE | `CARCKZ66U4AI2545NS4RAF47QVEXG3PRRCDA52H4Q3FDRAGSMP4BRU3W` | `GA7YJSQJ4TPSKPM36BTB26B3WBUCUERSA7JCYWPBAA3CWYV7ZYEYLOBS` |
| XLM (SAC) | `CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA` | native |

### Liquidity Pools (Aquarius AMM)
| Pool | Contract | Share Token | Type |
|------|----------|-------------|------|
| Pool 0: BLUB-AQUA | `CAMXZXXBD7DFBLYLHUW24U4MY37X7SU5XXT5ZVVUBXRXWLAIM7INI7G2` | `CDMRHKJCYYHZTRQVR7NY43PR7ISMRBYC2O57IMVAQ7B7P2I2XGIZLI5E` | StableSwap |
| Pool 2: XLM-AQUA | `CCY2PXGMKNQHO7WNYXEWX76L2C5BH3JUW3RCATGUYKY7QQTRILBZIFWV` | `CBOHAVUYKQD4C7FIVXEDJCVLUZYUO6RN3VIKEDOTIJGDDV3QN33Y4T4D` | Constant Product |

> **Pool 0 is currently de-whitelisted on the Aquarius gauge** — no AQUA emissions are flowing to POL or vault LP until the Aquarius whitelist team re-approves the pair. The pool contract itself is live and working; this is a gauge-side gating, not a contract issue.

### Admin Wallets
| Role | Address | Type |
|------|---------|------|
| Manager (`blub-issuer-v2`) | `GDERSSCKJQPPXUQOZIOXGRVAGNLVPVZCJ2MAX7RCMVMWGRPVAEG7XGTK` | Hot wallet — backend ops |
| Admin (multisig 2-of-3) | `GALE4XON37AQ4KFTJKB3W32BUQGXFE46TQLKUIGBSIHSOEHTDBMKEI3M` | Cold wallet — upgrades only |

---

## Architecture

```
Users (Freighter / LOBSTR / WalletConnect)
    │
    ▼
Frontend (React + TypeScript + Tailwind)
    │
    ▼
Staking Contract (Soroban / Rust / WASM)
    │
    ├── Staking: lock AQUA -> mint BLUB -> earn rewards
    ├── Vaults: deposit token pairs -> auto-compound LP
    └── ICE: governance locking -> voting power
    │
    ▼
Aquarius AMM Pools (BLUB-AQUA, XLM-AQUA)
    │
    ▼
Backend Server (NestJS on Digital Ocean)
    ├── StakingRewardService   — every 30 min, claims + distributes
    ├── VaultCompoundService   — 4x daily, auto-compounds vaults
    ├── IceLockingService      — every 4h, locks AQUA for ICE
    └── PolDepositService      — event-driven, deposits new liquidity
```

---

## Key Numbers

| Parameter | Value |
|-----------|-------|
| BLUB per AQUA locked | 1.0 (+ 0.1 to liquidity pool) |
| AQUA to liquidity pool | 10% of each lock |
| AQUA to ICE governance | 90% of each lock |
| Treasury fee | 30% of pool earnings |
| Staker share | 70% of pool earnings |
| Auto-compound frequency | 48x per day (every 30 min) |
| Min lock duration | 7 days |
| Withdrawal cooldown | 10 days after lock expires |
| Reward claim cooldown | 7 days |
| Reward cap per call | 100K BLUB |

---

## ICE Boost (Current State — March 2026)

Aquarius Curve-style formula: `boost = min(0.4*D + 0.6*P*(myICE/totalICE), D) / (0.4*D)`

| Metric | Value |
|--------|-------|
| Admin ICE balance | 266M ICE |
| Total ICE supply | 903B ICE |
| Our ICE share | 0.029% |
| Pool 0 (BLUB-AQUA) our LP share | 66% — boost = 1.001x (negligible) |
| Pool 2 (XLM-AQUA) our LP share | <0.001% — boost = 2.5x (full) |
| Max LP for full 2.5x on any pool | ~0.03% of pool total |

**Limitation:** ICE uses classic Stellar claimable balances. Soroban contracts can't create them, so the contract can't lock AQUA for ICE directly. Vault LP deposited by the contract gets no boost. Planned fix: route deposits through ICE-holding wallet.

---

## RPC Endpoints

| Purpose | URL |
|---------|-----|
| Read (simulation, polling) | `https://mainnet.sorobanrpc.com` |
| Write (tx submission) | `https://soroban-rpc.mainnet.stellar.gateway.fm` |
| Horizon (classic queries) | `https://horizon.stellar.org` |

Always use `--fee 1000000` for writes. Single-line commands only (no backslash continuation).

---

## Backend (whalehub-server)

- Repo: separate (`whalehub-server`)
- Hosted: Digital Ocean (`https://whalehub-server-28ipy.ondigitalocean.app`)
- Trigger endpoints (all POST): `/test/ice-locking`, `/test/vault-compound`, `/test/staking-reward`, `/test/pol-deposit`
- Status: `GET /test/staking-reward/status`, `GET /test/health`
- Dual instance issue: DO runs 2 PIDs, both fire crons — second usually no-ops

---

## Contract WASM History

| Version | Hash | Change |
|---------|------|--------|
| v1.4.0 | `42af964b...` | Admin/manager split |
| v1.5.0 | `63d95c0d...` | 100K BLUB reward cap |
| v1.6.0 | `80bd80b1...` | Partial unstake fix |
| v1.7.0 | `c258a820...` | Compound: manager transfer + token order fix |

---

## Build & Deploy

```bash
# Build contract
cargo build --release --target wasm32-unknown-unknown --package whalehub-staking

# Optimize WASM (required — 133KB -> 119KB)
stellar contract optimize --wasm target/wasm32-unknown-unknown/release/whalehub_staking.wasm

# Install on-chain (~140 XLM)
stellar contract install --source blub-issuer-v2 --network mainnet --wasm target/wasm32-unknown-unknown/release/whalehub_staking.optimized.wasm

# Upgrade (requires multisig admin)
# Use scripts/multisig_upgrade.py — builds tx, signs with master key, copies XDR to clipboard
# Co-signer pastes into lab.stellar.org/transaction/sign to submit
```

---

## Frontend

```bash
npm install   # dependencies
npm start     # dev server at localhost:3000
npm run build # production build
```

Key env vars:
```
REACT_APP_STELLAR_NETWORK=mainnet
REACT_APP_SOROBAN_RPC_URL=https://mainnet.sorobanrpc.com
REACT_APP_STAKING_CONTRACT_ID=CC72BEVVKHQ57PB5FCKAZYRXCSR6DOQSTN46QR7RZMMM64YWNRPDS24S
```

---

## Known Issues / Gotchas

- **Native XLM balance**: SAC `balance()` returns total including reserves. Use Horizon to get spendable balance.
- **nativeToScVal i128/u128**: always pass `BigInt(Math.round(...))` — plain Number falls back to i32 for small values.
- **Aquarius pool token order**: pools sort tokens by contract address (alphabetical), which may differ from PoolInfo order. Always check.
- **Pool 0 StableSwap**: much lower slippage than constant product — swap calculations differ.
- **Soroban RPC staleness**: returns stale data 3-8s after tx confirms. Frontend does a second fetch after 7s delay.
- **Frozen user** (`GAYLXOVHX...`): exploited reward bug, BLUB frozen via `set_authorized(false)`. Can't clawback (trustline predates AUTH_CLAWBACK_ENABLED).
