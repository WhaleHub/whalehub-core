# Chain Information

Whalehub operates on the **Stellar public network** (mainnet) using Soroban smart contracts.

## Network

| Parameter | Value |
|-----------|-------|
| Network | Stellar Mainnet |
| Network passphrase | `Public Global Stellar Network ; September 2015` |
| Consensus | Stellar Consensus Protocol (SCP) |
| Smart contract runtime | Soroban |
| Block time | ~5 seconds |

## Core Contracts

| Contract | Address | Purpose |
|----------|---------|---------|
| **Staking Contract** | `CC72BEVVKHQ57PB5FCKAZYRXCSR6DOQSTN46QR7RZMMM64YWNRPDS24S` | Staking, vaults, rewards, ICE |
| **Rewards Contract** | `CC67FMPFQNGSFTXK53VUJ5FUTYQC6XVJPFZJCVTP4EGH7ZCQBNFOXQ5P` | Legacy reward distribution |

## Token Contracts

| Token | Code | Contract Address | Issuer |
|-------|------|-----------------|--------|
| **BLUB** | BLUB | `CBMFDIRY5OKI4JJURXC4SMEQPWB4UUADIADJK4NA6CYBNOYK4W4TMLLF` | `GDERSSCKJQPPXUQOZIOXGRVAGNLVPVZCJ2MAX7RCMVMWGRPVAEG7XGTK` |
| **AQUA** | AQUA | `CAUIKL3IYGMERDRUN6YSCLWVAKIFG5Q4YJHUKM4S4NJZQIA3BAS6OJPK` | Aquarius protocol |
| **ICE** | ICE | `CARCKZ66U4AI2545NS4RAF47QVEXG3PRRCDA52H4Q3FDRAGSMP4BRU3W` | `GA7YJSQJ4TPSKPM36BTB26B3WBUCUERSA7JCYWPBAA3CWYV7ZYEYLOBS` |
| **XLM** | native | `CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA` | Stellar network |

## Liquidity Pools (Aquarius AMM)

| Pool | Pair | Pool Contract | Share Token | Type |
|------|------|--------------|-------------|------|
| Pool 0 | BLUB / AQUA | `CAMXZXXBD7DFBLYLHUW24U4MY37X7SU5XXT5ZVVUBXRXWLAIM7INI7G2` | `CDMRHKJCYYHZTRQVR7NY43PR7ISMRBYC2O57IMVAQ7B7P2I2XGIZLI5E` | StableSwap |
| Pool 2 | XLM / AQUA | `CCY2PXGMKNQHO7WNYXEWX76L2C5BH3JUW3RCATGUYKY7QQTRILBZIFWV` | `CBOHAVUYKQD4C7FIVXEDJCVLUZYUO6RN3VIKEDOTIJGDDV3QN33Y4T4D` | Constant Product |

> **Pool 0 (BLUB-AQUA) — emissions paused pending Aquarius whitelist approval.** The pool is live and POL liquidity is deposited, but it is not on the Aquarius gauge whitelist, so it currently receives 0 AQUA emissions. Reward distribution resumes automatically once the Aquarius whitelist team approves the pair.

## Admin Wallets

| Role | Address | Type |
|------|---------|------|
| **Manager** (blub-issuer-v2) | `GDERSSCKJQPPXUQOZIOXGRVAGNLVPVZCJ2MAX7RCMVMWGRPVAEG7XGTK` | Hot wallet (backend ops) |
| **Admin** (multisig) | `GALE4XON37AQ4KFTJKB3W32BUQGXFE46TQLKUIGBSIHSOEHTDBMKEI3M` | 2-of-3 cold wallet (upgrades) |

## RPC Endpoints

| Purpose | URL |
|---------|-----|
| Read operations | `https://mainnet.sorobanrpc.com` |
| Write operations | `https://soroban-rpc.mainnet.stellar.gateway.fm` |
| Horizon API | `https://horizon.stellar.org` |

## Explorers

- [Stellar Expert](https://stellar.expert/explorer/public) — transaction and account explorer
- [Stellar Laboratory](https://lab.stellar.org) — transaction builder and signer
