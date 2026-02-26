/**
 * Single settlement enforcement path for all rails.
 * Session must never close unless enforcement passes.
 *
 * Call sites (all must use this before close and persist events):
 * - EVM: apps/api/src/services/paymentWatcher.ts — enforceOrReject → settlementVerified/enforcementFailed → settleSession
 * - XRPL: apps/api/src/routes/gate.ts — enforceOrReject → settlementVerified/enforcementFailed → resolve + endSession
 * - Stripe: apps/api/src/routes/webhooks.ts — enforceOrReject → settlementVerified/enforcementFailed → endSession
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
 * Checks: rail match, asset match (on-chain), destination match (when quote present), amount match (exact/quote or cap).
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
