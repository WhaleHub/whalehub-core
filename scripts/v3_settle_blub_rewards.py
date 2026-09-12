#!/usr/bin/env python3
"""
v2 -> v3 migration step 2: clear every staker's accrued BLUB reward balance.

WHY THIS EXISTS
v3 pays stakers in AQUA instead of BLUB. Reward units in the Synthetix
accumulator carry no record of which asset funded them, so flipping the payout
token while balances are outstanding would pay stakers an asset they did not
earn. `set_reward_policy` therefore refuses a token change unless the contract's
outstanding-reward ledger is zero, and this sweep is what drives it there.

The claim cooldown (7 days) means stakers cannot simply be asked to claim, so
`settle_user_rewards(manager, user)` pays each balance out directly, bypassing
the cooldown. It is manager-signed (blub-issuer-v2, single-sig) — NOT multisig —
and idempotent: a staker with nothing accrued returns 0 rather than erroring, so
the sweep can be re-run safely.

ORDER OF OPERATIONS
  1. multisig: upgrade to the v3 wasm            (settle_user_rewards ships in it)
  2. manager:  THIS SCRIPT                       (drives outstanding to zero)
  3. multisig: set_reward_policy(Aqua, ...)      (the actual switch)

Landing step 1 alone changes nothing: the policy defaults to v2 behaviour.

USAGE
  python3 scripts/v3_settle_blub_rewards.py              # dry run, reports only
  python3 scripts/v3_settle_blub_rewards.py --execute    # signs and submits

Reads the staker list from scripts/all_stakers.csv (regenerate with
scripts/list_all_stakers.py first — a staker missing from that file is a staker
whose balance does not get cleared).
"""

import csv
import os
import sys
import time
import tomllib

from stellar_sdk import (
    Keypair, Network, TransactionBuilder, SorobanServer, scval, Address,
)
from stellar_sdk.exceptions import PrepareTransactionException

STAKING_CONTRACT = "CC72BEVVKHQ57PB5FCKAZYRXCSR6DOQSTN46QR7RZMMM64YWNRPDS24S"
BLUB_SAC = "CBMFDIRY5OKI4JJURXC4SMEQPWB4UUADIADJK4NA6CYBNOYK4W4TMLLF"
RPC_URL = "https://soroban-rpc.mainnet.stellar.gateway.fm"
NETWORK_PASSPHRASE = Network.PUBLIC_NETWORK_PASSPHRASE
STAKERS_CSV = os.path.join(os.path.dirname(__file__), "all_stakers.csv")
INCLUSION_FEE = 10_000_000
STROOP = 10_000_000

# Fail SAFE: execute only on an exact, unambiguous flag. Anything else — a typo,
# a stray argument, no arguments — is a dry run. (A previous script in this repo
# parsed its dry-run flag the other way round and would have executed on a typo.)
EXECUTE = "--execute" in sys.argv[1:]


def load_manager() -> Keypair:
    path = os.path.expanduser("~/.config/stellar/identity/blub-issuer-v2.toml")
    try:
        with open(path, "rb") as f:
            return Keypair.from_secret(tomllib.load(f)["secret_key"])
    except Exception as e:
        secret = os.environ.get("MANAGER_SECRET", "")
        if not secret:
            print(f"Could not load manager key ({e}). Set MANAGER_SECRET.")
            sys.exit(1)
        return Keypair.from_secret(secret)


def read_stakers() -> list[str]:
    if not os.path.exists(STAKERS_CSV):
        print(f"Missing {STAKERS_CSV}. Run scripts/list_all_stakers.py first.")
        sys.exit(1)
    with open(STAKERS_CSV) as f:
        return [r["address"] for r in csv.DictReader(f) if r.get("address")]


def simulate(server: SorobanServer, source, fn: str, args: list):
    tx = (
        TransactionBuilder(source, network_passphrase=NETWORK_PASSPHRASE, base_fee=INCLUSION_FEE)
        .append_invoke_contract_function_op(STAKING_CONTRACT, fn, args)
        .set_timeout(60)
        .build()
    )
    return server.simulate_transaction(tx)


def main() -> None:
    manager = load_manager()
    server = SorobanServer(RPC_URL)
    stakers = read_stakers()

    print(f"Manager : {manager.public_key}")
    print(f"Mode    : {'EXECUTE — will sign and submit' if EXECUTE else 'DRY RUN — no transactions'}")
    print(f"Stakers : {len(stakers)} from all_stakers.csv")
    print()

    src = server.load_account(manager.public_key)

    # Contract BLUB on hand has to cover the whole sweep.
    bal_sim = simulate(server, src, "get_pending_rewards",
                       [scval.to_address(Address(stakers[0]))]) if stakers else None
    if bal_sim is not None and bal_sim.error:
        print(f"Simulation failed against the contract: {bal_sim.error}")
        print("If this says the function is missing, the v3 upgrade has not landed yet.")
        sys.exit(1)

    pending: list[tuple[str, int]] = []
    total = 0
    for addr in stakers:
        sim = simulate(server, src, "get_pending_rewards", [scval.to_address(Address(addr))])
        if sim.error:
            print(f"  {addr}  SIMULATION ERROR: {sim.error}")
            continue
        amount = scval.to_native(sim.results[0].xdr) if sim.results else 0
        amount = int(amount or 0)
        if amount > 0:
            pending.append((addr, amount))
            total += amount
        print(f"  {addr}  {amount/STROOP:>18,.7f} BLUB")

    print()
    print(f"Stakers with a balance : {len(pending)}")
    print(f"Total to settle        : {total/STROOP:,.7f} BLUB")

    if total == 0:
        print()
        print("Nothing outstanding — the reward ledger is already clear.")
        print("Next: multisig set_reward_policy(Aqua, 5000/3000/1000/1000).")
        return

    if not EXECUTE:
        print()
        print("DRY RUN. Re-run with --execute to settle.")
        print("Check the contract holds at least the total above in BLUB first.")
        return

    print()
    ok, failed = 0, 0
    for addr, amount in pending:
        try:
            src = server.load_account(manager.public_key)
            tx = (
                TransactionBuilder(src, network_passphrase=NETWORK_PASSPHRASE, base_fee=INCLUSION_FEE)
                .append_invoke_contract_function_op(
                    STAKING_CONTRACT,
                    "settle_user_rewards",
                    [scval.to_address(Address(manager.public_key)), scval.to_address(Address(addr))],
                )
                .set_timeout(120)
                .build()
            )
            tx = server.prepare_transaction(tx)
            tx.sign(manager)
            resp = server.send_transaction(tx)
            print(f"  {addr}  {amount/STROOP:>15,.7f} BLUB  -> {resp.hash}")
            ok += 1
            time.sleep(2)  # stay under the RPC rate limit
        except (PrepareTransactionException, Exception) as e:
            print(f"  {addr}  FAILED: {e}")
            failed += 1

    print()
    print(f"Settled {ok}, failed {failed}.")
    print("Re-run this script (dry run) to confirm every balance now reads zero,")
    print("then have the multisig call set_reward_policy to switch to AQUA.")


if __name__ == "__main__":
    main()
