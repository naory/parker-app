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

  it("allows exact match", () => {
    const result = enforcePayment(
      mkDecision(),
      mkSettlement(),
    );
    expect(result).toEqual({ allowed: true });
  });
});
