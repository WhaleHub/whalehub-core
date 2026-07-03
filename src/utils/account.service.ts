import { Horizon } from "@stellar/stellar-sdk";

export class AccountService extends Horizon.AccountResponse {
  constructor(account: Horizon.ServerApi.AccountRecord) {
    super(account);
  }
}
