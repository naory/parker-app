import crypto from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import type { PaymentPolicyDecision } from '@parker/policy-core'
import {
  createSignedSessionBudgetAuthorization,
  verifySignedSessionBudgetAuthorizationForDecision,
} from '../../src/services/sessionBudgetAuthorization'

const ORIGINAL_ENV = {
  privateKey: process.env.PARKER_SBA_SIGNING_PRIVATE_KEY_PEM,
  publicKey: process.env.PARKER_SBA_SIGNING_PUBLIC_KEY_PEM,
  keyId: process.env.PARKER_SBA_SIGNING_KEY_ID,
}

afterEach(() => {
  process.env.PARKER_SBA_SIGNING_PRIVATE_KEY_PEM = ORIGINAL_ENV.privateKey
  process.env.PARKER_SBA_SIGNING_PUBLIC_KEY_PEM = ORIGINAL_ENV.publicKey
  process.env.PARKER_SBA_SIGNING_KEY_ID = ORIGINAL_ENV.keyId
})

describe('sessionBudgetAuthorization service', () => {
  it('creates and verifies signed SBA envelope for a matching decision', () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
    process.env.PARKER_SBA_SIGNING_PRIVATE_KEY_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    process.env.PARKER_SBA_SIGNING_PUBLIC_KEY_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString()
    process.env.PARKER_SBA_SIGNING_KEY_ID = 'budget-key-1'

    const envelope = createSignedSessionBudgetAuthorization({
      sessionId: '11111111-1111-4111-8111-111111111111',
      vehicleId: '1234567',
      policyHash: 'ph-1',
      currency: 'USD',
      minorUnit: 2,
      maxAmountMinor: '3000',
      allowedRails: ['xrpl'],
      allowedAssets: [{ kind: 'IOU', currency: 'RLUSD', issuer: 'rIssuer' }],
      destinationAllowlist: ['rDestination'],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })
    expect(envelope).not.toBeNull()
    expect(envelope!.authorization.budgetScope).toBe('SESSION')

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
    })
    expect(verification).toEqual({ ok: true })
  })

  it('rejects decision that exceeds budget amount', () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
    process.env.PARKER_SBA_SIGNING_PRIVATE_KEY_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    process.env.PARKER_SBA_SIGNING_PUBLIC_KEY_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString()

    const envelope = createSignedSessionBudgetAuthorization({
      sessionId: '11111111-1111-4111-8111-111111111111',
      vehicleId: '1234567',
      policyHash: 'ph-1',
      currency: 'USD',
      maxAmountMinor: '1000',
      allowedRails: ['stripe'],
      allowedAssets: [],
      destinationAllowlist: [],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })
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
    })
    expect(verification).toEqual({ ok: false, reason: 'mismatch' })
  })

  it('rejects unsupported non-session budget scopes in current implementation', () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
    process.env.PARKER_SBA_SIGNING_PRIVATE_KEY_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    process.env.PARKER_SBA_SIGNING_PUBLIC_KEY_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString()

    const envelope = createSignedSessionBudgetAuthorization({
      sessionId: '11111111-1111-4111-8111-111111111111',
      vehicleId: '1234567',
      policyHash: 'ph-1',
      currency: 'USD',
      budgetScope: 'DAY',
      maxAmountMinor: '5000',
      allowedRails: ['stripe'],
      allowedAssets: [],
      destinationAllowlist: [],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })
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
    })
    expect(verification).toEqual({ ok: false, reason: 'mismatch' })
  })
})
