/**
 * Single settlement enforcement path for all rails.
 * Session must never close unless enforcement passes.
 *
 * Call sites (all must use this before close and persist events; on !allowed they return without closing):
 * - EVM: paymentWatcher.ts — enforceOrReject → if !allowed return; else settlementVerified → settleSession
 * - XRPL: gate.ts — enforceOrReject → if !allowed return reply(403); else settlementVerified → endSession
 * - Stripe: webhooks.ts — enforceOrReject → if !allowed return res.json; else settlementVerified → endSession
 *
 * Enforcement invariants (enforced by policy-core enforcePayment; replay by each handler):
 * - rail match: settlement rail must equal decision chosen rail
 * - asset match: on-chain rails must match decision chosen asset (chainId/token or XRP/IOU)
 * - destination match: payment must go to operator wallet from decision/quote
 * - amount match: exact when quote present; otherwise ≥ allowed per cap
 * - Decision is the source of truth: getDecisionPayloadByDecisionId reads policy_decisions.payload first
 */

import { enforcePayment } from '@parker/policy-core'
import type {
  PaymentPolicyDecision,
  SettlementResult,
  EnforcementResult,
  PolicyReasonCode,
} from '@parker/policy-core'

export type GetDecisionPayload = (decisionId: string) => Promise<unknown | null>

/**
 * Enforce that a settlement matches the policy decision, or reject.
 * Uses policy_decisions.payload (or policy_events fallback) as decision source of truth.
 * Replay protection (txHash/paymentId uniqueness) is enforced by each settlement handler before calling this.
 * If decisionId is missing or decision not found, returns rejected (session must not close).
 */
export async function enforceOrReject(
  getDecisionPayload: GetDecisionPayload,
  decisionId: string | undefined,
  settlement: SettlementResult,
): Promise<EnforcementResult> {
  if (!decisionId || decisionId.trim().length === 0) {
    return { allowed: false, reason: 'NEEDS_APPROVAL' as PolicyReasonCode }
  }
  const payload = await getDecisionPayload(decisionId)
  if (!payload || typeof payload !== 'object') {
    return { allowed: false, reason: 'NEEDS_APPROVAL' as PolicyReasonCode }
  }
  const decision = payload as PaymentPolicyDecision
  return enforcePayment(decision, settlement)
}
