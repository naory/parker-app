import { describe, expect, it } from "vitest";
import { evaluatePaymentPolicy } from "../src/index.js";
import { mkPaymentCtx, mkPolicy } from "./builders.js";

describe("policy.exit", () => {
  it("decision ALLOW when under caps", () => {
    const decision = evaluatePaymentPolicy(
      mkPaymentCtx({
        policy: mkPolicy({ capPerTxMinor: "2000" }),
        priceFiat: { amountMinor: "1000", currency: "USD" },
      }),
    );
    expect(decision.action).toBe("ALLOW");
  });

  it("decision REQUIRE_APPROVAL when grant expired and reasons preserved", () => {
    const decision = evaluatePaymentPolicy(
      mkPaymentCtx({
        grantExpiresAtISO: "2025-01-01T00:00:00.000Z",
        nowISO: "2026-01-01T00:00:00.000Z",
        grantReasons: ["OK"],
      }),
    );

    expect(decision.action).toBe("REQUIRE_APPROVAL");
    expect(decision.reasons).toContain("OK");
    expect(decision.reasons).toContain("GRANT_EXPIRED");
    expect(decision.reasons).toContain("NEEDS_APPROVAL");
  });

  it("decision DENY when over cap", () => {
    const decision = evaluatePaymentPolicy(
      mkPaymentCtx({
        policy: mkPolicy({ capPerTxMinor: "999" }),
        priceFiat: { amountMinor: "1000", currency: "USD" },
      }),
    );
    expect(decision.action).toBe("DENY");
    expect(decision.reasons).toContain("CAP_EXCEEDED_TX");
  });

  it("decision includes sessionGrantId when ctx includes grant", () => {
    const decision = evaluatePaymentPolicy(
      mkPaymentCtx({ sessionGrantId: "grant-xyz" }),
    );
    expect(decision.sessionGrantId).toBe("grant-xyz");
  });

  it("treats undefined rail allowlist as no restriction", () => {
    const decision = evaluatePaymentPolicy(
      mkPaymentCtx({
        policy: mkPolicy({ railAllowlist: undefined }),
        railsOffered: ["stripe"],
      }),
    );
    expect(decision.action).toBe("ALLOW");
    expect(decision.rail).toBe("stripe");
  });

  it("treats empty rail allowlist as deny-all", () => {
    const decision = evaluatePaymentPolicy(
      mkPaymentCtx({
        policy: mkPolicy({ railAllowlist: [] }),
      }),
    );
    expect(decision.action).toBe("DENY");
    expect(decision.reasons).toContain("RAIL_NOT_ALLOWED");
  });

  it("treats empty asset allowlist as deny-all for crypto rails", () => {
    const decision = evaluatePaymentPolicy(
      mkPaymentCtx({
        policy: mkPolicy({ assetAllowlist: [] }),
        railsOffered: ["xrpl"],
      }),
    );
    expect(decision.action).toBe("DENY");
    expect(decision.reasons).toContain("ASSET_NOT_ALLOWED");
  });

  it("treats empty lot allowlist as deny-all", () => {
    const decision = evaluatePaymentPolicy(
      mkPaymentCtx({
        policy: mkPolicy({ lotAllowlist: [] }),
      }),
    );
    expect(decision.action).toBe("DENY");
    expect(decision.reasons).toContain("LOT_NOT_ALLOWED");
  });
});
