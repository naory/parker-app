import { describe, it, expect, vi } from 'vitest'
import { verifyWallet } from '../../middleware/auth'
import type { Request, Response, NextFunction } from 'express'

describe('verifyWallet middleware', () => {
  it('sets req.wallet from x-wallet-address header', () => {
    const req = { headers: { 'x-wallet-address': '0xABC' } } as any as Request
    const res = {} as Response
    const next = vi.fn() as NextFunction

    verifyWallet(req, res, next)

    expect((req as any).wallet).toBe('0xABC')
    expect(next).toHaveBeenCalled()
  })

  it('calls next without setting wallet when header missing', () => {
    const req = { headers: {} } as Request
    const res = {} as Response
    const next = vi.fn() as NextFunction

    verifyWallet(req, res, next)

    expect((req as any).wallet).toBeUndefined()
    expect(next).toHaveBeenCalled()
  })
})
