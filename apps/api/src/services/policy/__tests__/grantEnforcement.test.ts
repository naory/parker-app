/**
 * Unit tests: validateDecisionAgainstGrant (decision ⊆ grant).
 */
import { describe, it, expect } from 'vitest'
import { validateDecisionAgainstGrant } from '../grantEnforcement'
import type { PolicyGrantRecord } from '../../../db/queries'
import type { PaymentPolicyDecision } from '@parker/policy-core'

const baseGrant: PolicyGrantRecord = {
  grantId: 'grant-1',
  policyHash: 'ph-grant',
  allowedRails: ['xrpl', 'stripe'],
  allowedAssets: [
    { kind: 'IOU', currency: 'USDC', issuer: 'rIssuer' },
    { kind: 'ERC20', chainId: 84532, token: '0xUSDC' },
  ],
  maxSpend: { perTxMinor: '1000000', perSessionMinor: '5000000', perDayMinor: '10000000' },
  expiresAt: new Date(Date.now() + 3600_000),
  requireApproval: false,
  reasons: ['OK'],
}

describe('validateDecisionAgainstGrant', () => {
  it('allows when decision rail and asset are in grant and caps are stricter', () => {
    const decision: PaymentPolicyDecision = {
      action: 'ALLOW',
      rail: 'xrpl',
      asset: { kind: 'IOU', currency: 'USDC', issuer: 'rIssuer' },
      reasons: ['OK'],
      maxSpend: { perTxMinor: '500000', perSessionMinor: '2000000', perDayMinor: '5000000' },
      expiresAtISO: new Date().toISOString(),
      decisionId: 'dec-1',
      policyHash: 'ph-1',
    }
    expect(validateDecisionAgainstGrant(baseGrant, decision)).toEqual({ valid: true })
  })

  it('rejects when decision rail not in grant', () => {
    const decision: PaymentPolicyDecision = {
      action: 'ALLOW',
      rail: 'evm',
      asset: { kind: 'ERC20', chainId: 84532, token: '0xUSDC' },
      reasons: ['OK'],
      maxSpend: { perTxMinor: '500000' },
      expiresAtISO: new Date().toISOString(),
      decisionId: 'dec-1',
      policyHash: 'ph-1',
    }
    const result = validateDecisionAgainstGrant(baseGrant, decision)
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toBe('RAIL_NOT_ALLOWED')
  })

  it('rejects when decision asset not in grant', () => {
    const decision: PaymentPolicyDecision = {
      action: 'ALLOW',
      rail: 'xrpl',
      asset: { kind: 'XRP' },
      reasons: ['OK'],
      maxSpend: { perTxMinor: '500000' },
      expiresAtISO: new Date().toISOString(),
      decisionId: 'dec-1',
      policyHash: 'ph-1',
    }
    const result = validateDecisionAgainstGrant(baseGrant, decision)
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toBe('ASSET_NOT_ALLOWED')
  })

  it('rejects when decision perTxMinor exceeds grant', () => {
    const decision: PaymentPolicyDecision = {
      action: 'ALLOW',
      rail: 'xrpl',
      asset: { kind: 'IOU', currency: 'USDC', issuer: 'rIssuer' },
      reasons: ['OK'],
      maxSpend: { perTxMinor: '2000000', perSessionMinor: '5000000', perDayMinor: '10000000' },
      expiresAtISO: new Date().toISOString(),
      decisionId: 'dec-1',
      policyHash: 'ph-1',
    }
    const result = validateDecisionAgainstGrant(baseGrant, decision)
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toBe('CAP_EXCEEDED_TX')
  })

  it('allows when decision is REQUIRE_APPROVAL (no rail/asset/cap check)', () => {
    const decision: PaymentPolicyDecision = {
      action: 'REQUIRE_APPROVAL',
      reasons: ['NEEDS_APPROVAL' as const],
      expiresAtISO: new Date().toISOString(),
      decisionId: 'dec-1',
      policyHash: 'ph-1',
    }
    expect(validateDecisionAgainstGrant(baseGrant, decision)).toEqual({ valid: true })
  })
})
