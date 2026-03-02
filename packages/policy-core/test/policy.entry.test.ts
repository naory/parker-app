import { describe, expect, it } from "vitest";
import { evaluateEntryPolicy } from "../src/index.js";
import { ASSET_IOU_USDC, mkEntryCtx, mkPolicy } from "./builders.js";

describe("policy.entry", () => {
  it("allows entry when operator/lot are allowed and rails/assets are offered", () => {
    const policy = mkPolicy({
      operatorAllowlist: ["op-1"],
      lotAllowlist: ["LOT-A"],
      railAllowlist: ["xrpl", "stripe"],
      assetAllowlist: [ASSET_IOU_USDC],
    });

    const grant = evaluateEntryPolicy(mkEntryCtx({ policy }));
    expect(grant.grantAction).toBe("ALLOW");
    expect(grant.allowedRails).toContain("xrpl");
    expect(grant.allowedAssets).toEqual([ASSET_IOU_USDC]);
  });

  it("denies entry when vendor/operator is not allowed", () => {
    const grant = evaluateEntryPolicy(
      mkEntryCtx({
        policy: mkPolicy({ operatorAllowlist: ["op-2"] }),
        operatorId: "op-1",
      }),
    );

    expect(grant.grantAction).toBe("DENY");
    expect(grant.reasons).toContain("VENDOR_NOT_ALLOWED");
  });

  it("requires approval when risk is high", () => {
    const grant = evaluateEntryPolicy(mkEntryCtx({ riskScore: 95 }));
    expect(grant.grantAction).toBe("REQUIRE_APPROVAL");
    expect(grant.reasons).toContain("RISK_HIGH");
    expect(grant.reasons).toContain("NEEDS_APPROVAL");
  });

  it("grant includes policyHash, allowedRails, allowedAssets, expiresAt, reasons", () => {
    const grant = evaluateEntryPolicy(mkEntryCtx());
    expect(grant.policyHash.length).toBeGreaterThan(10);
    expect(grant.allowedRails.length).toBeGreaterThan(0);
    expect(Array.isArray(grant.allowedAssets)).toBe(true);
    expect(typeof grant.expiresAtISO).toBe("string");
    expect(Array.isArray(grant.reasons)).toBe(true);
    expect(grant.reasons.length).toBeGreaterThan(0);
  });
});
