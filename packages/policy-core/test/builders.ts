import {
  POLICY_SCHEMA_VERSION,
  type Asset,
  type EntryPolicyContext,
  type PaymentPolicyContext,
  type PaymentPolicyDecision,
  type Policy,
  type Rail,
  type SettlementResult,
} from "../src/index.js";

const NOW_ISO = "2026-01-01T00:00:00.000Z";

export const ASSET_IOU_USDC: Asset = {
  kind: "IOU",
  currency: "USDC",
  issuer: "rIssuer",
};

export const ASSET_ERC20_USDC: Asset = {
  kind: "ERC20",
  chainId: 84532,
  token: "0x0000000000000000000000000000000000000001",
};

export function mkPolicy(overrides: Partial<Policy> = {}): Policy {
  return {
    version: POLICY_SCHEMA_VERSION,
    capPerTxMinor: "1000000",
    capPerSessionMinor: "5000000",
    capPerDayMinor: "10000000",
    ...overrides,
  };
}

export function mkEntryCtx(overrides: Partial<EntryPolicyContext> = {}): EntryPolicyContext {
  return {
    policy: mkPolicy(),
    vehicleId: "veh-1",
    lotId: "LOT-A",
    operatorId: "op-1",
    nowISO: NOW_ISO,
    railsOffered: ["xrpl", "stripe"],
    assetsOffered: [ASSET_IOU_USDC, ASSET_ERC20_USDC],
    ...overrides,
  };
}

export function mkPaymentCtx(overrides: Partial<PaymentPolicyContext> = {}): PaymentPolicyContext {
  return {
    policy: mkPolicy(),
    vehicleId: "veh-1",
    lotId: "LOT-A",
    operatorId: "op-1",
    nowISO: NOW_ISO,
    sessionGrantId: "grant-1",
    priceFiat: { amountMinor: "1000", currency: "USD" },
    spendTotalsFiat: {
      dayTotal: { amountMinor: "0", currency: "USD" },
      sessionTotal: { amountMinor: "0", currency: "USD" },
    },
    railsOffered: ["xrpl", "stripe"],
    assetsOffered: [ASSET_IOU_USDC, ASSET_ERC20_USDC],
    ...overrides,
  };
}

export function mkDecision(overrides: Partial<PaymentPolicyDecision> = {}): PaymentPolicyDecision {
  return {
    action: "ALLOW",
    decisionId: "dec-1",
    policyHash: "ph-1",
    sessionGrantId: "grant-1",
    rail: "xrpl",
    asset: ASSET_IOU_USDC,
    reasons: ["OK"],
    expiresAtISO: "2099-01-01T00:00:00.000Z",
    maxSpend: { perTxMinor: "1000" },
    ...overrides,
  };
}

export function mkSettlement(
  overrides: Partial<SettlementResult> = {},
): SettlementResult {
  return {
    rail: "xrpl" as Rail,
    asset: ASSET_IOU_USDC,
    amount: "1000",
    txHash: "tx-1",
    destination: "rOperator",
    ...overrides,
  };
}
