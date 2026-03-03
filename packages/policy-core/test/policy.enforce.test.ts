import { describe, expect, it } from "vitest";
import { enforcePayment } from "../src/index.js";
import { ASSET_ERC20_USDC, mkDecision, mkSettlement } from "./builders.js";

describe("policy.enforce", () => {
  it("rejects rail mismatch", () => {
    const result = enforcePayment(
      mkDecision({ rail: "xrpl" }),
      mkSettlement({ rail: "evm" }),
    );
    expect(result).toEqual({ allowed: false, reason: "RAIL_NOT_ALLOWED" });
  });

  it("rejects asset mismatch", () => {
    const result = enforcePayment(
      mkDecision({ rail: "evm", asset: ASSET_ERC20_USDC }),
      mkSettlement({ rail: "evm" }),
    );
    expect(result).toEqual({ allowed: false, reason: "ASSET_NOT_ALLOWED" });
  });

  it("rejects amount mismatch (capPerTx exceeded)", () => {
    const result = enforcePayment(
      mkDecision({ maxSpend: { perTxMinor: "1000" } }),
      mkSettlement({ amount: "1001" }),
    );
    expect(result).toEqual({ allowed: false, reason: "CAP_EXCEEDED_TX" });
  });

  it("rejects expired decision", () => {
    const result = enforcePayment(
      mkDecision({ expiresAtISO: "2000-01-01T00:00:00.000Z" }),
      mkSettlement(),
    );
    expect(result).toEqual({ allowed: false, reason: "NEEDS_APPROVAL" });
  });

  it("uses settlement.nowISO for deterministic expiry checks when provided", () => {
    const allowedBeforeExpiry = enforcePayment(
      mkDecision({ expiresAtISO: "2026-01-01T00:00:00.000Z" }),
      mkSettlement({ nowISO: "2025-01-01T00:00:00.000Z" }),
    );
    expect(allowedBeforeExpiry).toEqual({ allowed: true });

    const deniedAfterExpiry = enforcePayment(
      mkDecision({ expiresAtISO: "2026-01-01T00:00:00.000Z" }),
      mkSettlement({ nowISO: "2027-01-01T00:00:00.000Z" }),
    );
    expect(deniedAfterExpiry).toEqual({ allowed: false, reason: "NEEDS_APPROVAL" });
  });

  it("rejects missing decisionId and missing sessionGrantId when required", () => {
    const missingDecisionId = enforcePayment(
      mkDecision({ decisionId: "" }),
      mkSettlement(),
    );
    expect(missingDecisionId).toEqual({ allowed: false, reason: "NEEDS_APPROVAL" });

    const missingSessionGrant = enforcePayment(
      mkDecision({ sessionGrantId: undefined }),
      mkSettlement({ expectedSessionGrantId: "grant-1" }),
    );
    expect(missingSessionGrant).toEqual({ allowed: false, reason: "NEEDS_APPROVAL" });
  });

  it("rejects policy hash mismatch with dedicated reason", () => {
    const result = enforcePayment(
      mkDecision({ policyHash: "ph-expected" }),
      mkSettlement({ expectedPolicyHash: "ph-other" }),
    );
    expect(result).toEqual({ allowed: false, reason: "POLICY_HASH_MISMATCH" });
  });

  it("rejects quote destination mismatch with dedicated reason", () => {
    const result = enforcePayment(
      mkDecision({
        rail: "evm",
        asset: ASSET_ERC20_USDC,
        settlementQuotes: [
          {
            quoteId: "q-1",
            rail: "evm",
            asset: ASSET_ERC20_USDC,
            amount: { amount: "1000", decimals: 6 },
            destination: "0xExpected",
            expiresAt: "2099-01-01T00:00:00.000Z",
          },
        ],
      }),
      mkSettlement({
        rail: "evm",
        asset: ASSET_ERC20_USDC,
        amount: "1000",
        destination: "0xActual",
      }),
    );
    expect(result).toEqual({ allowed: false, reason: "DESTINATION_MISMATCH" });
  });

  it("rejects missing settlement destination when quote binds destination", () => {
    const result = enforcePayment(
      mkDecision({
        rail: "evm",
        asset: ASSET_ERC20_USDC,
        settlementQuotes: [
          {
            quoteId: "q-1",
            rail: "evm",
            asset: ASSET_ERC20_USDC,
            amount: { amount: "1000", decimals: 6 },
            destination: "0xExpected",
            expiresAt: "2099-01-01T00:00:00.000Z",
          },
        ],
      }),
      mkSettlement({
        rail: "evm",
        asset: ASSET_ERC20_USDC,
        amount: "1000",
        destination: undefined,
      }),
    );
    expect(result).toEqual({ allowed: false, reason: "DESTINATION_MISMATCH" });
  });

  it("rejects quote amount mismatch with dedicated reason", () => {
    const result = enforcePayment(
      mkDecision({
        rail: "evm",
        asset: ASSET_ERC20_USDC,
        settlementQuotes: [
          {
            quoteId: "q-1",
            rail: "evm",
            asset: ASSET_ERC20_USDC,
            amount: { amount: "1000", decimals: 6 },
            destination: "0xExpected",
            expiresAt: "2099-01-01T00:00:00.000Z",
          },
        ],
      }),
      mkSettlement({
        rail: "evm",
        asset: ASSET_ERC20_USDC,
        amount: "1001",
        destination: "0xExpected",
      }),
    );
    expect(result).toEqual({ allowed: false, reason: "QUOTE_AMOUNT_MISMATCH" });
  });

  it("rejects when settlement does not match any quote", () => {
    const result = enforcePayment(
      mkDecision({
        rail: "evm",
        asset: ASSET_ERC20_USDC,
        settlementQuotes: [
          {
            quoteId: "q-1",
            rail: "evm",
            asset: ASSET_ERC20_USDC,
            amount: { amount: "1000", decimals: 6 },
            destination: "0xExpected",
            expiresAt: "2099-01-01T00:00:00.000Z",
          },
        ],
      }),
      mkSettlement({
        rail: "evm",
        asset: { kind: "ERC20", chainId: 84532, token: "0xDifferentToken" },
        amount: "1000",
      }),
    );
    expect(result).toEqual({ allowed: false, reason: "QUOTE_NOT_FOUND" });
  });

  it("does not fall back to rail+asset when quoteId is provided but not found", () => {
    const result = enforcePayment(
      mkDecision({
        rail: "evm",
        asset: ASSET_ERC20_USDC,
        settlementQuotes: [
          {
            quoteId: "q-expected",
            rail: "evm",
            asset: ASSET_ERC20_USDC,
            amount: { amount: "1000", decimals: 6 },
            destination: "0xExpected",
            expiresAt: "2099-01-01T00:00:00.000Z",
          },
        ],
      }),
      mkSettlement({
        rail: "evm",
        asset: ASSET_ERC20_USDC,
        amount: "1000",
        quoteId: "q-other",
      }),
    );
    expect(result).toEqual({ allowed: false, reason: "QUOTE_NOT_FOUND" });
  });

  it("allows exact match", () => {
    const result = enforcePayment(
      mkDecision(),
      mkSettlement(),
    );
    expect(result).toEqual({ allowed: true });
  });
});
