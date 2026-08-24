import { Horizon, type Transaction } from "@stellar/stellar-sdk";
import { AQUA, BLUB, isAsset } from "./assets.js";
import type { Inventory, LiveOffer } from "../strategy/types.js";
import { withRetry } from "../util/retry.js";
import type { Logger } from "../obs/logger.js";

export interface OrderBookTop {
  bestBid: number | null; // AQUA per BLUB
  bestAsk: number | null;
  bidDepthBlub: number;
}

export type AccountResponse = Awaited<ReturnType<Horizon.Server["loadAccount"]>>;

function matchesPair(
  side: { asset_type: string; asset_code?: string; asset_issuer?: string },
  other: { asset_type: string; asset_code?: string; asset_issuer?: string },
): { blubIsSelling: boolean } | null {
  const sellBlub = isAsset(side, BLUB);
  const sellAqua = isAsset(side, AQUA);
  const buyBlub = isAsset(other, BLUB);
  const buyAqua = isAsset(other, AQUA);
  if (sellBlub && buyAqua) return { blubIsSelling: true };
  if (sellAqua && buyBlub) return { blubIsSelling: false };
  return null;
}

export class HorizonClient {
  private readonly server: Horizon.Server;

  constructor(
    url: string,
    private readonly log: Logger,
  ) {
    this.server = new Horizon.Server(url, { allowHttp: url.startsWith("http://") });
  }

  loadAccount(pubkey: string): Promise<AccountResponse> {
    return withRetry(() => this.server.loadAccount(pubkey));
  }

  inventoryOf(account: AccountResponse): Inventory {
    let blub = 0;
    let aqua = 0;
    let xlm = 0;
    for (const b of account.balances) {
      if (b.asset_type === "native") xlm = Number(b.balance);
      else if (isAsset(b, BLUB)) blub = Number(b.balance);
      else if (isAsset(b, AQUA)) aqua = Number(b.balance);
    }
    return { blub, aqua, xlm };
  }

  trustlines(account: AccountResponse): { aqua: boolean; blub: boolean } {
    let aqua = false;
    let blub = false;
    for (const b of account.balances) {
      if (isAsset(b, AQUA)) aqua = true;
      if (isAsset(b, BLUB)) blub = true;
    }
    return { aqua, blub };
  }

  /** Our resting BLUB/AQUA offers, normalized to AQUA-per-BLUB prices + BLUB amounts. */
  async myOffers(pubkey: string): Promise<LiveOffer[]> {
    const page = await withRetry(() => this.server.offers().forAccount(pubkey).limit(200).call());
    const out: LiveOffer[] = [];
    for (const rec of page.records) {
      const m = matchesPair(rec.selling, rec.buying);
      if (!m) continue;
      const priceField = Number(rec.price); // buying per selling
      const amount = Number(rec.amount);
      if (m.blubIsSelling) {
        // ask: selling BLUB → price is AQUA per BLUB, amount is BLUB
        out.push({ id: String(rec.id), side: "ask", price: priceField, amount });
      } else {
        // bid: selling AQUA, buying BLUB → price is BLUB per AQUA; invert
        const priceAquaPerBlub = priceField > 0 ? 1 / priceField : 0;
        out.push({ id: String(rec.id), side: "bid", price: priceAquaPerBlub, amount: amount * priceField });
      }
    }
    return out;
  }

  /** Top of the BLUB/AQUA order book (prices in AQUA per BLUB). */
  async orderBookTop(): Promise<OrderBookTop> {
    const ob = await withRetry(() => this.server.orderbook(BLUB, AQUA).limit(20).call());
    const bestBid = ob.bids.length ? Number(ob.bids[0]!.price) : null;
    const bestAsk = ob.asks.length ? Number(ob.asks[0]!.price) : null;
    const bidDepthBlub = ob.bids.reduce((s, b) => s + Number(b.amount), 0);
    return { bestBid, bestAsk, bidDepthBlub };
  }

  async submit(tx: Transaction): Promise<string> {
    try {
      const res = await this.server.submitTransaction(tx);
      return res.hash;
    } catch (e) {
      const codes = (e as { response?: { data?: { extras?: { result_codes?: unknown } } } })?.response
        ?.data?.extras?.result_codes;
      this.log.error({ resultCodes: codes }, "submitTransaction failed");
      throw new Error(`submit failed: ${JSON.stringify(codes ?? (e as Error).message)}`);
    }
  }
}
