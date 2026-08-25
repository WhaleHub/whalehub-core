#!/usr/bin/env python3
"""
Build, sign (master key), output XDR + signing link for `update_vault_fee_bps`.

The staking contract deducts `vault_fee_bps` inside `claim_and_compound` before
any reward reaches the backend — on pool 0 and on vaults alike — so the treasury
cut on vault rewards CANNOT be removed from whalehub-server. It is a config
value on the contract, and the setter is admin-only, meaning the 2-of-3 multisig.

Usage:
    python3 scripts/multisig_set_vault_fee.py [new_fee_bps]

    new_fee_bps defaults to 0 (no treasury fee). 1500 = 15%, contract max 5000.

Mirrors multisig_upgrade.py: signs with the master key, copies the half-signed
XDR to the clipboard, and prints a Stellar Lab link for the co-founder's second
signature. Nothing is submitted by this script.
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
RPC_URL            = "https://mainnet.sorobanrpc.com"
NETWORK_PASSPHRASE = Network.PUBLIC_NETWORK_PASSPHRASE
MAX_FEE            = 1_000_000

NEW_FEE_BPS = int(sys.argv[1]) if len(sys.argv) > 1 else 0
if not (0 <= NEW_FEE_BPS <= 5000):
    print(f"new_fee_bps must be 0..5000 (contract caps at 50%); got {NEW_FEE_BPS}")
    sys.exit(1)

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
fee_scval = xdr_.SCVal(
    xdr_.SCValType.SCV_U32,
    u32=xdr_.Uint32(NEW_FEE_BPS),
)
contract_addr = xdr_.SCAddress(
    xdr_.SCAddressType.SC_ADDRESS_TYPE_CONTRACT,
    contract_id=xdr_.Hash(StrKey.decode_contract(STAKING_CONTRACT)),
)

host_function = xdr_.HostFunction(
    type=xdr_.HostFunctionType.HOST_FUNCTION_TYPE_INVOKE_CONTRACT,
    invoke_contract=xdr_.InvokeContractArgs(
        contract_address=contract_addr,
        function_name=xdr_.SCSymbol(b"update_vault_fee_bps"),
        args=[admin_scval, fee_scval],
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

print(f"Simulating update_vault_fee_bps({MULTISIG_ADMIN[:8]}…, {NEW_FEE_BPS})...")
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
print(f"vault_fee_bps -> {NEW_FEE_BPS} ({NEW_FEE_BPS / 100:.2f}%)")
print()
print("✅ XDR copied to clipboard — paste into Stellar Lab:")
print("   https://lab.stellar.org/transaction/sign?network=mainnet")
print()
print("Co-founder signing link (XDR pre-filled):")
print(link)
print()
print("After co-founder signs, submit:")
print('  stellar tx send --network mainnet "<FINAL_XDR>"')
print()
print("Verify afterwards:")
print("  stellar contract invoke --id " + STAKING_CONTRACT + " \\")
print("    --rpc-url https://soroban-rpc.mainnet.stellar.gateway.fm \\")
print('    --network-passphrase "Public Global Stellar Network ; September 2015" \\')
print("    --source-account blub-issuer-v2 --send=no -- get_config")
