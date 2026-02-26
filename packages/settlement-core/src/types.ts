export type Rail = "xrpl" | "evm" | "stripe" | "hosted";

export type Asset =
  | { kind: "XRP" }
  | { kind: "IOU"; currency: string; issuer: string }
  | { kind: "ERC20"; chainId: number; token: string };

export interface SettlementProof {
  receiptHeaderValue: string; // X-PAYMENT-RECEIPT
}

export interface SettlementVerifyInput {
  rail: Rail;
  challenge: unknown;
  proof: SettlementProof;
  now?: Date;
}

/**
 * Amount verification stance for settlement.
 * - strictExact: on-chain amount must equal the challenge amount (no partials, no tolerance).
 * - tolerant: reserved for future use (partial payments, rounding, issued-currency precision).
 */
export type AmountVerificationStance = "strictExact" | "tolerant";

export interface SettlementVerifyOutput {
  ok: true;
  idempotent: boolean;
  txHash: string;
  payer?: string;
  /** Verified amount (same units as challenge). Current stance: strictExact. */
  amount: string;
  asset: Asset;
  /** Stance used for amount verification. Default strictExact. */
  amountVerification: AmountVerificationStance;
}

