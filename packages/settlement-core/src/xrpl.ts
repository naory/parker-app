import type { SettlementVerifyOutput } from "./types.js";
import {
  verifySettlement,
  InMemoryReplayStore,
  type FetchTransaction,
  type X402Challenge,
} from "x402-xrpl-settlement-adapter";

/**
 * Verify XRPL settlement: replay-safe check of receipt vs challenge.
 * Amount stance: strictExact — adapter ensures on-chain amount equals challenge;
 * we return the challenge amount. Tolerant/partial payments not yet supported.
 */
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

  const output: SettlementVerifyOutput = {
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
    amountVerification: "strictExact",
  };
  return output;
}

