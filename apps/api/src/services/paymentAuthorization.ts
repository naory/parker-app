import crypto, { createHash } from 'node:crypto'
import type { Asset, PaymentPolicyDecision, SettlementResult } from '@parker/policy-core'

export interface PaymentAuthorization {
  version: 1
  decisionId: string
  sessionId: string
  policyHash: string
  quoteId: string
  rail: string
  asset: Asset
  amount: string
  destination: string
  expiresAt: string
}

export interface SignedPaymentAuthorization {
  authorization: PaymentAuthorization
  signature: string
  keyId: string
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`
}

function hashAuthorization(authorization: PaymentAuthorization): Buffer {
  return createHash('sha256').update(canonicalJson(authorization)).digest()
}

function parseSigningPrivateKey(): crypto.KeyObject | null {
  const pem = process.env.PARKER_SPA_SIGNING_PRIVATE_KEY_PEM
  if (!pem) return null
  try {
    return crypto.createPrivateKey(pem)
  } catch {
    return null
  }
}

function parseVerificationPublicKey(privateKey: crypto.KeyObject | null): crypto.KeyObject | null {
  const pem = process.env.PARKER_SPA_SIGNING_PUBLIC_KEY_PEM
  if (pem) {
    try {
      return crypto.createPublicKey(pem)
    } catch {
      return null
    }
  }
  return privateKey ? crypto.createPublicKey(privateKey) : null
}

function buildAuthorization(
  sessionId: string,
  decision: PaymentPolicyDecision,
): PaymentAuthorization | null {
  const quoteId = decision.chosen?.quoteId
  const quote = quoteId
    ? decision.settlementQuotes?.find((q) => q.quoteId === quoteId)
    : decision.settlementQuotes?.find((q) => q.rail === decision.rail)
  if (!quoteId || !quote || !decision.rail || !decision.asset || !quote.destination) return null

  return {
    version: 1,
    decisionId: decision.decisionId,
    sessionId,
    policyHash: decision.policyHash,
    quoteId,
    rail: decision.rail,
    asset: decision.asset,
    amount: quote.amount.amount,
    destination: quote.destination,
    expiresAt: quote.expiresAt ?? decision.expiresAtISO,
  }
}

export function createSignedPaymentAuthorization(
  sessionId: string,
  decision: PaymentPolicyDecision,
): SignedPaymentAuthorization | null {
  const authorization = buildAuthorization(sessionId, decision)
  const privateKey = parseSigningPrivateKey()
  if (!authorization || !privateKey) return null

  const signature = crypto.sign(null, hashAuthorization(authorization), privateKey).toString('base64')
  const keyId = process.env.PARKER_SPA_SIGNING_KEY_ID || 'parker-signing-key-1'
  return { authorization, signature, keyId }
}

function assetMatches(a: Asset, b: Asset): boolean {
  return canonicalJson(a) === canonicalJson(b)
}

export function verifySignedPaymentAuthorizationForSettlement(
  envelope: SignedPaymentAuthorization,
  decisionId: string,
  settlement: SettlementResult,
): { ok: true } | { ok: false; reason: 'invalid_signature' | 'expired' | 'mismatch' } {
  const privateKey = parseSigningPrivateKey()
  const publicKey = parseVerificationPublicKey(privateKey)
  if (!publicKey) return { ok: false, reason: 'invalid_signature' }

  const isValid = crypto.verify(
    null,
    hashAuthorization(envelope.authorization),
    publicKey,
    Buffer.from(envelope.signature, 'base64'),
  )
  if (!isValid) return { ok: false, reason: 'invalid_signature' }

  if (Date.parse(envelope.authorization.expiresAt) <= Date.now()) return { ok: false, reason: 'expired' }

  const auth = envelope.authorization
  if (
    auth.decisionId !== decisionId ||
    auth.rail !== settlement.rail ||
    auth.amount !== settlement.amount ||
    (settlement.destination && auth.destination !== settlement.destination) ||
    !assetMatches(auth.asset, settlement.asset)
  ) {
    return { ok: false, reason: 'mismatch' }
  }
  return { ok: true }
}
