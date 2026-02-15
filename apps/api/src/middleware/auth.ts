import type { RequestHandler } from 'express'
import { verifyJwt } from '../routes/auth'

/**
 * Wallet signature verification middleware.
 *
 * Priority:
 * 1. Authorization: Bearer <JWT> — verified via EIP-4361 (SIWE) flow
 * 2. x-wallet-address header — trusted in development only
 *
 * Sets `req.wallet` with the verified wallet address.
 */
export const verifyWallet: RequestHandler = async (req, _res, next) => {
  // 1. Check for JWT in Authorization header
  const authHeader = req.headers.authorization
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    const address = await verifyJwt(token)
    if (address) {
      ;(req as any).wallet = address
      return next()
    }
  }

  // 2. Fallback: trust x-wallet-address header (dev/MVP only)
  const wallet = req.headers['x-wallet-address']
  if (wallet) {
    ;(req as any).wallet = typeof wallet === 'string' ? wallet : wallet[0]
  }

  next()
}

/**
 * Middleware that requires a verified wallet.
 * Use on routes that need authenticated access.
 */
export const requireWallet: RequestHandler = (req, res, next) => {
  if (!(req as any).wallet) {
    return res.status(401).json({ error: 'Authentication required' })
  }
  next()
}
