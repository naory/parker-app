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

export interface SettlementVerifyOutput {
  ok: true;
  idempotent: boolean;
  txHash: string;
  payer?: string;
  amount: string;
  asset: Asset;
}

