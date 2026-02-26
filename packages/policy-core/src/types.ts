/**
 * Policy schema and boundaries for @parker/policy-core.
 * Pure types only — no DB, Express, or chain clients.
 */

import type { Rail, Asset } from "@parker/settlement-core";

export type { Rail, Asset };

/** ISO 4217 currency code (e.g. "USD", "EUR"). */
export type ISO4217 = string;

/** Semantic version of the policy schema. */
export const POLICY_SCHEMA_VERSION = 1 as const;
export type PolicySchemaVersion = typeof POLICY_SCHEMA_VERSION;

/** Layer at which a policy applies; precedence: platform < owner < vehicle < lot. */
export type PolicyLayer = "platform" | "owner" | "vehicle" | "lot";

/** Deny / approval reason codes (auditable). */
export type PolicyReasonCode =
  | "OK"
  | "LOT_NOT_ALLOWED"
  | "VENDOR_NOT_ALLOWED"
  | "GEO_NOT_ALLOWED"
  | "ASSET_NOT_ALLOWED"
  | "RAIL_NOT_ALLOWED"
  | "CAP_EXCEEDED_TX"
  | "CAP_EXCEEDED_SESSION"
  | "CAP_EXCEEDED_DAY"
  | "PRICE_SPIKE"
  | "RISK_HIGH"
  | "NEEDS_APPROVAL"
  | "GRANT_EXPIRED";

export type PolicyDecisionAction = "ALLOW" | "DENY" | "REQUIRE_APPROVAL";

/** Geo circle for allowlist. */
export interface GeoCircle {
  centerLat: number;
  centerLng: number;
  radiusMeters: number;
}

// ---- Canonical money primitives ----

/**
 * Fiat amount in minor units (e.g. USD cents). String for JSON/bigint safety.
 * All caps and spend totals use this; currency is explicit.
 */
export interface FiatMoneyMinor {
  amountMinor: string;
  currency: ISO4217;
}

/**
 * On-chain amount in smallest unit (atomic). String for JSON/bigint safety.
 * decimals: token decimals (e.g. 6 for USDC). amount = raw units (e.g. 1_000_000 = 1 USDC).
 */
export interface AtomicAmount {
  amount: string;
  decimals: number;
}

/**
 * FX rate snapshot used to convert fiat → stablecoin for a settlement quote.
 */
export interface FxSnapshot {
  baseCurrency: ISO4217;
  quoteAssetSymbol: string;
  rate: string;
  asOf: string;
  provider?: string;
}

/**
 * Settlement quote: one payable option (rail + asset + atomic amount + destination).
 * Stripe quotes have no asset; xrpl/evm have asset. Enforcement matches by quoteId or rail+asset.
 */
export interface SettlementQuote {
  quoteId: string;
  rail: Rail;
  asset?: Asset;
  amount: AtomicAmount;
  destination: string;
  expiresAt: string;
  fx?: FxSnapshot;
}

/**
 * Amount in minor units (integer). Use string for JSON safety.
 * E.g. USD cents, or 10^6 for USDC. All comparisons use BigInt(amountMinor).
 * @deprecated Prefer FiatMoneyMinor for fiat; AtomicAmount for on-chain.
 */
export interface MoneyMinor {
  amountMinor: string;
  currency: string;
}

/**
 * Versioned policy document (single layer).
 * Caps are in fiat minor units (lot currency); no amount at entry.
 */
export interface Policy {
  version: PolicySchemaVersion;
  lotAllowlist?: string[];
  geoAllowlist?: GeoCircle[];
  railAllowlist?: Rail[];
  assetAllowlist?: Asset[];
  /** Cap per single transaction (fiat minor, string). */
  capPerTxMinor?: string;
  /** Cap per session (fiat minor, string). */
  capPerSessionMinor?: string;
  /** Cap per day rolling (fiat minor, string). */
  capPerDayMinor?: string;
  /** If price fiat minor exceeds this, require explicit approval. */
  requireApprovalOverMinor?: string;
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
 * No amount at entry; caps are fiat minor only (currency from lot at exit).
 */
export interface SessionPolicyGrant {
  grantId: string;
  policyHash: string;
  allowedRails: Rail[];
  allowedAssets: Asset[];
  /** Fiat caps (currency from lot). Used at exit for cap checks. */
  capsFiatMinor?: {
    perTx?: FiatMoneyMinor;
    perSession?: FiatMoneyMinor;
    perDay?: FiatMoneyMinor;
  };
  /** @deprecated Use capsFiatMinor; kept for backward compat. */
  maxSpend?: { perTxMinor?: string; perSessionMinor?: string; perDayMinor?: string };
  expiresAtISO: string;
  vehicleId?: string;
  lotId: string;
  operatorId?: string;
  reasons: PolicyReasonCode[];
  requireApproval?: boolean;
}

/** Context for payment/exit policy evaluation. Caps and spend are fiat minor (lot currency). */
export interface PaymentPolicyContext {
  policy: Policy;
  vehicleId?: string;
  lotId: string;
  operatorId?: string;
  nowISO: string;
  /** Price in fiat minor (lot currency). Prefer over quote. */
  priceFiat?: FiatMoneyMinor;
  /** Cumulative spend in fiat minor (same currency). Prefer over spend. */
  spendTotalsFiat?: { dayTotal: FiatMoneyMinor; sessionTotal: FiatMoneyMinor };
  railsOffered: Rail[];
  assetsOffered: Asset[];
  riskScore?: number;
  sessionGrantId?: string;
  /** @deprecated Use priceFiat. */
  quote?: MoneyMinor;
  /** @deprecated Use spendTotalsFiat. */
  spend?: { dayTotalMinor: string; sessionTotalMinor: string };
}

/**
 * Output of payment/exit policy evaluation.
 * Persisted with priceFiat + settlementQuotes so enforcement can match atomic amount + destination.
 */
export interface PaymentPolicyDecision {
  action: PolicyDecisionAction;
  rail?: Rail;
  asset?: Asset;
  reasons: PolicyReasonCode[];
  expiresAtISO: string;
  decisionId: string;
  policyHash: string;
  sessionGrantId?: string | null;
  /** Grant id this decision is scoped to (for enforcement grant match). */
  grantId?: string | null;
  /** Price in fiat minor (lot currency). */
  priceFiat?: FiatMoneyMinor;
  /** Settlement quotes generated after decision (Stripe + x402). */
  settlementQuotes?: SettlementQuote[];
  /** Selected rail + quoteId when one option is chosen. */
  chosen?: { rail: Rail; quoteId: string };
  createdAt?: string;
  /** Caps in minor units (fiat). Used by enforcement for cap check when no quote. */
  maxSpend?: { perTxMinor?: string; perSessionMinor?: string; perDayMinor?: string };
}

/**
 * Settlement result for enforcement: atomic amount + rail + asset + destination.
 * Caller fills from chain/adapter. Enforcement matches against decision's settlement quote.
 */
export interface SettlementResult {
  /** Atomic amount (smallest unit, string). Must match quote.amount.amount. */
  amount: string;
  asset: Asset;
  rail: Rail;
  txHash?: string;
  payer?: string;
  /** Destination (operator wallet); must match quote.destination. */
  destination?: string;
  /** Quote id being settled (if available). */
  quoteId?: string;
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
