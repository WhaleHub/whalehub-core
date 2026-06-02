# Contract Addresses

All contracts and tokens are deployed on **Stellar mainnet**.

## Smart Contracts

| Contract | Address |
|----------|---------|
| **Staking Contract** | `CC72BEVVKHQ57PB5FCKAZYRXCSR6DOQSTN46QR7RZMMM64YWNRPDS24S` |
| **Rewards Contract** | `CC67FMPFQNGSFTXK53VUJ5FUTYQC6XVJPFZJCVTP4EGH7ZCQBNFOXQ5P` |

## Tokens

| Token | Contract Address |
|-------|-----------------|
| **BLUB** | `CBMFDIRY5OKI4JJURXC4SMEQPWB4UUADIADJK4NA6CYBNOYK4W4TMLLF` |
| **AQUA** | `CAUIKL3IYGMERDRUN6YSCLWVAKIFG5Q4YJHUKM4S4NJZQIA3BAS6OJPK` |
| **ICE** | `CARCKZ66U4AI2545NS4RAF47QVEXG3PRRCDA52H4Q3FDRAGSMP4BRU3W` |
| **Native XLM (SAC)** | `CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA` |

## Liquidity Pools (Aquarius AMM)

| Pool | Pool Contract | Share Token |
|------|--------------|-------------|
| **Pool 0: BLUB-AQUA** | `CAMXZXXBD7DFBLYLHUW24U4MY37X7SU5XXT5ZVVUBXRXWLAIM7INI7G2` | `CDMRHKJCYYHZTRQVR7NY43PR7ISMRBYC2O57IMVAQ7B7P2I2XGIZLI5E` |
| **Pool 2: XLM-AQUA** | `CCY2PXGMKNQHO7WNYXEWX76L2C5BH3JUW3RCATGUYKY7QQTRILBZIFWV` | `CBOHAVUYKQD4C7FIVXEDJCVLUZYUO6RN3VIKEDOTIJGDDV3QN33Y4T4D` |

> **Pool 0 (BLUB-AQUA) — emissions paused.** The pool is not currently whitelisted on the Aquarius gauge, so it does not receive AQUA emissions. Rewards will resume once the Aquarius whitelist team approves the pair; no protocol change is required from our side. POL liquidity remains deposited at the address above.

## Admin Wallets

| Role | Address |
|------|---------|
| **Manager** (blub-issuer-v2) | `GDERSSCKJQPPXUQOZIOXGRVAGNLVPVZCJ2MAX7RCMVMWGRPVAEG7XGTK` |
| **Admin** (multisig 2-of-3) | `GALE4XON37AQ4KFTJKB3W32BUQGXFE46TQLKUIGBSIHSOEHTDBMKEI3M` |

## Verification

You can verify any contract on [Stellar Expert](https://stellar.expert) or query directly via Soroban RPC:

```bash
stellar contract invoke \
  --id CC72BEVVKHQ57PB5FCKAZYRXCSR6DOQSTN46QR7RZMMM64YWNRPDS24S \
  --rpc-url https://mainnet.sorobanrpc.com \
  --network-passphrase "Public Global Stellar Network ; September 2015" \
  -- get_config
```
