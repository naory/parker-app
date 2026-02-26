/**
 * Exit-time policy evaluation: build context, evaluate payment policy, apply grant expiry, set sessionGrantId.
 * Keeps packages/policy-core pure (no DB, no env); this layer does DB and env.
 */

import { resolveEffectivePolicy, evaluatePaymentPolicy } from '@parker/policy-core'
import type {
  PaymentPolicyContext,
  PaymentPolicyDecision,
  PolicyReasonCode,
  Rail,
} from '@parker/policy-core'
import { buildEntryPolicyStack } from '../policyStack'
import { buildAssetsOffered } from './assetsOffered'
import { convertToStablecoin, X402_NETWORK } from '../pricing'

const STABLECOIN_DECIMALS = 6

export interface EvaluateExitPolicyParams {
  session: { id: string; policyGrantId?: string | null } | null
  lot: { paymentMethods?: string[]; currency?: string; operatorWallet?: string } | null
  fee: number
  currency: string
  plate: string
  lotId: string
  getSpendTotalsFiat: (plate: string, currency: string) => Promise<{ dayTotalFiat: number; sessionTotalFiat: number }>
  getPolicyGrantExpiresAt: (grantId: string) => Promise<Date | null>
}

/**
 * Evaluate payment policy at exit: build context (stablecoin minor, spend totals, rails/assets),
 * run policy-core, enforce grant expiry (force REQUIRE_APPROVAL if grant expired), set sessionGrantId on decision.
 */
export async function evaluateExitPolicy(params: EvaluateExitPolicyParams): Promise<PaymentPolicyDecision> {
  const {
    session,
    lot,
    fee,
    currency,
    plate,
    lotId,
    getSpendTotalsFiat,
    getPolicyGrantExpiresAt,
  } = params

  const quoteStablecoin = convertToStablecoin(fee, currency)
  const quoteAmountMinor = Math.round(quoteStablecoin * 10 ** STABLECOIN_DECIMALS).toString()
  const spendFiat = await getSpendTotalsFiat(plate, currency)
  const dayTotalMinor = Math.round(
    convertToStablecoin(spendFiat.dayTotalFiat, currency) * 10 ** STABLECOIN_DECIMALS,
  ).toString()
  const sessionTotalMinor = Math.round(
    convertToStablecoin(spendFiat.sessionTotalFiat, currency) * 10 ** STABLECOIN_DECIMALS,
  ).toString()

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
    quote: { amountMinor: quoteAmountMinor, currency },
    spend: { dayTotalMinor, sessionTotalMinor },
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
      reasons: ['GRANT_EXPIRED' as PolicyReasonCode],
    }
  }

  return {
    ...decision,
    sessionGrantId: sessionGrantId ?? null,
  }
}
