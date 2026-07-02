#!/usr/bin/env python3
"""
Build, sign (master key), output XDR + signing link for multisig contract upgrade.
"""

import sys, os, tomllib, urllib.parse

from stellar_sdk import (
    Keypair, Network, TransactionBuilder, StrKey, SorobanServer,
)
from stellar_sdk.operation import InvokeHostFunction
from stellar_sdk import xdr as xdr_

# ── Config ───────────────────────────────────────────────────────────────
STAKING_CONTRACT   = "CC72BEVVKHQ57PB5FCKAZYRXCSR6DOQSTN46QR7RZMMM64YWNRPDS24S"
MULTISIG_ADMIN     = "GALE4XON37AQ4KFTJKB3W32BUQGXFE46TQLKUIGBSIHSOEHTDBMKEI3M"
NEW_WASM_HASH      = "6e370b607e3ce105ae9280aa5d4953c9a08c9ef29e22d59bc6dcc58d719dce63"  # v2: adds withdraw_from_pool LP-burn authorization (POL top-up fix)
RPC_URL            = "https://mainnet.sorobanrpc.com"
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

# ── Build invoke args ────────────────────────────────────────────────────
admin_scval = xdr_.SCVal(
    xdr_.SCValType.SCV_ADDRESS,
    address=xdr_.SCAddress(
        xdr_.SCAddressType.SC_ADDRESS_TYPE_ACCOUNT,
        account_id=xdr_.AccountID(xdr_.PublicKey(
            xdr_.PublicKeyType.PUBLIC_KEY_TYPE_ED25519,
            ed25519=xdr_.Uint256(StrKey.decode_ed25519_public_key(MULTISIG_ADMIN)),
        )),
    ),
)
wasm_scval = xdr_.SCVal(
    xdr_.SCValType.SCV_BYTES,
    bytes=xdr_.SCBytes(bytes.fromhex(NEW_WASM_HASH)),
)
contract_addr = xdr_.SCAddress(
    xdr_.SCAddressType.SC_ADDRESS_TYPE_CONTRACT,
    contract_id=xdr_.Hash(StrKey.decode_contract(STAKING_CONTRACT)),
)

host_function = xdr_.HostFunction(
    type=xdr_.HostFunctionType.HOST_FUNCTION_TYPE_INVOKE_CONTRACT,
    invoke_contract=xdr_.InvokeContractArgs(
        contract_address=contract_addr,
        function_name=xdr_.SCSymbol(b"upgrade"),
        args=[admin_scval, wasm_scval],
    ),
)

invoke_op = InvokeHostFunction(host_function=host_function, auth=[])

# ── Build tx, simulate, assemble ─────────────────────────────────────────
server = SorobanServer(RPC_URL)
account = server.load_account(MULTISIG_ADMIN)

tx = (
    TransactionBuilder(account, network_passphrase=NETWORK_PASSPHRASE, base_fee=MAX_FEE)
    .append_operation(invoke_op)
    .set_timeout(3600)  # 1 hour window to collect the co-founder's 2nd signature
    .build()
)

print("Simulating...")
try:
    tx = server.prepare_transaction(tx)
    print("Simulation OK.")
except Exception as e:
    print(f"Simulation error: {e}"); sys.exit(1)

# ── Sign with master key ─────────────────────────────────────────────────
tx.sign(master_kp)
xdr = tx.to_xdr()
link = "https://lab.stellar.org/transaction/sign?network=mainnet&xdr=" + urllib.parse.quote(xdr)

import subprocess
try:
    subprocess.run(["pbcopy"], input=xdr.encode(), check=True)
except Exception:
    pass

print()
print("RAW HALF-SIGNED XDR (copy this):")
print(xdr)
print()
print("=" * 70)
print("SIGNED WITH MASTER KEY — NEEDS ONE CO-FOUNDER SIGNATURE")
print("=" * 70)
print(f"WASM hash: {NEW_WASM_HASH}")
print()
print("✅ XDR copied to clipboard — paste into Stellar Lab:")
print("   https://lab.stellar.org/transaction/sign?network=mainnet")
print()
print("Co-founder signing link (XDR pre-filled):")
print(link)
print()
print("After co-founder signs, submit:")
print('  stellar tx send --network mainnet "<FINAL_XDR>"')
