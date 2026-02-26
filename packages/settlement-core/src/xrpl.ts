import type { SettlementVerifyOutput } from "./types.js";
import {
  verifySettlement,
  InMemoryReplayStore,
  type FetchTransaction,
  type X402Challenge,
} from "x402-xrpl-settlement-adapter";

export async function verifyXrplSettlement(params: {
  challenge: X402Challenge;
  receiptHeaderValue: string;
  fetchTransaction: FetchTransaction;
  replayStore?: InMemoryReplayStore;
  now?: Date;
}): Promise<SettlementVerifyOutput> {
  const replayStore = params.replayStore ?? new InMemoryReplayStore();

  const result = await verifySettlement({
    challenge: params.challenge,
    receiptHeaderValue: params.receiptHeaderValue,
    fetchTransaction: params.fetchTransaction,
    replayStore,
    now: params.now,
  });

  return {
    ok: true,
    idempotent: result.idempotent,
    txHash: result.receipt.txHash,
    payer: result.payerAccount,
    amount: params.challenge.amount,
    asset:
      params.challenge.asset.kind === "XRP"
        ? { kind: "XRP" }
        : {
            kind: "IOU",
            currency: params.challenge.asset.currency,
            issuer: params.challenge.asset.issuer,
          },
  };
}

