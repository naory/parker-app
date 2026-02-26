/**
 * Single settlement enforcement path for all rails (EVM watcher, XRPL handler, future hosted).
 * Session must never close unless enforcement passes.
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
 * Used by: EVM payment watcher, XRPL settlement handler, any future rail.
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
