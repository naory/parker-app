import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { PaymentPolicyDecision } from '@parker/policy-core'
import {
  createSignedPaymentAuthorization,
  verifySignedPaymentAuthorizationForSettlement,
  type SpaSigner,
  type SpaVerifier,
} from '../../src/services/paymentAuthorization'

function mkSignerVerifier(keyId = 'test-key-1') {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
  const signer: SpaSigner = {
    keyId,
    sign(hash) {
      return crypto.sign(null, hash, privateKey).toString('base64')
    },
  }
  const verifier: SpaVerifier = {
    expectedKeyId: keyId,
    verify(hash, sig) {
      return crypto.verify(null, hash, publicKey, Buffer.from(sig, 'base64'))
    },
  }
  return { signer, verifier }
}

describe('paymentAuthorization service', () => {
  it('creates and verifies a signed SPA envelope', () => {
    const { signer, verifier } = mkSignerVerifier()

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
      signer,
    )
    expect(envelope).not.toBeNull()
    const verification = verifySignedPaymentAuthorizationForSettlement(envelope!, 'dec-1', {
      amount: '19440000',
      rail: 'xrpl',
      asset: { kind: 'IOU', currency: 'RLUSD', issuer: 'rIssuer' },
      destination: 'rDestination',
    }, verifier)
    expect(verification).toEqual({ ok: true })
  })

  it('rejects verification when envelope keyId does not match configured key id', () => {
    const { signer, verifier } = mkSignerVerifier('expected-key-id')

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
      signer,
    )
    expect(envelope).not.toBeNull()
    envelope!.keyId = 'different-key-id'

    const verification = verifySignedPaymentAuthorizationForSettlement(envelope!, 'dec-1', {
      amount: '19440000',
      rail: 'xrpl',
      asset: { kind: 'IOU', currency: 'RLUSD', issuer: 'rIssuer' },
      destination: 'rDestination',
    }, verifier)
    expect(verification).toEqual({ ok: false, reason: 'invalid_signature' })
  })

  it('supports deterministic expiry verification via nowMs override', () => {
    const { signer, verifier } = mkSignerVerifier()

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
      signer,
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
      verifier,
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
      verifier,
      { nowMs: Date.parse('2030-01-01T00:01:01.000Z') },
    )
    expect(afterExpiry).toEqual({ ok: false, reason: 'expired' })
  })

  it('does not issue SPA for stripe decisions in v1', () => {
    const { signer } = mkSignerVerifier()

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
      signer,
    )
    expect(envelope).toBeNull()
  })

  it('fails on destination mismatch when settlement provides wrong destination', () => {
    const { signer, verifier } = mkSignerVerifier()

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
      signer,
    )
    expect(envelope).not.toBeNull()
    expect(envelope!.authorization.destination).toBe('rDestination')

    const verification = verifySignedPaymentAuthorizationForSettlement(envelope!, 'dec-1', {
      amount: '19440000',
      rail: 'xrpl',
      asset: { kind: 'IOU', currency: 'RLUSD', issuer: 'rIssuer' },
      destination: 'rWrongDestination',
    }, verifier)
    expect(verification).toEqual({ ok: false, reason: 'mismatch' })
  })

  it('requires verifier for verification (no implicit env)', () => {
    const { signer } = mkSignerVerifier()
    const wrongVerifier = mkSignerVerifier('other-key').verifier // different keypair

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
      signer,
    )
    expect(envelope).not.toBeNull()

    // Verifier must match signer; wrong keypair fails.
    const verification = verifySignedPaymentAuthorizationForSettlement(envelope!, 'dec-1', {
      amount: '19440000',
      rail: 'xrpl',
      asset: { kind: 'IOU', currency: 'RLUSD', issuer: 'rIssuer' },
      destination: 'rDestination',
    }, wrongVerifier)
    expect(verification).toEqual({ ok: false, reason: 'invalid_signature' })
  })
})
