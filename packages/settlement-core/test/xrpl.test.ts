import { describe, expect, it, vi } from "vitest";
import {
  InMemoryReplayStore,
  buildXrplMemo,
  createChallenge,
  encodeReceiptHeader,
  type FetchTransactionResult,
} from "x402-xrpl-settlement-adapter";
import { verifyXrplSettlement } from "../src/xrpl.js";

function mkChallenge(paymentId = "pay-1") {
  return createChallenge({
    network: "xrpl:testnet",
    amount: "8",
    asset: { kind: "IOU", currency: "USD", issuer: "rIssuer" },
    destination: "rDestination",
    expiresAt: "2099-01-01T00:00:00.000Z",
    paymentId,
  });
}

function mkTx(challenge = mkChallenge()): FetchTransactionResult {
  return {
    validated: true,
    TransactionType: "Payment",
    Account: "rPayer",
    Destination: challenge.destination,
    Amount: {
      currency: challenge.asset.kind === "IOU" ? challenge.asset.currency : "USD",
      issuer: challenge.asset.kind === "IOU" ? challenge.asset.issuer : "rIssuer",
      value: challenge.amount,
    },
    Memos: [buildXrplMemo(challenge)],
  };
}

describe("verifyXrplSettlement hardening", () => {
  it("rejects wrong destination", async () => {
    const challenge = mkChallenge();
    const receiptHeaderValue = encodeReceiptHeader({
      network: challenge.network,
      txHash: "A".repeat(64),
      paymentId: challenge.paymentId,
    });
    const tx = { ...mkTx(challenge), Destination: "rWrongDestination" };
    const fetchTransaction = vi.fn(async () => tx);

    await expect(
      verifyXrplSettlement({ challenge, receiptHeaderValue, fetchTransaction }),
    ).rejects.toMatchObject({ code: "invalid_destination" });
  });

  it("rejects DestinationTag in safe mode", async () => {
    const challenge = mkChallenge();
    const receiptHeaderValue = encodeReceiptHeader({
      network: challenge.network,
      txHash: "B".repeat(64),
      paymentId: challenge.paymentId,
    });
    const tx = { ...mkTx(challenge), DestinationTag: 123 };
    const fetchTransaction = vi.fn(async () => tx);

    await expect(
      verifyXrplSettlement({ challenge, receiptHeaderValue, fetchTransaction }),
    ).rejects.toMatchObject({ code: "invalid_destination" });
  });

  it("rejects partial payment flag", async () => {
    const challenge = mkChallenge();
    const receiptHeaderValue = encodeReceiptHeader({
      network: challenge.network,
      txHash: "C".repeat(64),
      paymentId: challenge.paymentId,
    });
    const tx = { ...mkTx(challenge), Flags: 0x00020000 };
    const fetchTransaction = vi.fn(async () => tx);

    await expect(
      verifyXrplSettlement({ challenge, receiptHeaderValue, fetchTransaction }),
    ).rejects.toMatchObject({ code: "invalid_asset" });
  });

  it("rejects path payment fields (Paths/SendMax/DeliverMin)", async () => {
    const challenge = mkChallenge();
    const receiptHeaderValue = encodeReceiptHeader({
      network: challenge.network,
      txHash: "D".repeat(64),
      paymentId: challenge.paymentId,
    });
    const tx = { ...mkTx(challenge), Paths: [{}], SendMax: "1", DeliverMin: "1" };
    const fetchTransaction = vi.fn(async () => tx);

    await expect(
      verifyXrplSettlement({ challenge, receiptHeaderValue, fetchTransaction }),
    ).rejects.toMatchObject({ code: "invalid_asset" });
  });

  it("rejects when memo is missing", async () => {
    const challenge = mkChallenge();
    const receiptHeaderValue = encodeReceiptHeader({
      network: challenge.network,
      txHash: "E".repeat(64),
      paymentId: challenge.paymentId,
    });
    const tx = { ...mkTx(challenge), Memos: undefined };
    const fetchTransaction = vi.fn(async () => tx);

    await expect(
      verifyXrplSettlement({ challenge, receiptHeaderValue, fetchTransaction }),
    ).rejects.toMatchObject({ code: "invalid_memo" });
  });

  it("rejects when memo paymentId is wrong", async () => {
    const challenge = mkChallenge("pay-good");
    const badMemoChallenge = mkChallenge("pay-bad");
    const receiptHeaderValue = encodeReceiptHeader({
      network: challenge.network,
      txHash: "F".repeat(64),
      paymentId: challenge.paymentId,
    });
    const tx = { ...mkTx(challenge), Memos: [buildXrplMemo(badMemoChallenge)] };
    const fetchTransaction = vi.fn(async () => tx);

    await expect(
      verifyXrplSettlement({ challenge, receiptHeaderValue, fetchTransaction }),
    ).rejects.toMatchObject({ code: "invalid_memo" });
  });

  it("rejects tx not validated", async () => {
    const challenge = mkChallenge();
    const receiptHeaderValue = encodeReceiptHeader({
      network: challenge.network,
      txHash: "1".repeat(64),
      paymentId: challenge.paymentId,
    });
    const tx = { ...mkTx(challenge), validated: false };
    const fetchTransaction = vi.fn(async () => tx);

    await expect(
      verifyXrplSettlement({ challenge, receiptHeaderValue, fetchTransaction }),
    ).rejects.toMatchObject({ code: "tx_not_validated" });
  });

  it("rejects tx not found", async () => {
    const challenge = mkChallenge();
    const receiptHeaderValue = encodeReceiptHeader({
      network: challenge.network,
      txHash: "2".repeat(64),
      paymentId: challenge.paymentId,
    });
    const fetchTransaction = vi.fn(async () => null);

    await expect(
      verifyXrplSettlement({ challenge, receiptHeaderValue, fetchTransaction }),
    ).rejects.toMatchObject({ code: "tx_not_found" });
  });
});

describe("verifyXrplSettlement replay protection", () => {
  it("rejects same paymentId with different txHash", async () => {
    const challenge = mkChallenge("pay-replay-1");
    const replayStore = new InMemoryReplayStore();
    const fetchTransaction = vi.fn(async () => mkTx(challenge));

    await verifyXrplSettlement({
      challenge,
      receiptHeaderValue: encodeReceiptHeader({
        network: challenge.network,
        txHash: "A".repeat(64),
        paymentId: challenge.paymentId,
      }),
      fetchTransaction,
      replayStore,
    });

    await expect(
      verifyXrplSettlement({
        challenge,
        receiptHeaderValue: encodeReceiptHeader({
          network: challenge.network,
          txHash: "B".repeat(64),
          paymentId: challenge.paymentId,
        }),
        fetchTransaction,
        replayStore,
      }),
    ).rejects.toMatchObject({ code: "replay_detected" });
  });

  it("rejects same txHash with different paymentId", async () => {
    const challengeA = mkChallenge("pay-A");
    const challengeB = mkChallenge("pay-B");
    const replayStore = new InMemoryReplayStore();
    const fetchTransaction = vi.fn(async (_network, _txHash) => mkTx(challengeA));

    await verifyXrplSettlement({
      challenge: challengeA,
      receiptHeaderValue: encodeReceiptHeader({
        network: challengeA.network,
        txHash: "C".repeat(64),
        paymentId: challengeA.paymentId,
      }),
      fetchTransaction,
      replayStore,
    });

    await expect(
      verifyXrplSettlement({
        challenge: challengeB,
        receiptHeaderValue: encodeReceiptHeader({
          network: challengeB.network,
          txHash: "C".repeat(64),
          paymentId: challengeB.paymentId,
        }),
        fetchTransaction: vi.fn(async () => mkTx(challengeB)),
        replayStore,
      }),
    ).rejects.toMatchObject({ code: "replay_detected" });
  });

  it("returns idempotent success for same paymentId and same txHash", async () => {
    const challenge = mkChallenge("pay-idempotent");
    const txHash = "D".repeat(64);
    const replayStore = new InMemoryReplayStore();
    const fetchTransaction = vi.fn(async () => mkTx(challenge));

    const first = await verifyXrplSettlement({
      challenge,
      receiptHeaderValue: encodeReceiptHeader({
        network: challenge.network,
        txHash,
        paymentId: challenge.paymentId,
      }),
      fetchTransaction,
      replayStore,
    });
    expect(first.idempotent).toBe(false);

    const second = await verifyXrplSettlement({
      challenge,
      receiptHeaderValue: encodeReceiptHeader({
        network: challenge.network,
        txHash,
        paymentId: challenge.paymentId,
      }),
      fetchTransaction,
      replayStore,
    });
    expect(second.idempotent).toBe(true);
    expect(fetchTransaction).toHaveBeenCalledTimes(1);
  });
});
