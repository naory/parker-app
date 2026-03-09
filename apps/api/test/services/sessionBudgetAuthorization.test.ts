import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { PaymentPolicyDecision } from '@parker/policy-core'
import {
  createSignedSessionBudgetAuthorization,
  verifySignedSessionBudgetAuthorizationForDecision,
  type SbaSigner,
  type SbaVerifier,
} from '../../src/services/sessionBudgetAuthorization'

function mkSignerVerifier(keyId = 'budget-key-1') {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
  const signer: SbaSigner = {
    keyId,
    sign(hash) {
      return crypto.sign(null, hash, privateKey).toString('base64')
    },
  }
  const verifier: SbaVerifier = {
    expectedKeyId: keyId,
    verify(hash, sig) {
      return crypto.verify(null, hash, publicKey, Buffer.from(sig, 'base64'))
    },
  }
  return { signer, verifier }
}

describe('sessionBudgetAuthorization service', () => {
  it('creates and verifies signed SBA envelope for a matching decision', () => {
    const { signer, verifier } = mkSignerVerifier()

    const envelope = createSignedSessionBudgetAuthorization({
      sessionId: '11111111-1111-4111-8111-111111111111',
      vehicleId: '1234567',
      scopeId: 'veh_123',
      policyHash: 'ph-1',
      currency: 'USD',
      minorUnit: 2,
      maxAmountMinor: '3000',
      allowedRails: ['xrpl'],
      allowedAssets: [{ kind: 'IOU', currency: 'RLUSD', issuer: 'rIssuer' }],
      destinationAllowlist: ['rDestination'],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }, signer)
    expect(envelope).not.toBeNull()
    expect(envelope!.authorization.budgetScope).toBe('SESSION')
    expect(envelope!.authorization.scopeId).toBe('veh_123')

    const decision = {
      decisionId: 'dec-1',
      policyHash: 'ph-1',
      action: 'ALLOW',
      reasons: ['OK'],
      expiresAtISO: new Date(Date.now() + 60_000).toISOString(),
      rail: 'xrpl',
      asset: { kind: 'IOU', currency: 'RLUSD', issuer: 'rIssuer' },
      priceFiat: { amountMinor: '2500', currency: 'USD' },
      chosen: { rail: 'xrpl', quoteId: 'q1' },
      settlementQuotes: [
        {
          quoteId: 'q1',
          rail: 'xrpl',
          amount: { amount: '19440000', decimals: 6 },
          destination: 'rDestination',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          asset: { kind: 'IOU', currency: 'RLUSD', issuer: 'rIssuer' },
        },
      ],
    } as unknown as PaymentPolicyDecision

    const verification = verifySignedSessionBudgetAuthorizationForDecision(envelope!, {
      sessionId: '11111111-1111-4111-8111-111111111111',
      decision,
    }, verifier)
    expect(verification).toEqual({ ok: true })
  })

  it('rejects decision with wrong rail (rail not in allowedRails)', () => {
    const { signer, verifier } = mkSignerVerifier()

    const envelope = createSignedSessionBudgetAuthorization({
      sessionId: '11111111-1111-4111-8111-111111111111',
      vehicleId: '1234567',
      policyHash: 'ph-1',
      currency: 'USD',
      maxAmountMinor: '5000',
      allowedRails: ['xrpl'],
      allowedAssets: [],
      destinationAllowlist: [],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }, signer)
    expect(envelope).not.toBeNull()

    const decision = {
      decisionId: 'dec-1',
      policyHash: 'ph-1',
      action: 'ALLOW',
      reasons: ['OK'],
      expiresAtISO: new Date(Date.now() + 60_000).toISOString(),
      rail: 'evm',
      chosen: { rail: 'evm', quoteId: 'q1' },
      settlementQuotes: [
        {
          quoteId: 'q1',
          rail: 'evm',
          amount: { amount: '1000', decimals: 18 },
          destination: '0xDest',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
      ],
    } as unknown as PaymentPolicyDecision

    const verification = verifySignedSessionBudgetAuthorizationForDecision(envelope!, {
      sessionId: '11111111-1111-4111-8111-111111111111',
      decision,
    }, verifier)
    expect(verification).toEqual({ ok: false, reason: 'mismatch' })
  })

  it('rejects decision that exceeds budget amount', () => {
    const { signer, verifier } = mkSignerVerifier()

    const envelope = createSignedSessionBudgetAuthorization({
      sessionId: '11111111-1111-4111-8111-111111111111',
      vehicleId: '1234567',
      scopeId: 'veh_123',
      policyHash: 'ph-1',
      currency: 'USD',
      maxAmountMinor: '1000',
      allowedRails: ['stripe'],
      allowedAssets: [],
      destinationAllowlist: [],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }, signer)
    expect(envelope).not.toBeNull()

    const decision = {
      decisionId: 'dec-1',
      policyHash: 'ph-1',
      action: 'ALLOW',
      reasons: ['OK'],
      expiresAtISO: new Date(Date.now() + 60_000).toISOString(),
      rail: 'stripe',
      priceFiat: { amountMinor: '1200', currency: 'USD' },
      chosen: { rail: 'stripe', quoteId: 'q1' },
      settlementQuotes: [
        {
          quoteId: 'q1',
          rail: 'stripe',
          amount: { amount: '1200', decimals: 2 },
          destination: '',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
      ],
    } as unknown as PaymentPolicyDecision

    const verification = verifySignedSessionBudgetAuthorizationForDecision(envelope!, {
      sessionId: '11111111-1111-4111-8111-111111111111',
      decision,
    }, verifier)
    expect(verification).toEqual({ ok: false, reason: 'mismatch' })
  })

  it('rejects unsupported non-session budget scopes in current implementation', () => {
    const { signer, verifier } = mkSignerVerifier()

    const envelope = createSignedSessionBudgetAuthorization({
      sessionId: '11111111-1111-4111-8111-111111111111',
      vehicleId: '1234567',
      policyHash: 'ph-1',
      currency: 'USD',
      budgetScope: 'DAY',
      scopeId: 'veh_123',
      maxAmountMinor: '5000',
      allowedRails: ['stripe'],
      allowedAssets: [],
      destinationAllowlist: [],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }, signer)
    expect(envelope).not.toBeNull()

    const decision = {
      decisionId: 'dec-1',
      policyHash: 'ph-1',
      action: 'ALLOW',
      reasons: ['OK'],
      expiresAtISO: new Date(Date.now() + 60_000).toISOString(),
      rail: 'stripe',
      priceFiat: { amountMinor: '1000', currency: 'USD' },
    } as unknown as PaymentPolicyDecision

    const verification = verifySignedSessionBudgetAuthorizationForDecision(envelope!, {
      sessionId: '11111111-1111-4111-8111-111111111111',
      decision,
    }, verifier)
    expect(verification).toEqual({ ok: false, reason: 'mismatch' })
  })
})
