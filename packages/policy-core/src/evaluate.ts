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
  EnforcementResult,
} from "./types.js";

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function isoPlusMinutes(minutes: number, from: Date): string {
  return new Date(from.getTime() + minutes * 60_000).toISOString();
}

function pickFirstAllowed<T>(offered: T[], allowlist: T[] | undefined): T | undefined {
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

  if (policy.vendorAllowlist && policy.vendorAllowlist.length > 0 && !policy.vendorAllowlist.includes(lotId)) {
    return denyEntry(ctx, ["VENDOR_NOT_ALLOWED"]);
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
  if (allowedAssets.length === 0) {
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
    grantId,
    policyHash,
    allowedRails,
    allowedAssets,
    maxSpend: {
      perTx: policy.capPerTx,
      perSession: policy.capPerSession,
      perDay: policy.capPerDay,
    },
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

/**
 * Evaluate policy at payment/exit (with quote and spend).
 * Returns allow with chosen rail/asset, deny, or require approval.
 */
export function evaluatePaymentPolicy(ctx: PaymentPolicyContext): PaymentPolicyDecision {
  const { policy, quote, spend } = ctx;

  if (policy.vendorAllowlist && policy.vendorAllowlist.length > 0 && !policy.vendorAllowlist.includes(ctx.lotId)) {
    return denyPayment(ctx, ["VENDOR_NOT_ALLOWED"]);
  }

  if (policy.capPerTx !== undefined && quote.amount > policy.capPerTx) {
    return denyPayment(ctx, ["CAP_EXCEEDED_TX"]);
  }

  if (
    policy.capPerSession !== undefined &&
    spend.sessionTotal + quote.amount > policy.capPerSession
  ) {
    return denyPayment(ctx, ["CAP_EXCEEDED_SESSION"]);
  }

  if (
    policy.capPerDay !== undefined &&
    spend.dayTotal + quote.amount > policy.capPerDay
  ) {
    return denyPayment(ctx, ["CAP_EXCEEDED_DAY"]);
  }

  if (
    policy.requireApprovalOver !== undefined &&
    quote.amount > policy.requireApprovalOver
  ) {
    return requireApprovalPayment(ctx, ["PRICE_SPIKE", "NEEDS_APPROVAL"]);
  }

  if ((ctx.riskScore ?? 0) >= 80) {
    return requireApprovalPayment(ctx, ["RISK_HIGH", "NEEDS_APPROVAL"]);
  }

  const rail = pickFirstAllowed<Rail>(ctx.railsOffered, policy.railAllowlist);
  if (!rail) return denyPayment(ctx, ["RAIL_NOT_ALLOWED"]);

  const asset = pickFirstAllowed<Asset>(ctx.assetsOffered, policy.assetAllowlist);
  if (!asset) return denyPayment(ctx, ["ASSET_NOT_ALLOWED"]);

  const decisionId = crypto.randomUUID();
  const policyHash = sha256(
    JSON.stringify({ policy, lotId: ctx.lotId, quote, rail, asset })
  );

  return {
    action: "ALLOW",
    rail,
    asset,
    reasons: ["OK"],
    maxSpend: {
      perTx: policy.capPerTx,
      perSession: policy.capPerSession,
      perDay: policy.capPerDay,
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

/** Parse amount string to number for comparison (assumes same currency/decimals). */
function parseAmount(amount: string): number {
  const n = parseFloat(amount);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Enforce that a settlement result complies with a prior payment policy decision.
 * Call after verifying the settlement (e.g. tx hash) elsewhere.
 */
export function enforcePayment(
  decision: PaymentPolicyDecision,
  settlement: SettlementResult
): EnforcementResult {
  if (decision.action !== "ALLOW") {
    return { allowed: false, reason: decision.reasons[0] ?? "NEEDS_APPROVAL" };
  }

  if (decision.rail !== settlement.rail) {
    return { allowed: false, reason: "RAIL_NOT_ALLOWED" };
  }

  if (!decision.asset || !assetEqual(decision.asset, settlement.asset)) {
    return { allowed: false, reason: "ASSET_NOT_ALLOWED" };
  }

  const amount = parseAmount(settlement.amount);
  if (decision.maxSpend?.perTx !== undefined && amount > decision.maxSpend.perTx) {
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
