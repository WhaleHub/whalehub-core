#!/usr/bin/env python3
"""
v2 -> v3 migration step 3: switch the reward engine to AQUA.

Builds and master-signs `set_reward_policy` for the 2-of-3 multisig. This is the
actual switch — steps 1 (upgrade) and 2 (settle) change no payout behaviour on
their own, because the policy defaults to v2 behaviour until this lands.

Version A split, per the 12 Sep 2026 v3 document:
    50%  BLUB stakers    claimable AQUA, no swap
    30%  AQUA-BLUB LPs   vault compounds 4x daily
    10%  POL
    10%  treasury
     0%  protocol BLUB buys   (removed — this was the exit subsidy)

`allow_user_choice` lets a staker elect BLUB instead and have the contract swap
at claim time, wearing the slippage. AQUA is the default for everyone who does
not elect.

REVERSIBLE: re-run with PAYOUT_TOKEN = "Blub" to put the engine back, no upgrade
needed. The contract refuses a token change while any reward balance is
outstanding, so a revert needs its own settlement sweep first
(scripts/v3_settle_blub_rewards.py, which settles in whatever the current token
is).

Co-founder pastes the clipboard XDR into Stellar Lab for the second signature.
"""

import os
import sys
import subprocess
import tomllib
import urllib.parse

from stellar_sdk import Keypair, Network, TransactionBuilder, StrKey, SorobanServer
from stellar_sdk.operation import InvokeHostFunction
from stellar_sdk import xdr as xdr_

# ── Config ───────────────────────────────────────────────────────────────
STAKING_CONTRACT = "CC72BEVVKHQ57PB5FCKAZYRXCSR6DOQSTN46QR7RZMMM64YWNRPDS24S"
MULTISIG_ADMIN = "GALE4XON37AQ4KFTJKB3W32BUQGXFE46TQLKUIGBSIHSOEHTDBMKEI3M"

PAYOUT_TOKEN = "Aqua"        # "Aqua" (v3) or "Blub" (revert to v2)
ALLOW_USER_CHOICE = True     # stakers may elect the other token; contract swaps
STAKER_BPS = 5000
LP_BPS = 3000
POL_BPS = 1000
TREASURY_BPS = 1000
MAX_SWAP_SLIPPAGE_BPS = 100  # 1% floor on a user-elected swap

RPC_URL = "https://soroban-rpc.mainnet.stellar.gateway.fm"
NETWORK_PASSPHRASE = Network.PUBLIC_NETWORK_PASSPHRASE
MAX_FEE = 1_000_000

assert PAYOUT_TOKEN in ("Aqua", "Blub"), "PAYOUT_TOKEN must be Aqua or Blub"
assert STAKER_BPS + LP_BPS + POL_BPS + TREASURY_BPS == 10_000, "split must total 100%"
assert 0 <= MAX_SWAP_SLIPPAGE_BPS < 10_000

# ── Load master key ──────────────────────────────────────────────────────
identity_path = os.path.expanduser("~/.config/stellar/identity/multisig-admin.toml")
try:
    with open(identity_path, "rb") as f:
        master_kp = Keypair.from_secret(tomllib.load(f).get("secret_key"))
    print(f"Master key: {master_kp.public_key}")
except Exception as e:
    secret = os.environ.get("MASTER_SECRET", "")
    if not secret:
        print(f"Load failed: {e}. Set MASTER_SECRET.")
        sys.exit(1)
    master_kp = Keypair.from_secret(secret)
    print(f"Master key (env): {master_kp.public_key}")


def u32(v: int) -> xdr_.SCVal:
    return xdr_.SCVal(xdr_.SCValType.SCV_U32, u32=xdr_.Uint32(v))


def boolean(v: bool) -> xdr_.SCVal:
    return xdr_.SCVal(xdr_.SCValType.SCV_BOOL, b=v)


def unit_enum(name: str) -> xdr_.SCVal:
    """A soroban unit-variant enum encodes as a vec holding one symbol."""
    return xdr_.SCVal(
        xdr_.SCValType.SCV_VEC,
        vec=xdr_.SCVec([xdr_.SCVal(xdr_.SCValType.SCV_SYMBOL,
                                   sym=xdr_.SCSymbol(name.encode()))]),
    )


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

host_function = xdr_.HostFunction(
    type=xdr_.HostFunctionType.HOST_FUNCTION_TYPE_INVOKE_CONTRACT,
    invoke_contract=xdr_.InvokeContractArgs(
        contract_address=xdr_.SCAddress(
            xdr_.SCAddressType.SC_ADDRESS_TYPE_CONTRACT,
            contract_id=xdr_.Hash(StrKey.decode_contract(STAKING_CONTRACT)),
        ),
        function_name=xdr_.SCSymbol(b"set_reward_policy"),
        args=[
            admin_scval,
            unit_enum(PAYOUT_TOKEN),
            boolean(ALLOW_USER_CHOICE),
            u32(STAKER_BPS),
            u32(LP_BPS),
            u32(POL_BPS),
            u32(TREASURY_BPS),
            u32(MAX_SWAP_SLIPPAGE_BPS),
        ],
    ),
)

server = SorobanServer(RPC_URL)
account = server.load_account(MULTISIG_ADMIN)

tx = (
    TransactionBuilder(account, network_passphrase=NETWORK_PASSPHRASE, base_fee=MAX_FEE)
    .append_operation(InvokeHostFunction(host_function=host_function, auth=[]))
    .set_timeout(3600)  # 1 hour to collect the co-founder's signature
    .build()
)

print(f"Simulating set_reward_policy -> {PAYOUT_TOKEN} ...")
try:
    tx = server.prepare_transaction(tx)
    print("Simulation OK.")
except Exception as e:
    print(f"Simulation error: {e}")
    print()
    print("Error 33 (RewardsUnsettled) means stakers still hold accrued balances.")
    print("Run scripts/v3_settle_blub_rewards.py --execute first, then retry.")
    sys.exit(1)

tx.sign(master_kp)
xdr = tx.to_xdr()
link = "https://lab.stellar.org/transaction/sign?network=mainnet&xdr=" + urllib.parse.quote(xdr)
subprocess.run(["pbcopy"], input=xdr.encode(), check=True)

print()
print("=" * 70)
print("SIGNED WITH MASTER KEY — NEEDS ONE CO-FOUNDER SIGNATURE")
print("=" * 70)
print(f"payout_token      : {PAYOUT_TOKEN}")
print(f"allow_user_choice : {ALLOW_USER_CHOICE}")
print(f"split             : {STAKER_BPS/100:.0f}% stakers / {LP_BPS/100:.0f}% LPs / "
      f"{POL_BPS/100:.0f}% POL / {TREASURY_BPS/100:.0f}% treasury")
print(f"swap slippage cap : {MAX_SWAP_SLIPPAGE_BPS/100:.2f}%")
print()
print("✅ XDR copied to clipboard.")
print(f"Direct link: {link}")
