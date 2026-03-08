import crypto, { createHash, randomUUID } from 'node:crypto'
import type { Asset, PaymentPolicyDecision, Rail } from '@parker/policy-core'

export interface SessionBudgetAuthorization {
  version: 1
  budgetId: string
  sessionId: string
  vehicleId: string
  policyHash: string
  currency: string
  minorUnit: number
  maxAmountMinor: string
  allowedRails: Rail[]
  allowedAssets: Asset[]
  destinationAllowlist: string[]
  expiresAt: string
}

export interface SignedSessionBudgetAuthorization {
  authorization: SessionBudgetAuthorization
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

function hashAuthorization(authorization: SessionBudgetAuthorization): Buffer {
  return createHash('sha256').update(canonicalJson(authorization)).digest()
}

function getExpectedKeyId(): string {
  return process.env.PARKER_SBA_SIGNING_KEY_ID || 'parker-budget-signing-key-1'
}

function parseSigningPrivateKey(): crypto.KeyObject | null {
  const pem = process.env.PARKER_SBA_SIGNING_PRIVATE_KEY_PEM
  if (!pem) return null
  try {
    return crypto.createPrivateKey(pem)
  } catch {
    return null
  }
}

function parseVerificationPublicKey(): crypto.KeyObject | null {
  const pem = process.env.PARKER_SBA_SIGNING_PUBLIC_KEY_PEM
  if (!pem) return null
  try {
    return crypto.createPublicKey(pem)
  } catch {
    return null
  }
}

export function createSignedSessionBudgetAuthorization(input: {
  sessionId: string
  vehicleId: string
  policyHash: string
  currency: string
  minorUnit?: number
  maxAmountMinor: string
  allowedRails: Rail[]
  allowedAssets: Asset[]
  destinationAllowlist: string[]
  expiresAt: string
}): SignedSessionBudgetAuthorization | null {
  const privateKey = parseSigningPrivateKey()
  if (!privateKey) return null

  const authorization: SessionBudgetAuthorization = {
    version: 1,
    budgetId: randomUUID(),
    sessionId: input.sessionId,
    vehicleId: input.vehicleId,
    policyHash: input.policyHash,
    currency: input.currency,
    minorUnit: input.minorUnit ?? 2,
    maxAmountMinor: input.maxAmountMinor,
    allowedRails: input.allowedRails,
    allowedAssets: input.allowedAssets,
    destinationAllowlist: input.destinationAllowlist,
    expiresAt: input.expiresAt,
  }

  const signature = crypto.sign(null, hashAuthorization(authorization), privateKey).toString('base64')
  return {
    authorization,
    signature,
    keyId: getExpectedKeyId(),
  }
}

function assetMatches(a: Asset, b: Asset): boolean {
  return canonicalJson(a) === canonicalJson(b)
}

export function verifySignedSessionBudgetAuthorizationForDecision(
  envelope: SignedSessionBudgetAuthorization,
  input: { sessionId: string; decision: PaymentPolicyDecision; nowMs?: number },
): { ok: true } | { ok: false; reason: 'invalid_signature' | 'expired' | 'mismatch' } {
  if (envelope.keyId !== getExpectedKeyId()) {
    return { ok: false, reason: 'invalid_signature' }
  }
  const publicKey = parseVerificationPublicKey()
  if (!publicKey) return { ok: false, reason: 'invalid_signature' }

  const isValid = crypto.verify(
    null,
    hashAuthorization(envelope.authorization),
    publicKey,
    Buffer.from(envelope.signature, 'base64'),
  )
  if (!isValid) return { ok: false, reason: 'invalid_signature' }

  const nowMs = typeof input.nowMs === 'number' ? input.nowMs : Date.now()
  if (Date.parse(envelope.authorization.expiresAt) <= nowMs) {
    return { ok: false, reason: 'expired' }
  }

  const { authorization } = envelope
  const { decision } = input
  if (authorization.sessionId !== input.sessionId || authorization.policyHash !== decision.policyHash) {
    return { ok: false, reason: 'mismatch' }
  }
  if (decision.rail && !authorization.allowedRails.includes(decision.rail)) {
    return { ok: false, reason: 'mismatch' }
  }
  if (
    decision.asset &&
    authorization.allowedAssets.length > 0 &&
    !authorization.allowedAssets.some((allowedAsset) => assetMatches(allowedAsset, decision.asset!))
  ) {
    return { ok: false, reason: 'mismatch' }
  }

  if (decision.priceFiat?.amountMinor) {
    const budgetMinor = BigInt(authorization.maxAmountMinor)
    const decisionMinor = BigInt(decision.priceFiat.amountMinor)
    if (decisionMinor > budgetMinor) {
      return { ok: false, reason: 'mismatch' }
    }
  }

  const quoteId = decision.chosen?.quoteId
  const chosenQuote = quoteId
    ? decision.settlementQuotes?.find((q) => q.quoteId === quoteId)
    : decision.settlementQuotes?.find((q) => q.rail === decision.rail)
  if (chosenQuote && authorization.destinationAllowlist.length > 0) {
    if (!authorization.destinationAllowlist.includes(chosenQuote.destination)) {
      return { ok: false, reason: 'mismatch' }
    }
  }

  return { ok: true }
}
