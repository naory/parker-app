import crypto from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import type { PaymentPolicyDecision } from '@parker/policy-core'
import {
  createSignedPaymentAuthorization,
  verifySignedPaymentAuthorizationForSettlement,
} from '../../src/services/paymentAuthorization'

const ORIGINAL_ENV = {
  privateKey: process.env.PARKER_SPA_SIGNING_PRIVATE_KEY_PEM,
  publicKey: process.env.PARKER_SPA_SIGNING_PUBLIC_KEY_PEM,
  keyId: process.env.PARKER_SPA_SIGNING_KEY_ID,
}

afterEach(() => {
  process.env.PARKER_SPA_SIGNING_PRIVATE_KEY_PEM = ORIGINAL_ENV.privateKey
  process.env.PARKER_SPA_SIGNING_PUBLIC_KEY_PEM = ORIGINAL_ENV.publicKey
  process.env.PARKER_SPA_SIGNING_KEY_ID = ORIGINAL_ENV.keyId
})

describe('paymentAuthorization service', () => {
  it('creates and verifies a signed SPA envelope', () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
    process.env.PARKER_SPA_SIGNING_PRIVATE_KEY_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    process.env.PARKER_SPA_SIGNING_PUBLIC_KEY_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString()
    process.env.PARKER_SPA_SIGNING_KEY_ID = 'test-key-1'

    const decision = {
      decisionId: 'dec-1',
      policyHash: 'ph-1',
      action: 'ALLOW',
      reasons: ['OK'],
      expiresAtISO: new Date(Date.now() + 60_000).toISOString(),
      rail: 'xrpl',
      asset: { kind: 'IOU', currency: 'RLUSD', issuer: 'rIssuer' },
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

    const envelope = createSignedPaymentAuthorization(
      '11111111-1111-4111-8111-111111111111',
      decision,
    )
    expect(envelope).not.toBeNull()
    const verification = verifySignedPaymentAuthorizationForSettlement(envelope!, 'dec-1', {
      amount: '19440000',
      rail: 'xrpl',
      asset: { kind: 'IOU', currency: 'RLUSD', issuer: 'rIssuer' },
      destination: 'rDestination',
    })
    expect(verification).toEqual({ ok: true })
  })

  it('rejects verification when envelope keyId does not match configured key id', () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
    process.env.PARKER_SPA_SIGNING_PRIVATE_KEY_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    process.env.PARKER_SPA_SIGNING_PUBLIC_KEY_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString()
    process.env.PARKER_SPA_SIGNING_KEY_ID = 'expected-key-id'

    const decision = {
      decisionId: 'dec-1',
      policyHash: 'ph-1',
      action: 'ALLOW',
      reasons: ['OK'],
      expiresAtISO: new Date(Date.now() + 60_000).toISOString(),
      rail: 'xrpl',
      asset: { kind: 'IOU', currency: 'RLUSD', issuer: 'rIssuer' },
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

    const envelope = createSignedPaymentAuthorization(
      '11111111-1111-4111-8111-111111111111',
      decision,
    )
    expect(envelope).not.toBeNull()
    envelope!.keyId = 'different-key-id'

    const verification = verifySignedPaymentAuthorizationForSettlement(envelope!, 'dec-1', {
      amount: '19440000',
      rail: 'xrpl',
      asset: { kind: 'IOU', currency: 'RLUSD', issuer: 'rIssuer' },
      destination: 'rDestination',
    })
    expect(verification).toEqual({ ok: false, reason: 'invalid_signature' })
  })

  it('supports deterministic expiry verification via nowMs override', () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
    process.env.PARKER_SPA_SIGNING_PRIVATE_KEY_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    process.env.PARKER_SPA_SIGNING_PUBLIC_KEY_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString()
    process.env.PARKER_SPA_SIGNING_KEY_ID = 'test-key-1'

    const decision = {
      decisionId: 'dec-1',
      policyHash: 'ph-1',
      action: 'ALLOW',
      reasons: ['OK'],
      expiresAtISO: '2030-01-01T00:01:00.000Z',
      rail: 'xrpl',
      asset: { kind: 'IOU', currency: 'RLUSD', issuer: 'rIssuer' },
      chosen: { rail: 'xrpl', quoteId: 'q1' },
      settlementQuotes: [
        {
          quoteId: 'q1',
          rail: 'xrpl',
          amount: { amount: '19440000', decimals: 6 },
          destination: 'rDestination',
          expiresAt: '2030-01-01T00:01:00.000Z',
          asset: { kind: 'IOU', currency: 'RLUSD', issuer: 'rIssuer' },
        },
      ],
    } as unknown as PaymentPolicyDecision

    const envelope = createSignedPaymentAuthorization(
      '11111111-1111-4111-8111-111111111111',
      decision,
    )
    expect(envelope).not.toBeNull()

    const beforeExpiry = verifySignedPaymentAuthorizationForSettlement(
      envelope!,
      'dec-1',
      {
        amount: '19440000',
        rail: 'xrpl',
        asset: { kind: 'IOU', currency: 'RLUSD', issuer: 'rIssuer' },
        destination: 'rDestination',
      },
      { nowMs: Date.parse('2030-01-01T00:00:59.000Z') },
    )
    expect(beforeExpiry).toEqual({ ok: true })

    const afterExpiry = verifySignedPaymentAuthorizationForSettlement(
      envelope!,
      'dec-1',
      {
        amount: '19440000',
        rail: 'xrpl',
        asset: { kind: 'IOU', currency: 'RLUSD', issuer: 'rIssuer' },
        destination: 'rDestination',
      },
      { nowMs: Date.parse('2030-01-01T00:01:01.000Z') },
    )
    expect(afterExpiry).toEqual({ ok: false, reason: 'expired' })
  })

  it('does not issue SPA for stripe decisions in v1', () => {
    const { privateKey } = crypto.generateKeyPairSync('ed25519')
    process.env.PARKER_SPA_SIGNING_PRIVATE_KEY_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    process.env.PARKER_SPA_SIGNING_KEY_ID = 'test-key-1'

    const stripeDecision = {
      decisionId: 'dec-stripe-1',
      policyHash: 'ph-stripe-1',
      action: 'ALLOW',
      reasons: ['OK'],
      expiresAtISO: new Date(Date.now() + 60_000).toISOString(),
      rail: 'stripe',
      chosen: { rail: 'stripe', quoteId: 'q-stripe-1' },
      settlementQuotes: [
        {
          quoteId: 'q-stripe-1',
          rail: 'stripe',
          amount: { amount: '1000', decimals: 2 },
          destination: 'acct_123',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
      ],
    } as unknown as PaymentPolicyDecision

    const envelope = createSignedPaymentAuthorization(
      '11111111-1111-4111-8111-111111111111',
      stripeDecision,
    )
    expect(envelope).toBeNull()
  })

  it('requires public key for verification (no private-key fallback)', () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
    process.env.PARKER_SPA_SIGNING_PRIVATE_KEY_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    process.env.PARKER_SPA_SIGNING_PUBLIC_KEY_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString()
    process.env.PARKER_SPA_SIGNING_KEY_ID = 'test-key-1'

    const decision = {
      decisionId: 'dec-1',
      policyHash: 'ph-1',
      action: 'ALLOW',
      reasons: ['OK'],
      expiresAtISO: new Date(Date.now() + 60_000).toISOString(),
      rail: 'xrpl',
      asset: { kind: 'IOU', currency: 'RLUSD', issuer: 'rIssuer' },
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

    const envelope = createSignedPaymentAuthorization(
      '11111111-1111-4111-8111-111111111111',
      decision,
    )
    expect(envelope).not.toBeNull()

    // Verification must use public key only; private key should not be enough.
    process.env.PARKER_SPA_SIGNING_PUBLIC_KEY_PEM = undefined

    const verification = verifySignedPaymentAuthorizationForSettlement(envelope!, 'dec-1', {
      amount: '19440000',
      rail: 'xrpl',
      asset: { kind: 'IOU', currency: 'RLUSD', issuer: 'rIssuer' },
      destination: 'rDestination',
    })
    expect(verification).toEqual({ ok: false, reason: 'invalid_signature' })
  })
})
