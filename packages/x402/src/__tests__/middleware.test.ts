import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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
  const originalNodeEnv = process.env.NODE_ENV

  beforeEach(() => {
    process.env.NODE_ENV = 'development'
    middleware = createPaymentMiddleware({
      network: 'base-sepolia',
      token: 'USDC',
      receiverWallet: '0xABC',
    })
    next = vi.fn()
  })

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv
  })

  it('calls next() always', async () => {
    const req = mockReq()
    const res = mockRes()
    await middleware(req, res, next)
    expect(next).toHaveBeenCalled()
  })

  it('sets paymentVerified when X-PAYMENT header present (dev mode, no publicClient)', async () => {
    const req = mockReq({ headers: { 'x-payment': '0xtxhash123' } as any })
    const res = mockRes()
    await middleware(req, res, next)
    expect((req as any).paymentVerified).toBe(true)
    expect((req as any).paymentTxHash).toBe('0xtxhash123')
  })

  it('returns 402 when paymentRequired is set and no payment header', async () => {
    const req = mockReq()
    const res = mockRes()
    await middleware(req, res, next)

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

  it('passes through normally when payment verified', async () => {
    const req = mockReq({ headers: { 'x-payment': '0xtx' } as any })
    const res = mockRes()
    await middleware(req, res, next)

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

  it('passes through when no paymentRequired set', async () => {
    const req = mockReq()
    const res = mockRes()
    await middleware(req, res, next)

    res.json({ ok: true })

    expect(res._status).toBe(200)
    expect(res._body.ok).toBe(true)
  })
})

describe('createPaymentMiddleware with publicClient', () => {
  it('rejects malformed transaction hash', async () => {
    const mockClient = {} as any
    const middleware = createPaymentMiddleware({
      receiverWallet: '0xABC',
      publicClient: mockClient,
    })
    const next = vi.fn()

    const req = mockReq({ headers: { 'x-payment': 'not-a-hash' } as any })
    const res = mockRes()
    await middleware(req, res, next)

    expect(res._status).toBe(400)
    expect(res._body.error).toBe('Invalid transaction hash format')
    expect(next).not.toHaveBeenCalled()
  })

  it('rejects when on-chain verification fails', async () => {
    const mockClient = {
      getTransactionReceipt: vi.fn().mockRejectedValue(new Error('tx not found')),
    } as any
    const middleware = createPaymentMiddleware({
      receiverWallet: '0xABC',
      publicClient: mockClient,
    })
    const next = vi.fn()

    const txHash = '0x' + 'ab'.repeat(32)
    const req = mockReq({ headers: { 'x-payment': txHash } as any })
    const res = mockRes()
    await middleware(req, res, next)

    expect(res._status).toBe(400)
    expect(res._body.error).toBe('Payment verification failed')
    expect(next).not.toHaveBeenCalled()
  })

  it('attaches paymentTransfer when verification succeeds', async () => {
    const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
    const from = '0x1111111111111111111111111111111111111111'
    const to = '0x2222222222222222222222222222222222222222'
    const amount = 10_000000n

    const padAddress = (addr: string) => '0x' + addr.replace('0x', '').toLowerCase().padStart(64, '0')

    const mockClient = {
      getTransactionReceipt: vi.fn().mockResolvedValue({
        status: 'success',
        logs: [{
          address: '0xtoken',
          topics: [TRANSFER_TOPIC, padAddress(from), padAddress(to)],
          data: '0x' + amount.toString(16).padStart(64, '0'),
        }],
      }),
    } as any

    const middleware = createPaymentMiddleware({
      receiverWallet: '0xABC',
      publicClient: mockClient,
    })
    const next = vi.fn()

    const txHash = '0x' + 'ab'.repeat(32)
    const req = mockReq({ headers: { 'x-payment': txHash } as any })
    const res = mockRes()
    await middleware(req, res, next)

    expect(next).toHaveBeenCalled()
    expect((req as any).paymentVerified).toBe(true)
    expect((req as any).paymentTransfer.amount).toBe(amount)
    expect((req as any).paymentTransfer.confirmed).toBe(true)
  })
})

describe('createPaymentMiddleware XRPL verification path', () => {
  it('rejects when XRPL adapter is missing', async () => {
    process.env.NODE_ENV = 'production'
    const middleware = createPaymentMiddleware({
      network: 'xrpl:testnet',
      receiverWallet: 'rDestination',
    })
    const next = vi.fn()
    const req = mockReq({ headers: { 'x-payment': 'A'.repeat(64) } as any })
    const res = mockRes()

    await middleware(req, res, next)

    expect(res._status).toBe(503)
    expect(res._body.error).toBe('XRPL settlement adapter is not configured')
    expect(next).not.toHaveBeenCalled()
  })

  it('rejects EVM-style tx hash on XRPL network without calling adapter', async () => {
    const settlementAdapter = {
      verifyPayment: vi.fn(),
    }
    const middleware = createPaymentMiddleware({
      network: 'xrpl:testnet',
      receiverWallet: 'rDestination',
      settlementAdapter,
    })
    const next = vi.fn()
    const req = mockReq({ headers: { 'x-payment': '0x' + 'ab'.repeat(32) } as any })
    const res = mockRes()

    await middleware(req, res, next)

    expect(res._status).toBe(400)
    expect(res._body.error).toBe('Invalid payment proof for XRPL network')
    expect(settlementAdapter.verifyPayment).not.toHaveBeenCalled()
    expect(next).not.toHaveBeenCalled()
  })
})
