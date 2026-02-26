/**
 * Exit-time policy evaluation: build context (fiat-only caps), evaluate payment policy, apply grant expiry.
 * Caps and spend are in fiat minor (lot currency); settlement quotes are generated after decision in gate.
 */

import { resolveEffectivePolicy, evaluatePaymentPolicy } from '@parker/policy-core'
import type {
  PaymentPolicyContext,
  PaymentPolicyDecision,
  PolicyReasonCode,
  Rail,
  FiatMoneyMinor,
} from '@parker/policy-core'
import { buildEntryPolicyStack } from '../policyStack'
import { buildAssetsOffered } from './assetsOffered'
import { validateDecisionAgainstGrant } from './grantEnforcement'
import { X402_NETWORK } from '../pricing'
import type { PolicyGrantRecord } from '../../db/queries'

/** Fiat minor units: assume 2 decimals (cents) for standard currencies. */
const FIAT_MINOR_DECIMALS = 2

function toFiatMinor(amount: number): string {
  return String(Math.round(amount * 10 ** FIAT_MINOR_DECIMALS))
}

export interface EvaluateExitPolicyParams {
  session: { id: string; policyGrantId?: string | null; approvalRequiredBeforePayment?: boolean } | null
  lot: { paymentMethods?: string[]; currency?: string; operatorWallet?: string } | null
  fee: number
  currency: string
  plate: string
  lotId: string
  getFiatSpendTotalsByCurrency: (plate: string, currency: string) => Promise<{ dayTotalFiat: number; sessionTotalFiat: number }>
  getPolicyGrantExpiresAt: (grantId: string) => Promise<Date | null>
  getPolicyGrantByGrantId: (grantId: string) => Promise<PolicyGrantRecord | null>
}

/**
 * Evaluate payment policy at exit: context uses priceFiat + spendTotalsFiat (fiat minor);
 * caps are compared in fiat only.
 */
export async function evaluateExitPolicy(params: EvaluateExitPolicyParams): Promise<PaymentPolicyDecision> {
  const {
    session,
    lot,
    fee,
    currency,
    plate,
    lotId,
    getFiatSpendTotalsByCurrency,
    getPolicyGrantExpiresAt,
    getPolicyGrantByGrantId,
  } = params

  const spendFiat = await getFiatSpendTotalsByCurrency(plate, currency)
  const priceFiat: FiatMoneyMinor = {
    amountMinor: toFiatMinor(fee),
    currency,
  }
  const spendTotalsFiat = {
    dayTotal: { amountMinor: toFiatMinor(spendFiat.dayTotalFiat), currency },
    sessionTotal: { amountMinor: toFiatMinor(spendFiat.sessionTotalFiat), currency },
  }

  let sessionGrantId: string | undefined
  if (session?.policyGrantId) {
    const expiresAt = await getPolicyGrantExpiresAt(session.policyGrantId)
    if (expiresAt && expiresAt > new Date()) sessionGrantId = session.policyGrantId
  }

  const stack = buildEntryPolicyStack(lotId, plate)
  const policy = resolveEffectivePolicy(stack)
  const railsOffered: Rail[] = []
  if (lot?.paymentMethods?.includes('stripe')) railsOffered.push('stripe')
  if (lot?.paymentMethods?.includes('x402')) {
    railsOffered.push(X402_NETWORK.startsWith('xrpl:') ? 'xrpl' : 'evm')
  }
  if (railsOffered.length === 0) railsOffered.push('stripe', 'xrpl', 'evm')
  const assetsOffered = buildAssetsOffered(railsOffered)

  const paymentCtx: PaymentPolicyContext = {
    policy,
    lotId,
    operatorId: lot?.operatorWallet,
    nowISO: new Date().toISOString(),
    priceFiat,
    spendTotalsFiat,
    railsOffered,
    assetsOffered,
    sessionGrantId,
  }
  let decision = evaluatePaymentPolicy(paymentCtx)

  const hadGrantButExpired = Boolean(session?.policyGrantId) && sessionGrantId === undefined
  if (hadGrantButExpired) {
    decision = {
      ...decision,
      action: 'REQUIRE_APPROVAL',
      reasons: [...(decision.reasons || []), 'GRANT_EXPIRED' as PolicyReasonCode],
    }
  }

  // Invariant: if session has policyGrantId, decision MUST include sessionGrantId (no forgetting the grant).
  let finalDecision: PaymentPolicyDecision = {
    ...decision,
    sessionGrantId: session?.policyGrantId ?? sessionGrantId ?? null,
    grantId: sessionGrantId ?? session?.policyGrantId ?? null,
    priceFiat,
  }

  // Entry tagged approvalRequiredBeforePayment => exit must require approval before settlement.
  if (session?.approvalRequiredBeforePayment && finalDecision.action === 'ALLOW') {
    finalDecision = {
      ...finalDecision,
      action: 'REQUIRE_APPROVAL',
      reasons: [...(finalDecision.reasons || []), 'NEEDS_APPROVAL' as PolicyReasonCode],
    }
  }

  if (sessionGrantId) {
    const grant = await getPolicyGrantByGrantId(sessionGrantId)
    if (grant) {
      const check = validateDecisionAgainstGrant(grant, finalDecision)
      if (!check.valid) {
        finalDecision = {
          action: 'DENY',
          reasons: [check.reason],
          expiresAtISO: finalDecision.expiresAtISO,
          decisionId: finalDecision.decisionId,
          policyHash: finalDecision.policyHash,
          sessionGrantId: sessionGrantId ?? null,
        }
      }
    }
  }

  return finalDecision
}
