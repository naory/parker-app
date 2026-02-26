/**
 * Policy schema and boundaries for @parker/policy-core.
 * Pure types only — no DB, Express, or chain clients.
 */

/** Semantic version of the policy schema. */
export const POLICY_SCHEMA_VERSION = 1 as const;
export type PolicySchemaVersion = typeof POLICY_SCHEMA_VERSION;

/** Layer at which a policy applies; precedence: platform < owner < vehicle < lot. */
export type PolicyLayer = "platform" | "owner" | "vehicle" | "lot";

/** Deny / approval reason codes (auditable). */
export type PolicyReasonCode =
  | "OK"
  | "VENDOR_NOT_ALLOWED"
  | "GEO_NOT_ALLOWED"
  | "ASSET_NOT_ALLOWED"
  | "RAIL_NOT_ALLOWED"
  | "CAP_EXCEEDED_TX"
  | "CAP_EXCEEDED_SESSION"
  | "CAP_EXCEEDED_DAY"
  | "PRICE_SPIKE"
  | "RISK_HIGH"
  | "NEEDS_APPROVAL";

export type PolicyDecisionAction = "ALLOW" | "DENY" | "REQUIRE_APPROVAL";

export type Rail = "xrpl" | "evm" | "stripe" | "hosted";

export type Asset =
  | { kind: "XRP" }
  | { kind: "IOU"; currency: string; issuer: string }
  | { kind: "ERC20"; chainId: number; token: string };

/** Geo circle for allowlist. */
export interface GeoCircle {
  centerLat: number;
  centerLng: number;
  radiusMeters: number;
}

/**
 * Versioned policy document (single layer).
 * Used as platform defaults or as overrides at owner / vehicle / lot.
 */
export interface Policy {
  version: PolicySchemaVersion;
  /** Lot/operator allowlist (empty or absent = no restriction). */
  vendorAllowlist?: string[];
  /** Geo allowlist (vehicle must be within one circle). */
  geoAllowlist?: GeoCircle[];
  /** Allowed payment rails. */
  railAllowlist?: Rail[];
  /** Allowed assets (XRP, IOU, ERC20). */
  assetAllowlist?: Asset[];
  /** Cap per single transaction (in quote currency minor units or normalized). */
  capPerTx?: number;
  /** Cap per session. */
  capPerSession?: number;
  /** Cap per day (rolling). */
  capPerDay?: number;
  /** If quote exceeds this, require explicit approval. */
  requireApprovalOver?: number;
}

/**
 * Layered policy stack for resolution.
 * Lower index = lower precedence (platform first, then owner, vehicle, lot).
 */
export interface PolicyStack {
  platform: Policy;
  owner?: Policy;
  vehicle?: Policy;
  lot?: Policy;
}

/** Context for entry policy evaluation (no quote/spend yet). */
export interface EntryPolicyContext {
  /** Effective policy (after merging stack). */
  policy: Policy;
  vehicleId?: string;
  lotId: string;
  operatorId?: string;
  nowISO: string;
  /** Rails the lot can accept. */
  railsOffered: Rail[];
  /** Assets the lot can accept. */
  assetsOffered: Asset[];
  /** Optional: vehicle position for geo checks. */
  geo?: { lat: number; lng: number };
  /** Optional risk score 0..100. */
  riskScore?: number;
}

/**
 * Output of entry policy evaluation.
 * Grants what is allowed for the session (rails, assets, caps) without a specific payment.
 */
export interface SessionPolicyGrant {
  /** Unique grant id (e.g. uuid). */
  grantId: string;
  /** Hash of effective policy + key context (audit). */
  policyHash: string;
  /** Allowed rails for this session. */
  allowedRails: Rail[];
  /** Allowed assets for this session. */
  allowedAssets: Asset[];
  /** Caps that will apply at payment time (if set). */
  maxSpend?: { perTx?: number; perSession?: number; perDay?: number };
  /** Grant validity expiry. */
  expiresAtISO: string;
  vehicleId?: string;
  lotId: string;
  operatorId?: string;
  /** Reasons (e.g. OK or REQUIRE_APPROVAL if risk). */
  reasons: PolicyReasonCode[];
  /** If true, payment will require explicit approval. */
  requireApproval?: boolean;
}

/** Context for payment/exit policy evaluation (includes quote and spend). */
export interface PaymentPolicyContext {
  policy: Policy;
  vehicleId?: string;
  lotId: string;
  operatorId?: string;
  nowISO: string;
  quote: { amount: number; currency: string };
  spend: { dayTotal: number; sessionTotal: number };
  railsOffered: Rail[];
  assetsOffered: Asset[];
  riskScore?: number;
  /** Optional: session grant id from entry (for audit chain). */
  sessionGrantId?: string;
}

/**
 * Output of payment/exit policy evaluation.
 * Decision: allow with chosen rail/asset, deny, or require approval.
 */
export interface PaymentPolicyDecision {
  action: PolicyDecisionAction;
  rail?: Rail;
  asset?: Asset;
  reasons: PolicyReasonCode[];
  maxSpend?: { perTx?: number; perSession?: number; perDay?: number };
  expiresAtISO: string;
  decisionId: string;
  policyHash: string;
}

/**
 * Minimal settlement result for enforcement (no chain client dependency).
 * Filled by the caller from chain/adapter output.
 */
export interface SettlementResult {
  amount: string;
  asset: Asset;
  rail: Rail;
  txHash?: string;
  payer?: string;
}

/**
 * Result of enforcePayment(decision, settlementResult).
 * Either allowed or denied with a reason.
 */
export type EnforcementResult =
  | { allowed: true }
  | { allowed: false; reason: PolicyReasonCode };

// Legacy aliases for backward compatibility
export type PolicyContext = PaymentPolicyContext;
export type PolicyDecision = PaymentPolicyDecision;
