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
})
