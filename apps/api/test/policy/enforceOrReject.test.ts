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
})
