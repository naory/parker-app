/**
 * Pure policy evaluation: entry, payment, and enforcement.
 * No DB, Express, or chain clients.
 */

import crypto from "node:crypto";
import type {
  EntryPolicyContext,
  SessionPolicyGrant,
  PaymentPolicyContext,
  PaymentPolicyDecision,
  PolicyReasonCode,
  Rail,
  Asset,
  SettlementResult,
  SettlementQuote,
  EnforcementResult,
} from "./types.js";

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function isoPlusMinutes(minutes: number, from: Date): string {
  return new Date(from.getTime() + minutes * 60_000).toISOString();
}

function pickFirstAllowed<T>(offered: T[], allowlist?: T[]): T | undefined {
  if (!allowlist || allowlist.length === 0) return offered[0];
  return offered.find((x) => allowlist.includes(x));
}

function geoInCircle(
  point: { lat: number; lng: number },
  circle: { centerLat: number; centerLng: number; radiusMeters: number }
): boolean {
  const R = 6_371_000; // Earth radius in meters
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(circle.centerLat - point.lat);
  const dLng = toRad(circle.centerLng - point.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(point.lat)) *
      Math.cos(toRad(circle.centerLat)) *
      Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c <= circle.radiusMeters;
}

/**
 * Evaluate policy at entry (no quote/spend).
 * Returns a session grant with allowed rails, assets, and caps for the session.
 */
export function evaluateEntryPolicy(ctx: EntryPolicyContext): SessionPolicyGrant {
  const { policy, nowISO, lotId, railsOffered, assetsOffered } = ctx;
  const reasons: PolicyReasonCode[] = [];
  let requireApproval = false;

  const operatorAllowlist = policy.operatorAllowlist ?? policy.vendorAllowlist;
  if (operatorAllowlist && operatorAllowlist.length > 0) {
    if (!ctx.operatorId || !operatorAllowlist.includes(ctx.operatorId)) {
      return denyEntry(ctx, ["VENDOR_NOT_ALLOWED"]);
    }
  }

  if (policy.lotAllowlist && policy.lotAllowlist.length > 0 && !policy.lotAllowlist.includes(lotId)) {
    return denyEntry(ctx, ["LOT_NOT_ALLOWED"]);
  }

  if (policy.geoAllowlist && policy.geoAllowlist.length > 0) {
    if (!ctx.geo) {
      return denyEntry(ctx, ["GEO_NOT_ALLOWED"]);
    }
    const inAny = policy.geoAllowlist.some((c) => geoInCircle(ctx.geo!, c));
    if (!inAny) {
      return denyEntry(ctx, ["GEO_NOT_ALLOWED"]);
    }
  }

  if ((ctx.riskScore ?? 0) >= 80) {
    requireApproval = true;
    reasons.push("RISK_HIGH", "NEEDS_APPROVAL");
  }

  const allowedRails =
    policy.railAllowlist && policy.railAllowlist.length > 0
      ? railsOffered.filter((r) => policy.railAllowlist!.includes(r))
      : [...railsOffered];
  const allowedAssets =
    policy.assetAllowlist && policy.assetAllowlist.length > 0
      ? assetsOffered.filter((a) => {
          const key = (x: Asset) =>
            x.kind === "XRP"
              ? "XRP"
              : x.kind === "IOU"
                ? `IOU:${x.currency}:${x.issuer}`
                : `ERC20:${x.chainId}:${x.token}`;
          return policy.assetAllowlist!.some((p) => key(p) === key(a));
        })
      : [...assetsOffered];

  if (allowedRails.length === 0) {
    return denyEntry(ctx, ["RAIL_NOT_ALLOWED"]);
  }
  const hasCryptoRail = allowedRails.some((r) => r === "xrpl" || r === "evm");
  if (hasCryptoRail && allowedAssets.length === 0) {
    return denyEntry(ctx, ["ASSET_NOT_ALLOWED"]);
  }

  if (reasons.length === 0) reasons.push("OK");

  const grantId = crypto.randomUUID();
  const policyHash = sha256(
    JSON.stringify({
      policy,
      lotId,
      vehicleId: ctx.vehicleId,
      allowedRails,
      allowedAssets,
      requireApproval,
    })
  );

  return {
    grantAction: requireApproval ? "REQUIRE_APPROVAL" : "ALLOW",
    grantId,
    policyHash,
    allowedRails,
    allowedAssets,
    maxSpend: policy.capPerTxMinor !== undefined || policy.capPerSessionMinor !== undefined || policy.capPerDayMinor !== undefined
      ? {
          perTxMinor: policy.capPerTxMinor,
          perSessionMinor: policy.capPerSessionMinor,
          perDayMinor: policy.capPerDayMinor,
        }
      : undefined,
    expiresAtISO: isoPlusMinutes(60, new Date(nowISO)),
    vehicleId: ctx.vehicleId,
    lotId,
    operatorId: ctx.operatorId,
    reasons,
    requireApproval,
  };
}

function denyEntry(ctx: EntryPolicyContext, reasons: PolicyReasonCode[]): SessionPolicyGrant {
  const grantId = crypto.randomUUID();
  const policyHash = sha256(JSON.stringify({ policy: ctx.policy, lotId: ctx.lotId, denied: reasons }));
  return {
    grantAction: "DENY",
    grantId,
    policyHash,
    allowedRails: [],
    allowedAssets: [],
    expiresAtISO: isoPlusMinutes(5, new Date(ctx.nowISO)),
    lotId: ctx.lotId,
    vehicleId: ctx.vehicleId,
    operatorId: ctx.operatorId,
    reasons,
  };
}

/** Derive price fiat minor from context (priceFiat or legacy quote). */
function getPriceFiatMinor(ctx: PaymentPolicyContext): string {
  if (ctx.priceFiat?.amountMinor != null) return ctx.priceFiat.amountMinor;
  if (ctx.quote?.amountMinor != null) return ctx.quote.amountMinor;
  return "0";
}

/** Derive spend totals from context (spendTotalsFiat or legacy spend). */
function getSpendTotals(ctx: PaymentPolicyContext): { dayTotal: string; sessionTotal: string } {
  if (ctx.spendTotalsFiat) {
    return {
      dayTotal: ctx.spendTotalsFiat.dayTotal?.amountMinor ?? "0",
      sessionTotal: ctx.spendTotalsFiat.sessionTotal?.amountMinor ?? "0",
    };
  }
  if (ctx.spend) {
    return {
      dayTotal: ctx.spend.dayTotalMinor ?? "0",
      sessionTotal: ctx.spend.sessionTotalMinor ?? "0",
    };
  }
  return { dayTotal: "0", sessionTotal: "0" };
}

/**
 * Evaluate policy at payment/exit (with price and spend in fiat minor).
 * Caps are compared in fiat only; rails/assets chosen for settlement quotes later.
 */
export function evaluatePaymentPolicy(ctx: PaymentPolicyContext): PaymentPolicyDecision {
  const { policy } = ctx;

  const operatorAllowlist = policy.operatorAllowlist ?? policy.vendorAllowlist;
  if (operatorAllowlist && operatorAllowlist.length > 0) {
    if (!ctx.operatorId || !operatorAllowlist.includes(ctx.operatorId)) {
      return denyPayment(ctx, ["VENDOR_NOT_ALLOWED"]);
    }
  }

  if (policy.lotAllowlist && policy.lotAllowlist.length > 0 && !policy.lotAllowlist.includes(ctx.lotId)) {
    return denyPayment(ctx, ["LOT_NOT_ALLOWED"]);
  }

  const priceMinor = BigInt(getPriceFiatMinor(ctx));
  const { dayTotal, sessionTotal } = getSpendTotals(ctx);

  if (policy.capPerTxMinor !== undefined && priceMinor > BigInt(policy.capPerTxMinor)) {
    return denyPayment(ctx, ["CAP_EXCEEDED_TX"]);
  }

  if (
    policy.capPerSessionMinor !== undefined &&
    BigInt(sessionTotal) + priceMinor > BigInt(policy.capPerSessionMinor)
  ) {
    return denyPayment(ctx, ["CAP_EXCEEDED_SESSION"]);
  }

  if (
    policy.capPerDayMinor !== undefined &&
    BigInt(dayTotal) + priceMinor > BigInt(policy.capPerDayMinor)
  ) {
    return denyPayment(ctx, ["CAP_EXCEEDED_DAY"]);
  }

  if (
    policy.requireApprovalOverMinor !== undefined &&
    priceMinor > BigInt(policy.requireApprovalOverMinor)
  ) {
    return requireApprovalPayment(ctx, ["PRICE_SPIKE", "NEEDS_APPROVAL"]);
  }

  if ((ctx.riskScore ?? 0) >= 80) {
    return requireApprovalPayment(ctx, ["RISK_HIGH", "NEEDS_APPROVAL"]);
  }

  const rail = pickFirstAllowed<Rail>(ctx.railsOffered, policy.railAllowlist);
  if (!rail) return denyPayment(ctx, ["RAIL_NOT_ALLOWED"]);

  let asset: Asset | undefined;
  if (rail === "stripe" || rail === "hosted") {
    asset = undefined;
  } else {
    asset = pickFirstAllowed<Asset>(ctx.assetsOffered, policy.assetAllowlist);
    if (!asset) return denyPayment(ctx, ["ASSET_NOT_ALLOWED"]);
  }

  const decisionId = crypto.randomUUID();
  const policyHash = sha256(
    JSON.stringify({ policy, lotId: ctx.lotId, priceFiat: ctx.priceFiat ?? ctx.quote, rail, asset })
  );

  return {
    action: "ALLOW",
    rail,
    asset,
    reasons: ["OK"],
    maxSpend: {
      perTxMinor: policy.capPerTxMinor,
      perSessionMinor: policy.capPerSessionMinor,
      perDayMinor: policy.capPerDayMinor,
    },
    expiresAtISO: isoPlusMinutes(5, new Date(ctx.nowISO)),
    decisionId,
    policyHash,
  };
}

function denyPayment(
  ctx: PaymentPolicyContext,
  reasons: PolicyReasonCode[]
): PaymentPolicyDecision {
  const decisionId = crypto.randomUUID();
  const policyHash = sha256(
    JSON.stringify({ policy: ctx.policy, lotId: ctx.lotId, quote: ctx.quote })
  );
  return {
    action: "DENY",
    reasons,
    expiresAtISO: isoPlusMinutes(5, new Date(ctx.nowISO)),
    decisionId,
    policyHash,
  };
}

function requireApprovalPayment(
  ctx: PaymentPolicyContext,
  reasons: PolicyReasonCode[]
): PaymentPolicyDecision {
  const decisionId = crypto.randomUUID();
  const policyHash = sha256(
    JSON.stringify({ policy: ctx.policy, lotId: ctx.lotId, quote: ctx.quote })
  );
  return {
    action: "REQUIRE_APPROVAL",
    reasons,
    expiresAtISO: isoPlusMinutes(5, new Date(ctx.nowISO)),
    decisionId,
    policyHash,
  };
}

/** Compare two assets for equality. */
function assetEqual(a: Asset, b: Asset): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "XRP") return true;
  if (a.kind === "IOU" && b.kind === "IOU") {
    return a.currency === b.currency && a.issuer === b.issuer;
  }
  if (a.kind === "ERC20" && b.kind === "ERC20") {
    return a.chainId === b.chainId && a.token === b.token;
  }
  return false;
}

/**
 * Find the settlement quote that matches this settlement (by rail + quoteId or rail + asset).
 */
function findMatchingQuote(
  decision: PaymentPolicyDecision,
  settlement: SettlementResult
): SettlementQuote | undefined {
  const quotes = decision.settlementQuotes;
  if (!quotes?.length) return undefined;
  if (settlement.quoteId) {
    const byId = quotes.find((q) => q.quoteId === settlement.quoteId);
    if (byId && byId.rail === settlement.rail) return byId;
  }
  return quotes.find(
    (q) =>
      q.rail === settlement.rail &&
      (decision.rail === "stripe" || decision.rail === "hosted" || (q.asset && assetEqual(q.asset, settlement.asset)))
  );
}

/**
 * Enforce that a settlement result complies with a prior payment policy decision.
 * When decision has settlementQuotes: match by rail + quoteId or rail+asset, enforce atomic amount + destination.
 * Otherwise (legacy): enforce rail, asset, and amount vs maxSpend.perTxMinor.
 */
export function enforcePayment(
  decision: PaymentPolicyDecision,
  settlement: SettlementResult
): EnforcementResult {
  if (decision.action !== "ALLOW") {
    return { allowed: false, reason: decision.reasons[0] ?? "NEEDS_APPROVAL" };
  }

  if (Date.parse(decision.expiresAtISO) <= Date.now()) {
    return { allowed: false, reason: "NEEDS_APPROVAL" };
  }

  if (
    settlement.expectedSessionGrantId != null &&
    settlement.expectedSessionGrantId.length > 0 &&
    decision.sessionGrantId !== settlement.expectedSessionGrantId
  ) {
    return { allowed: false, reason: "NEEDS_APPROVAL" };
  }

  if (
    settlement.expectedPolicyHash != null &&
    settlement.expectedPolicyHash.length > 0 &&
    decision.policyHash !== settlement.expectedPolicyHash
  ) {
    return { allowed: false, reason: "NEEDS_APPROVAL" };
  }

  if (decision.rail !== settlement.rail) {
    return { allowed: false, reason: "RAIL_NOT_ALLOWED" };
  }

  const quote = findMatchingQuote(decision, settlement);

  if (quote) {
    const amountOk = BigInt(settlement.amount) === BigInt(quote.amount.amount);
    if (!amountOk) return { allowed: false, reason: "CAP_EXCEEDED_TX" };
    if (quote.destination && settlement.destination && settlement.destination !== quote.destination) {
      return { allowed: false, reason: "RAIL_NOT_ALLOWED" };
    }
    if (decision.rail !== "stripe" && decision.rail !== "hosted") {
      if (!quote.asset || !assetEqual(quote.asset, settlement.asset)) {
        return { allowed: false, reason: "ASSET_NOT_ALLOWED" };
      }
    }
    return { allowed: true };
  }

  // Legacy path: no settlementQuotes
  if (decision.rail !== "stripe" && decision.rail !== "hosted") {
    if (!decision.asset || !assetEqual(decision.asset, settlement.asset)) {
      return { allowed: false, reason: "ASSET_NOT_ALLOWED" };
    }
  }

  const amountMinor = BigInt(settlement.amount);
  const capTx = decision.maxSpend?.perTxMinor;
  if (capTx !== undefined && amountMinor > BigInt(capTx)) {
    return { allowed: false, reason: "CAP_EXCEEDED_TX" };
  }

  return { allowed: true };
}

// Legacy export alias
export function evaluatePolicy(
  ctx: PaymentPolicyContext
): PaymentPolicyDecision {
  return evaluatePaymentPolicy(ctx);
}
