import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'

const mockDb = vi.hoisted(() => ({
  createDriver: vi.fn(),
  getDriverByPlate: vi.fn(),
  getDriverByWallet: vi.fn(),
  updateDriver: vi.fn(),
  deactivateDriver: vi.fn(),
  createSession: vi.fn(),
  getActiveSession: vi.fn(),
  getActiveSessionsByLot: vi.fn(),
  settleSessionAfterVerified: vi.fn(),
  transitionSession: vi.fn(),
  getSessionHistory: vi.fn(),
  getLot: vi.fn(),
  updateLot: vi.fn(),
  insertPolicyGrant: vi.fn(),
  updateSessionPolicyGrant: vi.fn(),
  getPolicyGrantExpiresAt: vi.fn(),
  getPolicyGrantByGrantId: vi.fn(),
  getFiatSpendTotalsByCurrency: vi.fn(),
  getSpendTotalsFiat: vi.fn(),
  insertPolicyEvent: vi.fn(),
  insertPolicyDecision: vi.fn(),
  getDecisionPayloadByDecisionId: vi.fn(),
  consumeDecisionOnce: vi.fn(),
  hasSettlementForTxHash: vi.fn(),
  hasSettlementForDecisionRail: vi.fn(),
  getMedianFeeForLot: vi.fn(),
  beginIdempotency: vi.fn(),
  completeIdempotency: vi.fn(),
  getXrplIntentByTxHash: vi.fn(),
  getActiveXrplPendingIntent: vi.fn(),
  resolveXrplIntentByPaymentId: vi.fn(),
  upsertXrplPendingIntent: vi.fn(),
}))

const mockStripe = vi.hoisted(() => ({
  isStripeEnabled: vi.fn(),
  verifyWebhookSignature: vi.fn(),
}))

const mockPolicy = vi.hoisted(() => ({
  enforceOrReject: vi.fn(),
}))

vi.mock('../src/db', () => ({ db: mockDb, pool: { query: vi.fn(), on: vi.fn() } }))
vi.mock('../src/services/stripe', () => mockStripe)
vi.mock('../src/services/policy', () => mockPolicy)
vi.mock('../src/services/hedera', () => ({
  isHederaEnabled: () => false,
  endParkingSessionOnHedera: vi.fn(),
  findActiveSessionOnHedera: vi.fn(),
  mintParkingNFTOnHedera: vi.fn(),
}))
vi.mock('../src/services/blockchain', () => ({
  isBaseEnabled: () => false,
  isDriverRegisteredOnChain: vi.fn().mockResolvedValue(false),
  getDriverOnChain: vi.fn().mockResolvedValue(null),
}))
vi.mock('../src/services/pricing', () => ({
  convertToStablecoin: vi.fn((fee: number) => fee),
  X402_STABLECOIN: 'USDC',
  X402_NETWORK: 'base-sepolia',
  getFxRate: vi.fn().mockReturnValue(1),
}))
vi.mock('../src/ws/index', () => ({
  setupWebSocket: vi.fn(),
  notifyGate: vi.fn(),
  notifyDriver: vi.fn(),
}))
vi.mock('@parker/x402', () => ({
  createPaymentMiddleware: () => (_req: any, _res: any, next: any) => next(),
}))
vi.mock('@parker/alpr', () => ({
  recognizePlate: vi.fn().mockResolvedValue(null),
}))

import { createApp } from '../src/app'

let app: Express

const stripeEvent = {
  id: 'evt_1',
  type: 'checkout.session.completed',
  data: {
    object: {
      id: 'cs_test_1',
      amount_total: 1500,
      metadata: {
        sessionId: 'sess-1',
        plateNumber: 'ABC123',
        lotId: 'LOT-1',
        feeCurrency: 'USD',
        decisionId: 'dec-1',
      },
    },
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  app = createApp()

  mockStripe.isStripeEnabled.mockReturnValue(true)
  mockStripe.verifyWebhookSignature.mockReturnValue(stripeEvent as any)
  mockPolicy.enforceOrReject.mockResolvedValue({ allowed: true })

  mockDb.hasSettlementForTxHash.mockResolvedValue(false)
  mockDb.hasSettlementForDecisionRail.mockResolvedValue(false)
  mockDb.consumeDecisionOnce.mockResolvedValue(true)
  mockDb.insertPolicyEvent.mockResolvedValue(undefined)
  mockDb.settleSessionAfterVerified.mockResolvedValue({
    id: 'sess-1',
    lotId: 'LOT-1',
    plateNumber: 'ABC123',
    entryTime: new Date(Date.now() - 60_000),
    exitTime: new Date(),
    feeCurrency: 'USD',
  })
  mockDb.getActiveSession.mockResolvedValue({
    id: 'sess-1',
    lotId: 'LOT-1',
    plateNumber: 'ABC123',
    tokenId: null,
    policyGrantId: 'grant-1',
    policyHash: 'ph-1',
    entryTime: new Date(Date.now() - 60_000),
    status: 'active',
  })
})

describe('stripe webhook hardening', () => {
  it('same webhook delivered twice is idempotent (no double close)', async () => {
    mockDb.hasSettlementForTxHash.mockResolvedValueOnce(false).mockResolvedValueOnce(true)

    const body = Buffer.from('raw')
    const first = await request(app)
      .post('/api/webhooks/stripe')
      .set('stripe-signature', 'sig')
      .set('content-type', 'application/json')
      .send(body)
    const second = await request(app)
      .post('/api/webhooks/stripe')
      .set('stripe-signature', 'sig')
      .set('content-type', 'application/json')
      .send(body)

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(mockDb.settleSessionAfterVerified).toHaveBeenCalledTimes(1)
  })

  it('webhook for already-closed session returns 200 no-op', async () => {
    mockDb.getActiveSession.mockResolvedValueOnce(null)

    const res = await request(app)
      .post('/api/webhooks/stripe')
      .set('stripe-signature', 'sig')
      .set('content-type', 'application/json')
      .send(Buffer.from('raw'))

    expect(res.status).toBe(200)
    expect(mockDb.settleSessionAfterVerified).not.toHaveBeenCalled()
  })

  it('amount mismatch rejects via enforcement and does not close', async () => {
    mockPolicy.enforceOrReject.mockResolvedValueOnce({
      allowed: false,
      reason: 'CAP_EXCEEDED_TX',
    })

    const res = await request(app)
      .post('/api/webhooks/stripe')
      .set('stripe-signature', 'sig')
      .set('content-type', 'application/json')
      .send(Buffer.from('raw'))

    expect(res.status).toBe(200)
    expect(mockDb.settleSessionAfterVerified).not.toHaveBeenCalled()
    expect(mockDb.insertPolicyEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'SETTLEMENT_REJECTED',
        payload: expect.objectContaining({ reason: 'CAP_EXCEEDED_TX' }),
      }),
    )
  })

  it('metadata mismatch (wrong session) is ignored with 200 and does not close', async () => {
    mockStripe.verifyWebhookSignature.mockReturnValueOnce({
      ...stripeEvent,
      data: {
        object: {
          ...stripeEvent.data.object,
          metadata: {
            ...stripeEvent.data.object.metadata,
            sessionId: 'sess-wrong',
          },
        },
      },
    } as any)

    const res = await request(app)
      .post('/api/webhooks/stripe')
      .set('stripe-signature', 'sig')
      .set('content-type', 'application/json')
      .send(Buffer.from('raw'))

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ received: true, ignored: true, reason: 'metadata_mismatch' })
    expect(mockDb.settleSessionAfterVerified).not.toHaveBeenCalled()
  })

  it('metadata missing returns 400 and does not close', async () => {
    mockStripe.verifyWebhookSignature.mockReturnValueOnce({
      ...stripeEvent,
      data: {
        object: {
          ...stripeEvent.data.object,
          metadata: {
            ...stripeEvent.data.object.metadata,
            sessionId: undefined,
          },
        },
      },
    } as any)

    const res = await request(app)
      .post('/api/webhooks/stripe')
      .set('stripe-signature', 'sig')
      .set('content-type', 'application/json')
      .send(Buffer.from('raw'))

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/missing session metadata/i)
    expect(mockDb.settleSessionAfterVerified).not.toHaveBeenCalled()
  })

  it('calls enforcement before closing session', async () => {
    const res = await request(app)
      .post('/api/webhooks/stripe')
      .set('stripe-signature', 'sig')
      .set('content-type', 'application/json')
      .send(Buffer.from('raw'))

    expect(res.status).toBe(200)
    expect(mockPolicy.enforceOrReject).toHaveBeenCalled()
    expect(mockDb.settleSessionAfterVerified).toHaveBeenCalled()

    const enforceOrder = mockPolicy.enforceOrReject.mock.invocationCallOrder[0]
    const closeOrder = mockDb.settleSessionAfterVerified.mock.invocationCallOrder[0]
    expect(enforceOrder).toBeLessThan(closeOrder)
  })

  it('does not close when decision was already consumed', async () => {
    mockDb.consumeDecisionOnce.mockResolvedValueOnce(false)

    const res = await request(app)
      .post('/api/webhooks/stripe')
      .set('stripe-signature', 'sig')
      .set('content-type', 'application/json')
      .send(Buffer.from('raw'))

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ received: true, ignored: true, reason: 'decision_already_consumed' })
    expect(mockDb.settleSessionAfterVerified).not.toHaveBeenCalled()
  })
})
