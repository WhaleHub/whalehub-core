#!/usr/bin/env python3
"""
Build + master-sign the two `update_pool_status(pool_id, false)` calls that
deactivate vault buckets 1 and 2.

WHY: both buckets hold LP with NO shareholders (2026-09-11 on-chain state:
pool 1 total_lp_tokens=54,583,351 / total_shares=0; pool 2 = 330,797,549 / 0).
`vault_withdraw` pays `user_shares * total_lp_tokens / total_shares`, and a first
depositor into an empty bucket mints through the `total_shares == 0` branch — so
whoever deposits first becomes sole shareholder and redeems the whole balance for
a dust deposit.

`vault_deposit` and `vault_deposit_single` both gate on `pool_info.active`, so
deactivating closes that door. `vault_withdraw` does NOT gate on active, so this
can never trap a depositor's funds. `claim_and_compound` rejects an inactive pool
BEFORE claiming, so the compound cron fails clean without stranding AQUA in the
manager wallet.

Soroban allows only ONE host-function op per transaction, so this builds TWO
transactions with consecutive sequence numbers. SUBMIT THEM IN ORDER. If they go
out of order the second hits a sequence gap — harmless, just re-run this script.

Co-founder pastes each XDR into Stellar Lab to add the second signature.
"""

import sys, os, tomllib, urllib.parse, subprocess

from stellar_sdk import (
    Keypair, Network, TransactionBuilder, StrKey, SorobanServer,
)
from stellar_sdk.operation import InvokeHostFunction
from stellar_sdk import xdr as xdr_

# ── Config ───────────────────────────────────────────────────────────────
STAKING_CONTRACT   = "CC72BEVVKHQ57PB5FCKAZYRXCSR6DOQSTN46QR7RZMMM64YWNRPDS24S"
MULTISIG_ADMIN     = "GALE4XON37AQ4KFTJKB3W32BUQGXFE46TQLKUIGBSIHSOEHTDBMKEI3M"
POOL_IDS           = [1, 2]
SET_ACTIVE         = False
RPC_URL            = "https://soroban-rpc.mainnet.stellar.gateway.fm"
NETWORK_PASSPHRASE = Network.PUBLIC_NETWORK_PASSPHRASE
MAX_FEE            = 1_000_000

# ── Load master key ──────────────────────────────────────────────────────
identity_path = os.path.expanduser("~/.config/stellar/identity/multisig-admin.toml")
try:
    with open(identity_path, "rb") as f:
        master_secret = tomllib.load(f).get("secret_key")
    master_kp = Keypair.from_secret(master_secret)
    print(f"Master key: {master_kp.public_key}")
except Exception as e:
    secret = os.environ.get("MASTER_SECRET", "")
    if not secret:
        print(f"Load failed: {e}. Set MASTER_SECRET."); sys.exit(1)
    master_kp = Keypair.from_secret(secret)
    print(f"Master key (env): {master_kp.public_key}")

contract_addr = xdr_.SCAddress(
    xdr_.SCAddressType.SC_ADDRESS_TYPE_CONTRACT,
    contract_id=xdr_.Hash(StrKey.decode_contract(STAKING_CONTRACT)),
)

server = SorobanServer(RPC_URL)
# One Account object reused across builds so the two txs get consecutive seqs.
account = server.load_account(MULTISIG_ADMIN)

signed = []

for pool_id in POOL_IDS:
    # update_pool_status(pool_id: u32, active: bool) — note it takes NO admin
    # argument; it reads config.admin internally and calls require_auth().
    args = [
        xdr_.SCVal(xdr_.SCValType.SCV_U32, u32=xdr_.Uint32(pool_id)),
        xdr_.SCVal(xdr_.SCValType.SCV_BOOL, b=SET_ACTIVE),
    ]

    host_function = xdr_.HostFunction(
        type=xdr_.HostFunctionType.HOST_FUNCTION_TYPE_INVOKE_CONTRACT,
        invoke_contract=xdr_.InvokeContractArgs(
            contract_address=contract_addr,
            function_name=xdr_.SCSymbol(b"update_pool_status"),
            args=args,
        ),
    )

    tx = (
        TransactionBuilder(account, network_passphrase=NETWORK_PASSPHRASE, base_fee=MAX_FEE)
        .append_operation(InvokeHostFunction(host_function=host_function, auth=[]))
        .set_timeout(3600)  # 1 hour to collect the co-founder's 2nd signature

        .build()
    )

    print(f"Simulating pool {pool_id} -> active={SET_ACTIVE} ...")
    try:
        tx = server.prepare_transaction(tx)
        print(f"  Simulation OK (seq {tx.transaction.sequence})")
    except Exception as e:
        print(f"  Simulation error: {e}"); sys.exit(1)

    tx.sign(master_kp)
    signed.append((pool_id, tx.to_xdr(), tx.transaction.sequence))

print()
print("=" * 70)
print("SIGNED WITH MASTER KEY — EACH NEEDS ONE CO-FOUNDER SIGNATURE")
print("=" * 70)
print("SUBMIT IN THIS ORDER (consecutive sequence numbers):")
print()

for idx, (pool_id, xdr, seq) in enumerate(signed, start=1):
    link = "https://lab.stellar.org/transaction/sign?network=mainnet&xdr=" + urllib.parse.quote(xdr)
    print(f"--- #{idx}: deactivate pool {pool_id}  (seq {seq}) ---")
    print(link)
    print()

# Clipboard gets the first one; the co-founder works through them in order.
subprocess.run(["pbcopy"], input=signed[0][1].encode(), check=True)
print(f"✅ XDR for #1 (pool {signed[0][0]}) copied to clipboard.")
print("   After #1 is submitted, copy #2's link above.")
