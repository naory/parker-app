import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPaymentMiddleware, type PaymentRequired } from '../middleware'
import type { Request, Response, NextFunction } from 'express'

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    ...overrides,
  } as any
}

function mockRes(): Response & { _status: number; _body: any } {
  const res: any = {
    _status: 200,
    _body: null,
    locals: {},
    status(code: number) {
      res._status = code
      return res
    },
    json(body: any) {
      res._body = body
      return res
    },
  }
  return res
}

describe('createPaymentMiddleware', () => {
  let middleware: ReturnType<typeof createPaymentMiddleware>
  let next: NextFunction

  beforeEach(() => {
    middleware = createPaymentMiddleware({
      network: 'base-sepolia',
      token: 'USDC',
      receiverWallet: '0xABC',
    })
    next = vi.fn()
  })

  it('calls next() always', () => {
    const req = mockReq()
    const res = mockRes()
    middleware(req, res, next)
    expect(next).toHaveBeenCalled()
  })

  it('sets paymentVerified when X-PAYMENT header present', () => {
    const req = mockReq({ headers: { 'x-payment': '0xtxhash123' } as any })
    const res = mockRes()
    middleware(req, res, next)
    expect((req as any).paymentVerified).toBe(true)
    expect((req as any).paymentTxHash).toBe('0xtxhash123')
  })

  it('returns 402 when paymentRequired is set and no payment header', () => {
    const req = mockReq()
    const res = mockRes()
    middleware(req, res, next)

    // Simulate route handler setting paymentRequired
    res.locals.paymentRequired = {
      amount: '10.000000',
      description: 'Parking fee',
      plateNumber: 'ABC123',
      sessionId: 'sess-1',
    } satisfies PaymentRequired

    // Call res.json (as the route handler would)
    res.json({ fee: 10, currency: 'USD' })

    expect(res._status).toBe(402)
    expect(res._body.error).toBe('Payment Required')
    expect(res._body.x402.amount).toBe('10.000000')
    expect(res._body.x402.network).toBe('base-sepolia')
    expect(res._body.x402.token).toBe('USDC')
    expect(res._body.x402.receiver).toBe('0xABC')
  })

  it('passes through normally when payment verified', () => {
    const req = mockReq({ headers: { 'x-payment': '0xtx' } as any })
    const res = mockRes()
    middleware(req, res, next)

    res.locals.paymentRequired = {
      amount: '10',
      description: 'test',
      plateNumber: 'X',
      sessionId: 's',
    } satisfies PaymentRequired

    res.json({ session: 'closed' })

    expect(res._status).toBe(200)
    expect(res._body.session).toBe('closed')
  })

  it('passes through when no paymentRequired set', () => {
    const req = mockReq()
    const res = mockRes()
    middleware(req, res, next)

    res.json({ ok: true })

    expect(res._status).toBe(200)
    expect(res._body.ok).toBe(true)
  })
})
