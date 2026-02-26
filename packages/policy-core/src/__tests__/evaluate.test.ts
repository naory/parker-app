/**
 * Unit tests for policy-core: allowlist filters, geo, caps, risk → require approval.
 */
import { describe, it, expect } from 'vitest'
import { evaluateEntryPolicy, evaluatePaymentPolicy, enforcePayment } from '../evaluate.js'
import {
  POLICY_SCHEMA_VERSION,
  type Policy,
  type EntryPolicyContext,
  type PaymentPolicyContext,
  type PaymentPolicyDecision,
  type SettlementResult,
  type FiatMoneyMinor,
  type SettlementQuote,
} from '../types.js'
import type { Rail, Asset } from '../types.js'

const basePolicy: Policy = {
  version: POLICY_SCHEMA_VERSION,
}

const nowISO = new Date().toISOString()
const railsOffered: Rail[] = ['xrpl', 'stripe']
const assetsOffered: Asset[] = [
  { kind: 'IOU', currency: 'USD', issuer: 'rIssuer' },
  { kind: 'ERC20', chainId: 84532, token: '0xUSDC' },
]

function entryCtx(overrides: Partial<EntryPolicyContext> = {}): EntryPolicyContext {
  return {
    policy: basePolicy,
    lotId: 'LOT-A',
    nowISO,
    railsOffered,
    assetsOffered,
    ...overrides,
  }
}

function paymentCtx(overrides: Partial<PaymentPolicyContext> = {}): PaymentPolicyContext {
  return {
    policy: basePolicy,
    lotId: 'LOT-A',
    nowISO,
    quote: { amountMinor: '800', currency: 'USD' },
    spend: { dayTotalMinor: '0', sessionTotalMinor: '0' },
    railsOffered,
    assetsOffered,
    ...overrides,
  }
}

describe('evaluateEntryPolicy', () => {
  describe('allowlist filters', () => {
    it('denies when lot not in lotAllowlist', () => {
      const policy: Policy = { ...basePolicy, lotAllowlist: ['LOT-B', 'LOT-C'] }
      const grant = evaluateEntryPolicy(entryCtx({ policy, lotId: 'LOT-A' }))
      expect(grant.allowedRails).toHaveLength(0)
      expect(grant.reasons).toContain('LOT_NOT_ALLOWED')
    })

    it('allows when lot is in lotAllowlist', () => {
      const policy: Policy = { ...basePolicy, lotAllowlist: ['LOT-A', 'LOT-B'] }
      const grant = evaluateEntryPolicy(entryCtx({ policy }))
      expect(grant.allowedRails.length).toBeGreaterThan(0)
      expect(grant.reasons).toContain('OK')
    })

    it('allows any lot when lotAllowlist is empty or absent', () => {
      const grant1 = evaluateEntryPolicy(entryCtx({ policy: { ...basePolicy, lotAllowlist: [] } }))
      expect(grant1.allowedRails.length).toBeGreaterThan(0)
      const grant2 = evaluateEntryPolicy(entryCtx({ policy: basePolicy }))
      expect(grant2.allowedRails.length).toBeGreaterThan(0)
    })

    it('filters rails by railAllowlist', () => {
      const policy: Policy = { ...basePolicy, railAllowlist: ['stripe'] }
      const grant = evaluateEntryPolicy(entryCtx({ policy, railsOffered: ['xrpl', 'stripe'] }))
      expect(grant.allowedRails).toEqual(['stripe'])
    })

    it('denies when no rail matches railAllowlist', () => {
      const policy: Policy = { ...basePolicy, railAllowlist: ['evm'] }
      const grant = evaluateEntryPolicy(entryCtx({ policy }))
      expect(grant.allowedRails).toHaveLength(0)
      expect(grant.reasons).toContain('RAIL_NOT_ALLOWED')
    })

    it('filters assets by assetAllowlist', () => {
      const policy: Policy = {
        ...basePolicy,
        assetAllowlist: [{ kind: 'IOU', currency: 'USD', issuer: 'rIssuer' }],
      }
      const grant = evaluateEntryPolicy(entryCtx({ policy }))
      expect(grant.allowedAssets).toHaveLength(1)
      expect(grant.allowedAssets[0]).toMatchObject({ kind: 'IOU', currency: 'USD', issuer: 'rIssuer' })
    })

    it('denies when no asset matches assetAllowlist', () => {
      const policy: Policy = {
        ...basePolicy,
        assetAllowlist: [{ kind: 'XRP' }],
      }
      const grant = evaluateEntryPolicy(entryCtx({ policy, assetsOffered: [assetsOffered[0]] }))
      expect(grant.allowedAssets).toHaveLength(0)
      expect(grant.reasons).toContain('ASSET_NOT_ALLOWED')
    })

    it('allows entry when only stripe (no crypto assets required)', () => {
      const grant = evaluateEntryPolicy(
        entryCtx({ railsOffered: ['stripe'], assetsOffered: [] }),
      )
      expect(grant.allowedRails).toEqual(['stripe'])
      expect(grant.allowedAssets).toHaveLength(0)
      expect(grant.reasons).toContain('OK')
    })

    it('denies entry when crypto rail offered but no assets', () => {
      const grant = evaluateEntryPolicy(
        entryCtx({ railsOffered: ['xrpl'], assetsOffered: [] }),
      )
      expect(grant.allowedRails).toHaveLength(0)
      expect(grant.reasons).toContain('ASSET_NOT_ALLOWED')
    })
  })

  describe('geo allowlist', () => {
    it('denies when geo not provided but geoAllowlist is set', () => {
      const policy: Policy = {
        ...basePolicy,
        geoAllowlist: [{ centerLat: 32.0, centerLng: 34.8, radiusMeters: 5000 }],
      }
      const grant = evaluateEntryPolicy(entryCtx({ policy }))
      expect(grant.allowedRails).toHaveLength(0)
      expect(grant.reasons).toContain('GEO_NOT_ALLOWED')
    })

    it('denies when point is outside all circles', () => {
      const policy: Policy = {
        ...basePolicy,
        geoAllowlist: [{ centerLat: 32.0, centerLng: 34.8, radiusMeters: 100 }],
      }
      const grant = evaluateEntryPolicy(
        entryCtx({ policy, geo: { lat: 31.5, lng: 34.8 } }),
      )
      expect(grant.allowedRails).toHaveLength(0)
      expect(grant.reasons).toContain('GEO_NOT_ALLOWED')
    })

    it('allows when point is inside a circle', () => {
      const policy: Policy = {
        ...basePolicy,
        geoAllowlist: [{ centerLat: 32.08, centerLng: 34.78, radiusMeters: 50_000 }],
      }
      const grant = evaluateEntryPolicy(
        entryCtx({ policy, geo: { lat: 32.08, lng: 34.78 } }),
      )
      expect(grant.allowedRails.length).toBeGreaterThan(0)
      expect(grant.reasons).toContain('OK')
    })
  })

  describe('risk → require approval', () => {
    it('sets requireApproval and reasons when riskScore >= 80', () => {
      const grant = evaluateEntryPolicy(entryCtx({ riskScore: 85 }))
      expect(grant.requireApproval).toBe(true)
      expect(grant.reasons).toContain('RISK_HIGH')
      expect(grant.reasons).toContain('NEEDS_APPROVAL')
    })

    it('does not set requireApproval when riskScore < 80', () => {
      const grant = evaluateEntryPolicy(entryCtx({ riskScore: 50 }))
      expect(grant.requireApproval).toBeFalsy()
      expect(grant.reasons).toContain('OK')
    })
  })
})

describe('evaluatePaymentPolicy', () => {
  describe('caps (tx/session/day)', () => {
    it('denies when quote exceeds capPerTxMinor', () => {
      const policy: Policy = { ...basePolicy, capPerTxMinor: '500' }
      const decision = evaluatePaymentPolicy(paymentCtx({ policy, quote: { amountMinor: '600', currency: 'USD' } }))
      expect(decision.action).toBe('DENY')
      expect(decision.reasons).toContain('CAP_EXCEEDED_TX')
    })

    it('allows when quote within capPerTxMinor', () => {
      const policy: Policy = { ...basePolicy, capPerTxMinor: '1000' }
      const decision = evaluatePaymentPolicy(paymentCtx({ policy }))
      expect(decision.action).toBe('ALLOW')
    })

    it('denies when sessionTotal + quote exceeds capPerSessionMinor', () => {
      const policy: Policy = { ...basePolicy, capPerSessionMinor: '1000' }
      const decision = evaluatePaymentPolicy(
        paymentCtx({
          policy,
          quote: { amountMinor: '600', currency: 'USD' },
          spend: { dayTotalMinor: '0', sessionTotalMinor: '500' },
        }),
      )
      expect(decision.action).toBe('DENY')
      expect(decision.reasons).toContain('CAP_EXCEEDED_SESSION')
    })

    it('denies when dayTotal + quote exceeds capPerDayMinor', () => {
      const policy: Policy = { ...basePolicy, capPerDayMinor: '2000' }
      const decision = evaluatePaymentPolicy(
        paymentCtx({
          policy,
          quote: { amountMinor: '1500', currency: 'USD' },
          spend: { dayTotalMinor: '1000', sessionTotalMinor: '0' },
        }),
      )
      expect(decision.action).toBe('DENY')
      expect(decision.reasons).toContain('CAP_EXCEEDED_DAY')
    })
  })

  describe('risk → require approval', () => {
    it('returns REQUIRE_APPROVAL when riskScore >= 80', () => {
      const decision = evaluatePaymentPolicy(paymentCtx({ riskScore: 90 }))
      expect(decision.action).toBe('REQUIRE_APPROVAL')
      expect(decision.reasons).toContain('RISK_HIGH')
      expect(decision.reasons).toContain('NEEDS_APPROVAL')
    })

    it('returns REQUIRE_APPROVAL when quote exceeds requireApprovalOverMinor', () => {
      const policy: Policy = { ...basePolicy, requireApprovalOverMinor: '500' }
      const decision = evaluatePaymentPolicy(
        paymentCtx({ policy, quote: { amountMinor: '600', currency: 'USD' } }),
      )
      expect(decision.action).toBe('REQUIRE_APPROVAL')
      expect(decision.reasons).toContain('PRICE_SPIKE')
      expect(decision.reasons).toContain('NEEDS_APPROVAL')
    })
  })

  describe('allowlist filters', () => {
    it('picks first allowed rail and asset when allowlists set', () => {
      const offered = [...assetsOffered]
      const policy: Policy = {
        ...basePolicy,
        railAllowlist: ['xrpl', 'stripe'],
        assetAllowlist: [offered[0]],
      }
      const decision = evaluatePaymentPolicy(paymentCtx({ policy, assetsOffered: offered }))
      expect(decision.action).toBe('ALLOW')
      expect(decision.rail).toBe('xrpl')
      expect(decision.asset).toMatchObject({ kind: 'IOU', currency: 'USD', issuer: 'rIssuer' })
    })

    it('denies when lot not in lotAllowlist', () => {
      const policy: Policy = { ...basePolicy, lotAllowlist: ['LOT-B'] }
      const decision = evaluatePaymentPolicy(paymentCtx({ policy, lotId: 'LOT-A' }))
      expect(decision.action).toBe('DENY')
      expect(decision.reasons).toContain('LOT_NOT_ALLOWED')
    })

    it('stripe rail has no asset (asset undefined)', () => {
      const policy: Policy = { ...basePolicy, railAllowlist: ['stripe'] }
      const decision = evaluatePaymentPolicy(
        paymentCtx({ policy, railsOffered: ['stripe', 'xrpl'], assetsOffered }),
      )
      expect(decision.action).toBe('ALLOW')
      expect(decision.rail).toBe('stripe')
      expect(decision.asset).toBeUndefined()
    })

    it('uses priceFiat and spendTotalsFiat when provided (fiat-only caps)', () => {
      const policy: Policy = { ...basePolicy, capPerTxMinor: '1000' }
      const priceFiat: FiatMoneyMinor = { amountMinor: '800', currency: 'USD' }
      const spendTotalsFiat = {
        dayTotal: { amountMinor: '0', currency: 'USD' },
        sessionTotal: { amountMinor: '0', currency: 'USD' },
      }
      const decision = evaluatePaymentPolicy(
        paymentCtx({
          policy,
          priceFiat,
          spendTotalsFiat,
          railsOffered: ['stripe'],
          assetsOffered: [],
        }),
      )
      expect(decision.action).toBe('ALLOW')
      expect(decision.rail).toBe('stripe')
    })
  })
})

describe('enforcePayment', () => {
  const allowedDecision: PaymentPolicyDecision = {
    action: 'ALLOW',
    rail: 'xrpl',
    asset: { kind: 'IOU', currency: 'USD', issuer: 'rIssuer' },
    reasons: ['OK'],
    maxSpend: { perTxMinor: '1000' },
    expiresAtISO: nowISO,
    decisionId: 'dec-1',
    policyHash: 'hash-1',
  }

  it('allows when rail and asset match and amount within cap', () => {
    const settlement: SettlementResult = {
      amount: '800',
      asset: { kind: 'IOU', currency: 'USD', issuer: 'rIssuer' },
      rail: 'xrpl',
    }
    const result = enforcePayment(allowedDecision, settlement)
    expect(result.allowed).toBe(true)
  })

  it('denies when rail does not match', () => {
    const settlement: SettlementResult = {
      amount: '800',
      asset: { kind: 'IOU', currency: 'USD', issuer: 'rIssuer' },
      rail: 'evm',
    }
    const result = enforcePayment(allowedDecision, settlement)
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('RAIL_NOT_ALLOWED')
  })

  it('denies when asset does not match', () => {
    const settlement: SettlementResult = {
      amount: '800',
      asset: { kind: 'ERC20', chainId: 84532, token: '0xUSDC' },
      rail: 'xrpl',
    }
    const result = enforcePayment(allowedDecision, settlement)
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('ASSET_NOT_ALLOWED')
  })

  it('denies when amount exceeds perTxMinor cap', () => {
    const settlement: SettlementResult = {
      amount: '1500',
      asset: { kind: 'IOU', currency: 'USD', issuer: 'rIssuer' },
      rail: 'xrpl',
    }
    const result = enforcePayment(allowedDecision, settlement)
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('CAP_EXCEEDED_TX')
  })

  it('denies when decision action is not ALLOW', () => {
    const denyDecision: PaymentPolicyDecision = {
      ...allowedDecision,
      action: 'DENY',
      reasons: ['CAP_EXCEEDED_DAY'],
    }
    const settlement: SettlementResult = {
      amount: '800',
      asset: { kind: 'IOU', currency: 'USD', issuer: 'rIssuer' },
      rail: 'xrpl',
    }
    const result = enforcePayment(denyDecision, settlement)
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('CAP_EXCEEDED_DAY')
  })

  it('allows when amount equals perTxMinor cap (exact boundary)', () => {
    const settlement: SettlementResult = {
      amount: '1000',
      asset: { kind: 'IOU', currency: 'USD', issuer: 'rIssuer' },
      rail: 'xrpl',
    }
    const result = enforcePayment(allowedDecision, settlement)
    expect(result.allowed).toBe(true)
  })

  describe('stripe: ignores asset, enforces rail + amount cap', () => {
    const stripeDecision: PaymentPolicyDecision = {
      action: 'ALLOW',
      rail: 'stripe',
      asset: undefined,
      reasons: ['OK'],
      maxSpend: { perTxMinor: '1000' },
      expiresAtISO: nowISO,
      decisionId: 'dec-stripe',
      policyHash: 'hash-stripe',
    }

    it('allows when rail=stripe, amount within cap, settlement.asset arbitrary', () => {
      const settlement: SettlementResult = {
        amount: '800',
        asset: { kind: 'IOU', currency: 'USD', issuer: '' },
        rail: 'stripe',
      }
      const result = enforcePayment(stripeDecision, settlement)
      expect(result.allowed).toBe(true)
    })

    it('denies when rail=stripe but amount exceeds perTxMinor cap', () => {
      const settlement: SettlementResult = {
        amount: '1500',
        asset: { kind: 'IOU', currency: 'EUR', issuer: 'any' },
        rail: 'stripe',
      }
      const result = enforcePayment(stripeDecision, settlement)
      expect(result.allowed).toBe(false)
      expect(result.reason).toBe('CAP_EXCEEDED_TX')
    })
  })

  describe('enforcement with settlementQuotes (quote-based)', () => {
    const quoteId = 'quote-xrpl-1'
    const xrplQuote: SettlementQuote = {
      quoteId,
      rail: 'xrpl',
      asset: { kind: 'IOU', currency: 'USD', issuer: 'rIssuer' },
      amount: { amount: '800000', decimals: 6 },
      destination: 'rOperator',
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    }
    const decisionWithQuotes: PaymentPolicyDecision = {
      action: 'ALLOW',
      rail: 'xrpl',
      asset: { kind: 'IOU', currency: 'USD', issuer: 'rIssuer' },
      reasons: ['OK'],
      expiresAtISO: nowISO,
      decisionId: 'dec-q',
      policyHash: 'hash-q',
      settlementQuotes: [xrplQuote],
      chosen: { rail: 'xrpl', quoteId },
    }

    it('allows when atomic amount and rail and asset match quote', () => {
      const settlement: SettlementResult = {
        amount: '800000',
        asset: { kind: 'IOU', currency: 'USD', issuer: 'rIssuer' },
        rail: 'xrpl',
        quoteId,
        destination: 'rOperator',
      }
      const result = enforcePayment(decisionWithQuotes, settlement)
      expect(result.allowed).toBe(true)
    })

    it('denies when atomic amount does not match quote', () => {
      const settlement: SettlementResult = {
        amount: '900000',
        asset: { kind: 'IOU', currency: 'USD', issuer: 'rIssuer' },
        rail: 'xrpl',
        quoteId,
        destination: 'rOperator',
      }
      const result = enforcePayment(decisionWithQuotes, settlement)
      expect(result.allowed).toBe(false)
      expect(result.reason).toBe('CAP_EXCEEDED_TX')
    })

    it('denies when destination does not match quote', () => {
      const settlement: SettlementResult = {
        amount: '800000',
        asset: { kind: 'IOU', currency: 'USD', issuer: 'rIssuer' },
        rail: 'xrpl',
        quoteId,
        destination: 'rOther',
      }
      const result = enforcePayment(decisionWithQuotes, settlement)
      expect(result.allowed).toBe(false)
      expect(result.reason).toBe('RAIL_NOT_ALLOWED')
    })
  })
})
