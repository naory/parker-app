/**
 * Single settlement enforcement path for all rails.
 * Session must never close unless enforcement passes.
 *
 * Call sites (all must use this before close and persist events; on !allowed they return without closing):
 * - EVM: paymentWatcher.ts — enforceOrReject → if !allowed return; else settlementVerified → settleSession
 * - XRPL: gate.ts — enforceOrReject → if !allowed return reply(403); else settlementVerified → settleSessionAfterVerified
 * - Stripe: webhooks.ts — enforceOrReject → if !allowed return res.json; else settlementVerified → settleSessionAfterVerified
 *
 * Enforcement invariants (enforced by policy-core enforcePayment; replay by each handler):
 * - Settlement enforcement must reference decisionId (lookup) and payload contains sessionGrantId + policyHash.
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
} from '@parker/policy-core'
import {
  verifySignedPaymentAuthorizationForSettlement,
  type SignedPaymentAuthorization,
  type SpaVerifier,
} from '../paymentAuthorization'

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
  spaVerifier: SpaVerifier | null,
): Promise<EnforcementResult> {
  if (!decisionId || decisionId.trim().length === 0) {
    return { allowed: false, reason: 'DECISION_NOT_FOUND' }
  }
  const payload = await getDecisionPayload(decisionId)
  if (!payload || typeof payload !== 'object') {
    return { allowed: false, reason: 'DECISION_NOT_FOUND' }
  }
  const decision = payload as PaymentPolicyDecision & { paymentAuthorization?: SignedPaymentAuthorization }
  if (decision.paymentAuthorization) {
    if (!spaVerifier) {
      return { allowed: false, reason: 'PAYMENT_AUTH_INVALID_SIGNATURE' }
    }
    const authorizationCheck = verifySignedPaymentAuthorizationForSettlement(
      decision.paymentAuthorization,
      decisionId,
      settlement,
      spaVerifier,
    )
    if (!authorizationCheck.ok) {
      return {
        allowed: false,
        reason:
          authorizationCheck.reason === 'invalid_signature'
            ? 'PAYMENT_AUTH_INVALID_SIGNATURE'
            : authorizationCheck.reason === 'expired'
              ? 'PAYMENT_AUTH_EXPIRED'
              : 'PAYMENT_AUTH_MISMATCH',
      }
    }
  }
  return enforcePayment(decision, settlement)
}
