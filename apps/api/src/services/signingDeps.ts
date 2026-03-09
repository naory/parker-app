/**
 * Service-layer wiring: reads env and provides signer/verifier instances.
 * Protocol modules (paymentAuthorization, sessionBudgetAuthorization) never read process.env.
 */

import crypto from 'node:crypto'
import type { SpaSigner, SpaVerifier } from './paymentAuthorization'
import type { SbaSigner, SbaVerifier } from './sessionBudgetAuthorization'

function createSpaSigner(): SpaSigner | null {
  const pem = process.env.PARKER_SPA_SIGNING_PRIVATE_KEY_PEM
  if (!pem) return null
  try {
    const privateKey = crypto.createPrivateKey(pem)
    const keyId = process.env.PARKER_SPA_SIGNING_KEY_ID || 'parker-signing-key-1'
    return {
      keyId,
      sign(hash: Buffer): string {
        return crypto.sign(null, hash, privateKey).toString('base64')
      },
    }
  } catch {
    return null
  }
}

function createSpaVerifier(): SpaVerifier | null {
  const pem = process.env.PARKER_SPA_SIGNING_PUBLIC_KEY_PEM
  if (!pem) return null
  try {
    const publicKey = crypto.createPublicKey(pem)
    const expectedKeyId = process.env.PARKER_SPA_SIGNING_KEY_ID || 'parker-signing-key-1'
    return {
      expectedKeyId,
      verify(hash: Buffer, signatureBase64: string): boolean {
        return crypto.verify(null, hash, publicKey, Buffer.from(signatureBase64, 'base64'))
      },
    }
  } catch {
    return null
  }
}

function createSbaSigner(): SbaSigner | null {
  const pem = process.env.PARKER_SBA_SIGNING_PRIVATE_KEY_PEM
  if (!pem) return null
  try {
    const privateKey = crypto.createPrivateKey(pem)
    const keyId = process.env.PARKER_SBA_SIGNING_KEY_ID || 'parker-budget-signing-key-1'
    return {
      keyId,
      sign(hash: Buffer): string {
        return crypto.sign(null, hash, privateKey).toString('base64')
      },
    }
  } catch {
    return null
  }
}

function createSbaVerifier(): SbaVerifier | null {
  const pem = process.env.PARKER_SBA_SIGNING_PUBLIC_KEY_PEM
  if (!pem) return null
  try {
    const publicKey = crypto.createPublicKey(pem)
    const expectedKeyId = process.env.PARKER_SBA_SIGNING_KEY_ID || 'parker-budget-signing-key-1'
    return {
      expectedKeyId,
      verify(hash: Buffer, signatureBase64: string): boolean {
        return crypto.verify(null, hash, publicKey, Buffer.from(signatureBase64, 'base64'))
      },
    }
  } catch {
    return null
  }
}

let _spaSigner: SpaSigner | null | undefined
let _spaVerifier: SpaVerifier | null | undefined
let _sbaSigner: SbaSigner | null | undefined
let _sbaVerifier: SbaVerifier | null | undefined

export function getSpaSigner(): SpaSigner | null {
  if (_spaSigner === undefined) _spaSigner = createSpaSigner()
  return _spaSigner
}

export function getSpaVerifier(): SpaVerifier | null {
  if (_spaVerifier === undefined) _spaVerifier = createSpaVerifier()
  return _spaVerifier
}

export function getSbaSigner(): SbaSigner | null {
  if (_sbaSigner === undefined) _sbaSigner = createSbaSigner()
  return _sbaSigner
}

export function getSbaVerifier(): SbaVerifier | null {
  if (_sbaVerifier === undefined) _sbaVerifier = createSbaVerifier()
  return _sbaVerifier
}
