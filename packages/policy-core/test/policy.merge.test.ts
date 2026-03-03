import { describe, expect, it } from "vitest";
import { evaluateEntryPolicy, resolveEffectivePolicy } from "../src/index.js";
import { mkEntryCtx, mkPolicy, ASSET_IOU_USDC, ASSET_ERC20_USDC } from "./builders.js";

describe("policy.merge", () => {
  it("allowlist intersection works for rails and assets", () => {
    const platform = mkPolicy({
      railAllowlist: ["xrpl", "evm"],
      assetAllowlist: [ASSET_IOU_USDC, ASSET_ERC20_USDC],
    });
    const lot = mkPolicy({
      railAllowlist: ["xrpl", "stripe"],
      assetAllowlist: [ASSET_IOU_USDC],
    });

    const merged = resolveEffectivePolicy({ platform, lot });
    expect(merged.railAllowlist).toEqual(["xrpl"]);
    expect(merged.assetAllowlist).toEqual([ASSET_IOU_USDC]);
  });

  it("deny when merged intersection is empty", () => {
    const platform = mkPolicy({ railAllowlist: ["evm"] });
    const lot = mkPolicy({ railAllowlist: ["stripe"] });
    const policy = resolveEffectivePolicy({ platform, lot });

    const grant = evaluateEntryPolicy(
      mkEntryCtx({
        policy,
        railsOffered: ["evm", "stripe"],
        assetsOffered: [ASSET_IOU_USDC],
      }),
    );

    expect(grant.grantAction).toBe("DENY");
    expect(grant.reasons).toContain("RAIL_NOT_ALLOWED");
  });

  it("caps merge uses strictest numeric min across layers", () => {
    const platform = mkPolicy({
      capPerTxMinor: "1000",
      capPerSessionMinor: "5000",
      capPerDayMinor: "10000",
    });
    const owner = mkPolicy({
      capPerTxMinor: "900",
      capPerSessionMinor: "6000",
    });
    const lot = mkPolicy({
      capPerTxMinor: "950",
      capPerDayMinor: "9000",
    });

    const merged = resolveEffectivePolicy({ platform, owner, lot });
    expect(merged.capPerTxMinor).toBe("900");
    expect(merged.capPerSessionMinor).toBe("5000");
    expect(merged.capPerDayMinor).toBe("9000");
  });
});
