import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'

// ---- Mock DB (vi.hoisted ensures mocks are available before vi.mock hoisting) ----
const mockDb = vi.hoisted(() => ({
  createDriver: vi.fn(),
  getDriverByPlate: vi.fn(),
  getDriverByWallet: vi.fn(),
  updateDriver: vi.fn(),
  deactivateDriver: vi.fn(),
  createSession: vi.fn(),
  getActiveSession: vi.fn(),
  getActiveSessionsByLot: vi.fn(),
  endSession: vi.fn(),
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
  hasSettlementForTxHash: vi.fn(),
  getMedianFeeForLot: vi.fn(),
  beginIdempotency: vi.fn(),
  completeIdempotency: vi.fn(),
  getXrplIntentByTxHash: vi.fn(),
  getActiveXrplPendingIntent: vi.fn(),
  resolveXrplIntentByPaymentId: vi.fn(),
  upsertXrplPendingIntent: vi.fn(),
}))

vi.mock('../db', () => ({ db: mockDb, pool: { query: vi.fn(), on: vi.fn() } }))

// ---- Mock services ----
vi.mock('../services/hedera', () => ({
  isHederaEnabled: () => false,
  mintParkingNFTOnHedera: vi.fn(),
  endParkingSessionOnHedera: vi.fn(),
  findActiveSessionOnHedera: vi.fn(),
}))

vi.mock('../services/blockchain', () => ({
  isBaseEnabled: () => false,
  isDriverRegisteredOnChain: vi.fn().mockResolvedValue(false),
  getDriverOnChain: vi.fn().mockResolvedValue(null),
}))

vi.mock('../services/stripe', () => ({
  isStripeEnabled: () => false,
  createParkingCheckout: vi.fn(),
  verifyWebhookSignature: vi.fn(),
}))

vi.mock('../services/pricing', () => ({
  convertToStablecoin: vi.fn((fee: number) => fee),
  X402_STABLECOIN: 'USDC',
  X402_NETWORK: 'base-sepolia',
  getFxRate: vi.fn().mockReturnValue(1),
}))

// ---- Mock WebSocket ----
vi.mock('../ws/index', () => ({
  setupWebSocket: vi.fn(),
  notifyGate: vi.fn(),
  notifyDriver: vi.fn(),
}))

// ---- Mock x402 middleware (pass-through) ----
vi.mock('@parker/x402', () => ({
  createPaymentMiddleware: () => (_req: any, _res: any, next: any) => next(),
}))

// ---- Mock ALPR ----
vi.mock('@parker/alpr', () => ({
  recognizePlate: vi.fn().mockResolvedValue(null),
}))

// ---- Import app AFTER mocks ----
import { createApp } from '../app'

let app: Express

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.beginIdempotency.mockResolvedValue({ status: 'started' })
  mockDb.completeIdempotency.mockResolvedValue(undefined)
  mockDb.getFiatSpendTotalsByCurrency.mockResolvedValue({ dayTotalFiat: 0, sessionTotalFiat: 0 })
  mockDb.getSpendTotalsFiat.mockResolvedValue({ dayTotalFiat: 0, sessionTotalFiat: 0 })
  mockDb.getPolicyGrantExpiresAt.mockResolvedValue(null)
  mockDb.getPolicyGrantByGrantId.mockResolvedValue(null)
  mockDb.insertPolicyGrant.mockResolvedValue({ grantId: 'grant-1' })
  mockDb.insertPolicyEvent.mockResolvedValue(undefined)
  mockDb.insertPolicyDecision.mockResolvedValue(undefined)
  mockDb.hasSettlementForTxHash.mockResolvedValue(false)
  mockDb.getMedianFeeForLot.mockResolvedValue(null)
  app = createApp()
})

// ---- Test data fixtures ----

const TEST_WALLET = '0x1234567890abcdef1234567890abcdef12345678'
const TEST_PLATE = 'ABC1234'
const TEST_LOT_ID = 'lot-1'

const mockDriver = {
  id: 'driver-1',
  wallet: TEST_WALLET,
  plateNumber: TEST_PLATE,
  countryCode: 'US',
  carMake: 'Tesla',
  carModel: 'Model 3',
  active: true,
  createdAt: new Date(),
}

const mockLot = {
  id: TEST_LOT_ID,
  name: 'Test Lot',
  address: '123 Main St',
  capacity: 100,
  ratePerHour: 12,
  billingMinutes: 15,
  maxDailyFee: undefined,
  currency: 'USD',
  paymentMethods: ['stripe', 'x402'],
  operatorWallet: '0xoperator',
}

const mockSession = {
  id: 'session-1',
  tokenId: null,
  plateNumber: TEST_PLATE,
  lotId: TEST_LOT_ID,
  entryTime: new Date(Date.now() - 60 * 60 * 1000), // 1 hour ago
  exitTime: null,
  feeAmount: undefined,
  feeCurrency: undefined,
  stripePaymentId: undefined,
  txHash: undefined,
  status: 'active' as const,
}

// ============================================
// Health Check
// ============================================

describe('GET /api/health', () => {
  it('returns status ok', async () => {
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
    expect(res.body).toHaveProperty('timestamp')
    expect(res.body.hedera).toBe('disabled')
    expect(res.body.base).toBe('disabled')
    expect(res.body.stripe).toBe('disabled')
  })
})

// ============================================
// Auth (EIP-4361 / SIWE)
// ============================================

describe('Auth', () => {
  describe('GET /api/auth/nonce', () => {
    it('returns a nonce string', async () => {
      const res = await request(app).get('/api/auth/nonce')
      expect(res.status).toBe(200)
      expect(res.body.nonce).toBeDefined()
      expect(typeof res.body.nonce).toBe('string')
      expect(res.body.nonce.length).toBeGreaterThan(0)
    })

    it('returns unique nonces on each call', async () => {
      const res1 = await request(app).get('/api/auth/nonce')
      const res2 = await request(app).get('/api/auth/nonce')
      expect(res1.body.nonce).not.toBe(res2.body.nonce)
    })
  })

  describe('POST /api/auth/verify', () => {
    it('rejects missing message/signature', async () => {
      const res = await request(app).post('/api/auth/verify').send({})
      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/message and signature/)
    })

    it('rejects invalid SIWE message', async () => {
      const res = await request(app)
        .post('/api/auth/verify')
        .send({ message: 'not-a-siwe-message', signature: '0xfake' })
      expect(res.status).toBe(401)
    })
  })
})

// ============================================
// Driver Registration
// ============================================

describe('Drivers', () => {
  describe('POST /api/drivers/register', () => {
    it('registers a new driver with wallet header', async () => {
      mockDb.createDriver.mockResolvedValue(mockDriver)

      const res = await request(app)
        .post('/api/drivers/register')
        .set('x-wallet-address', TEST_WALLET)
        .send({
          plateNumber: TEST_PLATE,
          countryCode: 'US',
          carMake: 'Tesla',
          carModel: 'Model 3',
        })

      expect(res.status).toBe(201)
      expect(res.body.wallet).toBe(TEST_WALLET)
      expect(res.body.plateNumber).toBe(TEST_PLATE)
      expect(mockDb.createDriver).toHaveBeenCalledWith(
        expect.objectContaining({
          wallet: TEST_WALLET,
          plateNumber: TEST_PLATE,
          countryCode: 'US',
        }),
      )
    })

    it('rejects registration without wallet', async () => {
      const res = await request(app).post('/api/drivers/register').send({
        plateNumber: TEST_PLATE,
        countryCode: 'US',
        carMake: 'Tesla',
        carModel: 'Model 3',
      })

      expect(res.status).toBe(401)
    })

    it('rejects missing required fields', async () => {
      const res = await request(app)
        .post('/api/drivers/register')
        .set('x-wallet-address', TEST_WALLET)
        .send({ carMake: 'Tesla' })

      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/plateNumber/)
    })

    it('handles duplicate plate conflict', async () => {
      mockDb.createDriver.mockRejectedValue({ code: '23505' })

      const res = await request(app)
        .post('/api/drivers/register')
        .set('x-wallet-address', TEST_WALLET)
        .send({
          plateNumber: TEST_PLATE,
          countryCode: 'US',
          carMake: 'Tesla',
          carModel: 'Model 3',
        })

      expect(res.status).toBe(409)
      expect(res.body.error).toMatch(/already registered/)
    })
  })

  describe('GET /api/drivers/:plate', () => {
    it('returns driver profile', async () => {
      mockDb.getDriverByPlate.mockResolvedValue(mockDriver)

      const res = await request(app).get(`/api/drivers/${TEST_PLATE}`)
      expect(res.status).toBe(200)
      expect(res.body.plateNumber).toBe(TEST_PLATE)
    })

    it('returns 404 for unknown plate', async () => {
      mockDb.getDriverByPlate.mockResolvedValue(null)

      const res = await request(app).get('/api/drivers/UNKNOWN')
      expect(res.status).toBe(404)
    })
  })

  describe('GET /api/drivers/wallet/:address', () => {
    it('returns driver by wallet', async () => {
      mockDb.getDriverByWallet.mockResolvedValue(mockDriver)

      const res = await request(app).get(`/api/drivers/wallet/${TEST_WALLET}`)
      expect(res.status).toBe(200)
      expect(res.body.wallet).toBe(TEST_WALLET)
    })

    it('returns 404 for unknown wallet', async () => {
      mockDb.getDriverByWallet.mockResolvedValue(null)

      const res = await request(app).get('/api/drivers/wallet/0xunknown')
      expect(res.status).toBe(404)
    })
  })

  describe('DELETE /api/drivers/:plate', () => {
    it('deactivates a driver', async () => {
      mockDb.deactivateDriver.mockResolvedValue(true)

      const res = await request(app).delete(`/api/drivers/${TEST_PLATE}`)
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('returns 404 for unknown plate', async () => {
      mockDb.deactivateDriver.mockResolvedValue(false)

      const res = await request(app).delete('/api/drivers/UNKNOWN')
      expect(res.status).toBe(404)
    })
  })
})

// ============================================
// Gate Operations
// ============================================

describe('Gate', () => {
  describe('POST /api/gate/entry', () => {
    it('processes vehicle entry', async () => {
      mockDb.getLot.mockResolvedValue(mockLot)
      mockDb.getDriverByPlate.mockResolvedValue(mockDriver)
      mockDb.getActiveSessionsByLot.mockResolvedValue([])
      mockDb.getActiveSession.mockResolvedValue(null)
      mockDb.createSession.mockResolvedValue(mockSession)

      const res = await request(app)
        .post('/api/gate/entry')
        .send({ plateNumber: TEST_PLATE, lotId: TEST_LOT_ID })

      expect(res.status).toBe(201)
      expect(res.body.session).toBeDefined()
      expect(res.body.session.plateNumber).toBe(TEST_PLATE)
    })

    it('rejects entry without lotId', async () => {
      const res = await request(app).post('/api/gate/entry').send({ plateNumber: TEST_PLATE })

      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/lotId/)
    })

    it('rejects entry without plate', async () => {
      const res = await request(app).post('/api/gate/entry').send({ lotId: TEST_LOT_ID })

      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/plate/)
    })

    it('rejects unregistered driver', async () => {
      mockDb.getLot.mockResolvedValue(mockLot)
      mockDb.getDriverByPlate.mockResolvedValue(null)

      const res = await request(app)
        .post('/api/gate/entry')
        .send({ plateNumber: 'UNKNOWN', lotId: TEST_LOT_ID })

      expect(res.status).toBe(404)
      expect(res.body.error).toMatch(/not registered/)
    })

    it('rejects entry when lot is full', async () => {
      mockDb.getLot.mockResolvedValue({ ...mockLot, capacity: 1 })
      mockDb.getDriverByPlate.mockResolvedValue(mockDriver)
      mockDb.getActiveSessionsByLot.mockResolvedValue([mockSession])

      const res = await request(app)
        .post('/api/gate/entry')
        .send({ plateNumber: TEST_PLATE, lotId: TEST_LOT_ID })

      expect(res.status).toBe(409)
      expect(res.body.error).toMatch(/full/)
    })

    it('rejects duplicate active session', async () => {
      mockDb.getLot.mockResolvedValue(mockLot)
      mockDb.getDriverByPlate.mockResolvedValue(mockDriver)
      mockDb.getActiveSessionsByLot.mockResolvedValue([])
      mockDb.getActiveSession.mockResolvedValue(mockSession)

      const res = await request(app)
        .post('/api/gate/entry')
        .send({ plateNumber: TEST_PLATE, lotId: TEST_LOT_ID })

      expect(res.status).toBe(409)
      expect(res.body.error).toMatch(/already has active session/)
    })

    it('rejects unknown lot', async () => {
      mockDb.getLot.mockResolvedValue(null)

      const res = await request(app)
        .post('/api/gate/entry')
        .send({ plateNumber: TEST_PLATE, lotId: 'nonexistent' })

      expect(res.status).toBe(404)
      expect(res.body.error).toMatch(/Lot not found/)
    })
  })

  describe('POST /api/gate/exit', () => {
    it('processes vehicle exit with fee calculation', async () => {
      mockDb.getActiveSession.mockResolvedValue(mockSession)
      mockDb.getLot.mockResolvedValue(mockLot)
      mockDb.endSession.mockResolvedValue({
        ...mockSession,
        status: 'completed',
        exitTime: new Date(),
        feeAmount: 12,
        feeCurrency: 'USD',
      })

      const res = await request(app)
        .post('/api/gate/exit')
        .send({ plateNumber: TEST_PLATE, lotId: TEST_LOT_ID })

      expect(res.status).toBe(200)
      expect(res.body.fee).toBeDefined()
      expect(res.body.fee).toBeGreaterThan(0)
      expect(res.body.currency).toBe('USD')
      expect(res.body.durationMinutes).toBeGreaterThan(0)
    })

    it('rejects exit without lotId', async () => {
      const res = await request(app).post('/api/gate/exit').send({ plateNumber: TEST_PLATE })

      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/lotId/)
    })

    it('rejects exit for non-parked vehicle', async () => {
      mockDb.getActiveSession.mockResolvedValue(null)

      const res = await request(app)
        .post('/api/gate/exit')
        .send({ plateNumber: 'UNKNOWN', lotId: TEST_LOT_ID })

      expect(res.status).toBe(404)
      expect(res.body.error).toMatch(/No active session/)
    })

    it('rejects exit with lot mismatch', async () => {
      mockDb.getActiveSession.mockResolvedValue({
        ...mockSession,
        lotId: 'other-lot',
      })

      const res = await request(app)
        .post('/api/gate/exit')
        .send({ plateNumber: TEST_PLATE, lotId: TEST_LOT_ID })

      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/mismatch/)
    })
  })

  describe('GET /api/gate/lot/:lotId/status', () => {
    it('returns lot status with occupancy', async () => {
      mockDb.getLot.mockResolvedValue(mockLot)
      mockDb.getActiveSessionsByLot.mockResolvedValue([mockSession])

      const res = await request(app).get(`/api/gate/lot/${TEST_LOT_ID}/status`)
      expect(res.status).toBe(200)
      expect(res.body.lotId).toBe(TEST_LOT_ID)
      expect(res.body.name).toBe('Test Lot')
      expect(res.body.address).toBe('123 Main St')
      expect(res.body.currentOccupancy).toBe(1)
      expect(res.body.capacity).toBe(100)
      expect(res.body.ratePerHour).toBe(12)
    })

    it('returns 404 for unknown lot', async () => {
      mockDb.getLot.mockResolvedValue(null)

      const res = await request(app).get('/api/gate/lot/nonexistent/status')
      expect(res.status).toBe(404)
    })
  })

  describe('GET /api/gate/lot/:lotId/sessions', () => {
    it('returns active sessions for a lot', async () => {
      mockDb.getActiveSessionsByLot.mockResolvedValue([mockSession])

      const res = await request(app).get(`/api/gate/lot/${TEST_LOT_ID}/sessions`)
      expect(res.status).toBe(200)
      expect(res.body).toHaveLength(1)
      expect(res.body[0].plateNumber).toBe(TEST_PLATE)
    })

    it('returns empty array for lot with no sessions', async () => {
      mockDb.getActiveSessionsByLot.mockResolvedValue([])

      const res = await request(app).get(`/api/gate/lot/${TEST_LOT_ID}/sessions`)
      expect(res.status).toBe(200)
      expect(res.body).toHaveLength(0)
    })
  })
})

// ============================================
// Sessions
// ============================================

describe('Sessions', () => {
  describe('GET /api/sessions/active/:plate', () => {
    it('returns active session', async () => {
      mockDb.getActiveSession.mockResolvedValue(mockSession)

      const res = await request(app).get(`/api/sessions/active/${TEST_PLATE}`)
      expect(res.status).toBe(200)
      expect(res.body.plateNumber).toBe(TEST_PLATE)
      expect(res.body.status).toBe('active')
    })

    it('returns 404 when no active session', async () => {
      mockDb.getActiveSession.mockResolvedValue(null)

      const res = await request(app).get('/api/sessions/active/NOPE')
      expect(res.status).toBe(404)
    })
  })

  describe('GET /api/sessions/history/:plate', () => {
    it('returns session history', async () => {
      const completedSession = {
        ...mockSession,
        status: 'completed',
        exitTime: new Date(),
        feeAmount: 12,
        feeCurrency: 'USD',
      }
      mockDb.getSessionHistory.mockResolvedValue([completedSession])

      const res = await request(app).get(`/api/sessions/history/${TEST_PLATE}`)
      expect(res.status).toBe(200)
      expect(res.body).toHaveLength(1)
    })

    it('respects limit parameter', async () => {
      mockDb.getSessionHistory.mockResolvedValue([])

      await request(app).get(`/api/sessions/history/${TEST_PLATE}?limit=10&offset=5`)
      expect(mockDb.getSessionHistory).toHaveBeenCalledWith(expect.any(String), 10, 5)
    })
  })
})
