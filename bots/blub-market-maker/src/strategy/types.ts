export type Side = "bid" | "ask";

/** A quote the strategy wants to be live. price = AQUA per BLUB; amount = BLUB. */
export interface DesiredOffer {
  side: Side;
  level: number; // 0-based ladder level
  price: number; // AQUA per BLUB
  amount: number; // BLUB
}

/** An offer currently resting on the SDEX for our account. */
export interface LiveOffer {
  id: string;
  side: Side;
  price: number; // AQUA per BLUB
  amount: number; // BLUB
}

export interface Inventory {
  blub: number;
  aqua: number;
  xlm: number;
}

/** Actions the reconciler emits to converge live → desired. */
export type OfferAction =
  | { type: "create"; side: Side; level: number; price: number; amount: number }
  | { type: "update"; side: Side; level: number; offerId: string; price: number; amount: number }
  | { type: "cancel"; side: Side; offerId: string };

/** Pluggable strategy interface — a future arbitrage module implements this too. */
export interface Strategy {
  readonly name: string;
  computeDesired(input: {
    mid: number;
    inventory: Inventory;
  }): DesiredOffer[];
}
