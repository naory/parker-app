import type { RequestHandler } from 'express'

/**
 * Wallet signature verification middleware.
 * Verifies that the request is signed by the claimed wallet address.
 *
 * TODO: Implement EIP-4361 (Sign-In with Ethereum) verification
 */
export const verifyWallet: RequestHandler = (req, _res, next) => {
  // For MVP, trust the x-wallet-address header
  // In production, verify EIP-4361 signature from Authorization header
  const wallet = req.headers['x-wallet-address']
  if (wallet) {
    ;(req as any).wallet = wallet
  }
  next()
}
