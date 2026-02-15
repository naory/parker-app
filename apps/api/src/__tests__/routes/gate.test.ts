import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { gateRouter } from '../../routes/gate'

// Mock dependencies
vi.mock('../../db', () => ({
  db: {
    getLot: vi.fn(),
    getDriverByPlate: vi.fn(),
    getActiveSession: vi.fn(),
    getActiveSessionsByLot: vi.fn(),
    createSession: vi.fn(),
    endSession: vi.fn(),
    updateLot: vi.fn(),
  },
}))

vi.mock('../../ws/index', () => ({
  notifyGate: vi.fn(),
  notifyDriver: vi.fn(),
}))

vi.mock('../../services/hedera', () => ({
  isHederaEnabled: vi.fn(() => false),
  mintParkingNFTOnHedera: vi.fn(),
  endParkingSessionOnHedera: vi.fn(),
}))

vi.mock('../../services/pricing', () => ({
  convertToStablecoin: vi.fn(() => 10),
  X402_STABLECOIN: 'USDC',
  X402_NETWORK: 'base-sepolia',
}))

vi.mock('../../services/stripe', () => ({
  isStripeEnabled: vi.fn(() => false),
  createParkingCheckout: vi.fn(),
}))

vi.mock('@parker/alpr', () => ({
  recognizePlate: vi.fn(),
}))

import { db } from '../../db'

const mockLot = {
  id: 'LOT-1',
  name: 'Test Lot',
  address: '123 Main St',
  capacity: 100,
  ratePerHour: 8,
  billingMinutes: 15,
  maxDailyFee: 50,
  currency: 'USD',
  paymentMethods: ['x402'],
  operatorWallet: '0xOP',
}

const mockDriver = {
  id: 'uuid-1',
  wallet: '0xABC',
  plateNumber: '1234567',
  countryCode: 'IL',
  active: true,
  createdAt: new Date(),
}

function createApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/gate', gateRouter)
  return app
}

describe('gate routes', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('POST /api/gate/entry', () => {
    it('creates entry session', async () => {
      vi.mocked(db.getLot).mockResolvedValue(mockLot)
      vi.mocked(db.getDriverByPlate).mockResolvedValue(mockDriver)
      vi.mocked(db.getActiveSession).mockResolvedValue(null)
      vi.mocked(db.getActiveSessionsByLot).mockResolvedValue([])
      vi.mocked(db.createSession).mockResolvedValue({
        id: 's1',
        plateNumber: '1234567',
        lotId: 'LOT-1',
        entryTime: new Date(),
        status: 'active',
      })

      const app = createApp()
      const res = await request(app)
        .post('/api/gate/entry')
        .send({ plateNumber: '1234567', lotId: 'LOT-1' })

      expect(res.status).toBe(201)
      expect(res.body.session.id).toBe('s1')
    })

    it('returns 400 without lotId', async () => {
      const app = createApp()
      const res = await request(app)
        .post('/api/gate/entry')
        .send({ plateNumber: '1234567' })

      expect(res.status).toBe(400)
    })

    it('returns 400 without plate or image', async () => {
      const app = createApp()
      const res = await request(app)
        .post('/api/gate/entry')
        .send({ lotId: 'LOT-1' })

      expect(res.status).toBe(400)
    })

    it('returns 404 for unknown lot', async () => {
      vi.mocked(db.getLot).mockResolvedValue(null)

      const app = createApp()
      const res = await request(app)
        .post('/api/gate/entry')
        .send({ plateNumber: '1234567', lotId: 'UNKNOWN' })

      expect(res.status).toBe(404)
    })

    it('returns 404 for unregistered driver', async () => {
      vi.mocked(db.getLot).mockResolvedValue(mockLot)
      vi.mocked(db.getDriverByPlate).mockResolvedValue(null)

      const app = createApp()
      const res = await request(app)
        .post('/api/gate/entry')
        .send({ plateNumber: '1234567', lotId: 'LOT-1' })

      expect(res.status).toBe(404)
    })

    it('returns 409 when lot is full', async () => {
      vi.mocked(db.getLot).mockResolvedValue({ ...mockLot, capacity: 1 })
      vi.mocked(db.getDriverByPlate).mockResolvedValue(mockDriver)
      vi.mocked(db.getActiveSessionsByLot).mockResolvedValue([{ id: 's0' } as any])

      const app = createApp()
      const res = await request(app)
        .post('/api/gate/entry')
        .send({ plateNumber: '1234567', lotId: 'LOT-1' })

      expect(res.status).toBe(409)
    })

    it('returns 409 when vehicle already parked', async () => {
      vi.mocked(db.getLot).mockResolvedValue(mockLot)
      vi.mocked(db.getDriverByPlate).mockResolvedValue(mockDriver)
      vi.mocked(db.getActiveSessionsByLot).mockResolvedValue([])
      vi.mocked(db.getActiveSession).mockResolvedValue({ id: 's0' } as any)

      const app = createApp()
      const res = await request(app)
        .post('/api/gate/entry')
        .send({ plateNumber: '1234567', lotId: 'LOT-1' })

      expect(res.status).toBe(409)
    })
  })

  describe('POST /api/gate/exit', () => {
    it('returns fee and payment options for unpaid exit', async () => {
      vi.mocked(db.getActiveSession).mockResolvedValue({
        id: 's1',
        plateNumber: '1234567',
        lotId: 'LOT-1',
        entryTime: new Date(Date.now() - 60 * 60 * 1000), // 1 hour ago
        status: 'active',
      })
      vi.mocked(db.getLot).mockResolvedValue(mockLot)

      const app = createApp()
      const res = await request(app)
        .post('/api/gate/exit')
        .send({ plateNumber: '1234567', lotId: 'LOT-1' })

      expect(res.status).toBe(200)
      expect(res.body.fee).toBeGreaterThan(0)
      expect(res.body.currency).toBe('USD')
      expect(res.body.paymentOptions).toBeDefined()
    })

    it('returns 404 when no active session', async () => {
      vi.mocked(db.getActiveSession).mockResolvedValue(null)

      const app = createApp()
      const res = await request(app)
        .post('/api/gate/exit')
        .send({ plateNumber: '1234567', lotId: 'LOT-1' })

      expect(res.status).toBe(404)
    })

    it('returns 400 for lot mismatch', async () => {
      vi.mocked(db.getActiveSession).mockResolvedValue({
        id: 's1',
        plateNumber: '1234567',
        lotId: 'LOT-1',
        entryTime: new Date(),
        status: 'active',
      })

      const app = createApp()
      const res = await request(app)
        .post('/api/gate/exit')
        .send({ plateNumber: '1234567', lotId: 'LOT-2' })

      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/mismatch/i)
    })
  })

  describe('GET /api/gate/lot/:lotId/status', () => {
    it('returns lot status', async () => {
      vi.mocked(db.getLot).mockResolvedValue(mockLot)
      vi.mocked(db.getActiveSessionsByLot).mockResolvedValue([])

      const app = createApp()
      const res = await request(app).get('/api/gate/lot/LOT-1/status')

      expect(res.status).toBe(200)
      expect(res.body.lotId).toBe('LOT-1')
      expect(res.body.currentOccupancy).toBe(0)
    })

    it('returns 404 for unknown lot', async () => {
      vi.mocked(db.getLot).mockResolvedValue(null)

      const app = createApp()
      const res = await request(app).get('/api/gate/lot/UNKNOWN/status')

      expect(res.status).toBe(404)
    })
  })

  describe('GET /api/gate/lot/:lotId/sessions', () => {
    it('returns active sessions for lot', async () => {
      vi.mocked(db.getActiveSessionsByLot).mockResolvedValue([
        { id: 's1', plateNumber: '1234567', lotId: 'LOT-1', entryTime: new Date(), status: 'active' },
      ])

      const app = createApp()
      const res = await request(app).get('/api/gate/lot/LOT-1/sessions')

      expect(res.status).toBe(200)
      expect(res.body).toHaveLength(1)
    })
  })

  describe('PUT /api/gate/lot/:lotId', () => {
    it('updates lot settings', async () => {
      vi.mocked(db.updateLot).mockResolvedValue({ ...mockLot, ratePerHour: 12 })

      const app = createApp()
      const res = await request(app)
        .put('/api/gate/lot/LOT-1')
        .send({ ratePerHour: 12 })

      expect(res.status).toBe(200)
      expect(res.body.ratePerHour).toBe(12)
    })

    it('returns 404 for unknown lot', async () => {
      vi.mocked(db.updateLot).mockResolvedValue(null)

      const app = createApp()
      const res = await request(app)
        .put('/api/gate/lot/UNKNOWN')
        .send({ name: 'New Name' })

      expect(res.status).toBe(404)
    })

    it('rejects NaN numeric values', async () => {
      const app = createApp()
      const res = await request(app)
        .put('/api/gate/lot/LOT-1')
        .send({ ratePerHour: 'abc' })

      expect(res.status).toBe(400)
    })
  })
})
