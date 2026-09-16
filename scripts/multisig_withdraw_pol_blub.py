#!/usr/bin/env python3
"""
Withdraw ~10M BLUB from pool 0 as a SINGLE coin, leaving it in the contract.

PURPOSE: improve the pool ratio. Pool 0 is ~98.8% BLUB (210,625 AQUA against
17,897,592 BLUB). Removing 10M BLUB takes AQUA's share from 1.16% to 2.60%.
Removing the ABUNDANT leg is the cheap direction on a StableSwap curve — the
quote holds at ~1.012 BLUB per LP even at this size, where taking out the scarce
leg would be punitive.

The BLUB stays in the contract. Nothing is sold, nothing leaves.

`withdraw_pol_one_coin` shipped in 8f821edf and is LIVE, so this does not wait on
the pending upgrade (eb0f8ab3).

SAFETY
- Admin-auth (2-of-3 multisig).
- POL-surplus guard: only LP held ABOVE vault credit may be withdrawn, so vault
  redemptions can always settle. Surplus is 13,178,607 LP; this uses 9,880,000
  and leaves 3,298,607.
- `min_amount` is a hard floor. The call reverts rather than accepting a worse
  fill, so a moved market costs a retry, not value.

RE-QUOTE BEFORE RUNNING. The numbers below were taken on 2026-09-16 against live
reserves. If the pool has moved, MIN_AMOUNT is stale — rerun:

  stellar contract invoke --id CAMXZXXBD7DFBLYLHUW24U4MY37X7SU5XXT5ZVVUBXRXWLAIM7INI7G2 \\
    --source blub-issuer-v2 --rpc-url https://soroban-rpc.mainnet.stellar.gateway.fm \\
    --network-passphrase "Public Global Stellar Network ; September 2015" \\
    --send=no -- calc_withdraw_one_coin --share_amount 98800000000000 --i 1
"""

import os
import sys
import subprocess
import tomllib
import urllib.parse

from stellar_sdk import Keypair, Network, TransactionBuilder, StrKey, SorobanServer
from stellar_sdk.operation import InvokeHostFunction
from stellar_sdk import xdr as xdr_

STAKING_CONTRACT = "CC72BEVVKHQ57PB5FCKAZYRXCSR6DOQSTN46QR7RZMMM64YWNRPDS24S"
MULTISIG_ADMIN = "GALE4XON37AQ4KFTJKB3W32BUQGXFE46TQLKUIGBSIHSOEHTDBMKEI3M"

# Pool 0 token order from get_tokens() is [AQUA, BLUB] — sorted by contract
# address, NOT PoolInfo's (token_a=BLUB, token_b=AQUA). BLUB is index 1.
COIN_INDEX = 1
SHARE_AMOUNT = 98_800_000_000_000      # 9,880,000 LP
MIN_AMOUNT = 99_014_076_985_968        # 9,901,407.70 BLUB — quote 10,001,421.92 less 1%

RPC_URL = "https://soroban-rpc.mainnet.stellar.gateway.fm"
NETWORK_PASSPHRASE = Network.PUBLIC_NETWORK_PASSPHRASE
MAX_FEE = 1_000_000

assert COIN_INDEX in (0, 1)
assert 0 < MIN_AMOUNT < SHARE_AMOUNT * 2

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


def i128(v: int) -> xdr_.SCVal:
    hi, lo = v >> 64, v & ((1 << 64) - 1)
    return xdr_.SCVal(
        xdr_.SCValType.SCV_I128,
        i128=xdr_.Int128Parts(hi=xdr_.Int64(hi), lo=xdr_.Uint64(lo)),
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
        function_name=xdr_.SCSymbol(b"withdraw_pol_one_coin"),
        args=[
            admin_scval,
            i128(SHARE_AMOUNT),
            xdr_.SCVal(xdr_.SCValType.SCV_U32, u32=xdr_.Uint32(COIN_INDEX)),
            i128(MIN_AMOUNT),
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

print(f"Simulating withdraw_pol_one_coin({SHARE_AMOUNT} LP, coin {COIN_INDEX}, min {MIN_AMOUNT}) ...")
try:
    tx = server.prepare_transaction(tx)
    print("Simulation OK.")
except Exception as e:
    print(f"Simulation error: {e}")
    print()
    print("InsufficientBalance (6) means the POL-surplus guard refused: the contract")
    print("does not hold enough LP above vault credit. Re-check contract LP balance")
    print("against pool 0 total_lp_tokens before lowering SHARE_AMOUNT.")
    print("InvalidInput (4) here usually means the pool rejected min_amount — re-quote.")
    sys.exit(1)

tx.sign(master_kp)
xdr = tx.to_xdr()
link = "https://lab.stellar.org/transaction/sign?network=mainnet&xdr=" + urllib.parse.quote(xdr)
subprocess.run(["pbcopy"], input=xdr.encode(), check=True)

print()
print("=" * 70)
print("SIGNED WITH MASTER KEY — NEEDS ONE CO-FOUNDER SIGNATURE")
print("=" * 70)
print(f"burn LP      : {SHARE_AMOUNT/1e7:,.0f}")
print(f"receive      : ~{10_001_421.92:,.2f} BLUB (floor {MIN_AMOUNT/1e7:,.2f})")
print(f"destination  : the staking contract itself — nothing leaves")
print(f"pool ratio   : AQUA 1.16% -> ~2.60%")
print()
print("✅ XDR copied to clipboard.")
print(f"Direct link: {link}")
