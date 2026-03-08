import { describe, expect, it } from 'vitest'

import { enforceOrReject } from '../../src/services/policy/enforceOrReject'

describe('enforceOrReject', () => {
  const settlement = {
    amount: '1000',
    rail: 'xrpl' as const,
    asset: { kind: 'IOU' as const, currency: 'USDC', issuer: 'rIssuer' },
  }

  it('returns DECISION_NOT_FOUND when decisionId is missing', async () => {
    const result = await enforceOrReject(async () => null, undefined, settlement)
    expect(result).toEqual({ allowed: false, reason: 'DECISION_NOT_FOUND' })
  })

  it('returns DECISION_NOT_FOUND when decision payload is not found', async () => {
    const result = await enforceOrReject(async () => null, 'dec-1', settlement)
    expect(result).toEqual({ allowed: false, reason: 'DECISION_NOT_FOUND' })
  })

  it('returns POLICY_HASH_MISMATCH when signed authorization is invalid', async () => {
    const decisionPayload = {
      decisionId: 'dec-1',
      policyHash: 'ph-1',
      action: 'ALLOW',
      reasons: ['OK'],
      expiresAtISO: new Date(Date.now() + 60_000).toISOString(),
      rail: 'xrpl',
      asset: { kind: 'IOU', currency: 'USDC', issuer: 'rIssuer' },
      paymentAuthorization: {
        authorization: {
          version: 1,
          decisionId: 'dec-1',
          sessionId: '11111111-1111-4111-8111-111111111111',
          policyHash: 'ph-1',
          quoteId: 'q1',
          rail: 'xrpl',
          asset: { kind: 'IOU', currency: 'USDC', issuer: 'rIssuer' },
          amount: '1000',
          destination: 'rDest',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
        signature: 'not-valid-base64-signature',
        keyId: 'key-1',
      },
    }
    const result = await enforceOrReject(async () => decisionPayload, 'dec-1', settlement)
    expect(result).toEqual({ allowed: false, reason: 'POLICY_HASH_MISMATCH' })
  })
})
