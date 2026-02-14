import { Router } from 'express'
import { SiweMessage, generateNonce } from 'siwe'
import { SignJWT, jwtVerify, type JWTPayload } from 'jose'

export const authRouter = Router()

/** In-memory nonce store. Key = nonce, Value = expiry timestamp. */
const nonceStore = new Map<string, number>()

const NONCE_TTL_MS = 5 * 60 * 1000 // 5 minutes
const JWT_TTL = '24h'

/** Secret key for JWT signing — uses env or a random fallback for dev. */
function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET || 'parker-dev-jwt-secret-change-in-production'
  return new TextEncoder().encode(secret)
}

/** Prune expired nonces (called lazily). */
function pruneNonces() {
  const now = Date.now()
  for (const [nonce, expiry] of nonceStore) {
    if (now > expiry) nonceStore.delete(nonce)
  }
}

// GET /api/auth/nonce — Generate a fresh nonce for SIWE
authRouter.get('/nonce', (_req, res) => {
  pruneNonces()
  const nonce = generateNonce()
  nonceStore.set(nonce, Date.now() + NONCE_TTL_MS)
  res.json({ nonce })
})

// POST /api/auth/verify — Verify SIWE signature and issue JWT
authRouter.post('/verify', async (req, res) => {
  try {
    const { message, signature } = req.body as { message: string; signature: string }

    if (!message || !signature) {
      return res.status(400).json({ error: 'message and signature are required' })
    }

    const siweMessage = new SiweMessage(message)

    // Validate nonce exists and hasn't expired
    const nonceExpiry = nonceStore.get(siweMessage.nonce)
    if (!nonceExpiry || Date.now() > nonceExpiry) {
      return res.status(401).json({ error: 'Invalid or expired nonce' })
    }

    // Verify the SIWE signature
    const { data: verified } = await siweMessage.verify({ signature })

    // Consume the nonce (one-time use)
    nonceStore.delete(verified.nonce)

    // Issue JWT
    const token = await new SignJWT({
      sub: verified.address,
      chainId: verified.chainId,
    } as JWTPayload)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(JWT_TTL)
      .setIssuer('parker-api')
      .sign(getJwtSecret())

    res.json({
      token,
      address: verified.address,
      chainId: verified.chainId,
    })
  } catch (error: any) {
    console.error('SIWE verification failed:', error?.message || error)
    res.status(401).json({ error: 'Signature verification failed' })
  }
})

/**
 * Verify a JWT and return the wallet address.
 * Returns null if the token is invalid or expired.
 */
export async function verifyJwt(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), {
      issuer: 'parker-api',
    })
    return (payload.sub as string) || null
  } catch {
    return null
  }
}
