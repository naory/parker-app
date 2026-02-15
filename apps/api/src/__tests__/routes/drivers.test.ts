import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { driversRouter } from '../../routes/drivers'
import { verifyWallet } from '../../middleware/auth'

// Mock the db module
vi.mock('../../db', () => ({
  db: {
    createDriver: vi.fn(),
    getDriverByPlate: vi.fn(),
    getDriverByWallet: vi.fn(),
    updateDriver: vi.fn(),
    deactivateDriver: vi.fn(),
  },
}))

// Mock auth JWT verification (not needed for these tests)
vi.mock('../../routes/auth', () => ({
  verifyJwt: vi.fn().mockResolvedValue(null),
}))

import { db } from '../../db'

function createApp() {
  const app = express()
  app.use(express.json())
  app.use(verifyWallet)
  app.use('/api/drivers', driversRouter)
  return app
}

describe('drivers routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('POST /api/drivers/register', () => {
    it('creates a driver and returns 201', async () => {
      const mockDriver = {
        id: 'uuid-1',
        wallet: '0xABC',
        plateNumber: '1234567',
        countryCode: 'IL',
        carMake: 'Toyota',
        carModel: 'Corolla',
        active: true,
        createdAt: new Date(),
      }
      vi.mocked(db.createDriver).mockResolvedValue(mockDriver)

      const app = createApp()
      const res = await request(app)
        .post('/api/drivers/register')
        .set('x-wallet-address', '0xABC')
        .send({ plateNumber: '12-345-67', countryCode: 'IL', carMake: 'Toyota', carModel: 'Corolla' })

      expect(res.status).toBe(201)
      expect(res.body.plateNumber).toBe('1234567')
      expect(db.createDriver).toHaveBeenCalledWith(expect.objectContaining({
        wallet: '0xABC',
        plateNumber: '1234567',
      }))
    })

    it('returns 401 without wallet header', async () => {
      const app = createApp()
      const res = await request(app)
        .post('/api/drivers/register')
        .send({ plateNumber: '1234567', countryCode: 'IL' })

      expect(res.status).toBe(401)
      expect(res.body.error).toMatch(/wallet|auth/i)
    })

    it('returns 400 without required fields', async () => {
      const app = createApp()
      const res = await request(app)
        .post('/api/drivers/register')
        .set('x-wallet-address', '0xABC')
        .send({ carMake: 'Toyota' })

      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/required/i)
    })

    it('returns 409 for duplicate plate', async () => {
      vi.mocked(db.createDriver).mockRejectedValue({ code: '23505' })

      const app = createApp()
      const res = await request(app)
        .post('/api/drivers/register')
        .set('x-wallet-address', '0xABC')
        .send({ plateNumber: '1234567', countryCode: 'IL' })

      expect(res.status).toBe(409)
    })
  })

  describe('GET /api/drivers/:plate', () => {
    it('returns driver profile', async () => {
      vi.mocked(db.getDriverByPlate).mockResolvedValue({
        id: 'uuid-1',
        wallet: '0xABC',
        plateNumber: '1234567',
        countryCode: 'IL',
        active: true,
        createdAt: new Date(),
      })

      const app = createApp()
      const res = await request(app).get('/api/drivers/12-345-67')

      expect(res.status).toBe(200)
      expect(res.body.plateNumber).toBe('1234567')
      // Plate should be normalized (dashes stripped)
      expect(db.getDriverByPlate).toHaveBeenCalledWith('1234567')
    })

    it('returns 404 for unknown plate', async () => {
      vi.mocked(db.getDriverByPlate).mockResolvedValue(null)

      const app = createApp()
      const res = await request(app).get('/api/drivers/9999999')

      expect(res.status).toBe(404)
    })
  })

  describe('GET /api/drivers/wallet/:address', () => {
    it('returns driver by wallet', async () => {
      vi.mocked(db.getDriverByWallet).mockResolvedValue({
        id: 'uuid-1',
        wallet: '0xABC',
        plateNumber: '1234567',
        countryCode: 'IL',
        active: true,
        createdAt: new Date(),
      })

      const app = createApp()
      const res = await request(app).get('/api/drivers/wallet/0xABC')

      expect(res.status).toBe(200)
      expect(res.body.wallet).toBe('0xABC')
    })
  })

  describe('PUT /api/drivers/:plate', () => {
    it('updates driver profile', async () => {
      vi.mocked(db.updateDriver).mockResolvedValue({
        id: 'uuid-1',
        wallet: '0xABC',
        plateNumber: '1234567',
        countryCode: 'IL',
        carMake: 'Honda',
        carModel: 'Civic',
        active: true,
        createdAt: new Date(),
      })

      const app = createApp()
      const res = await request(app)
        .put('/api/drivers/1234567')
        .send({ carMake: 'Honda', carModel: 'Civic' })

      expect(res.status).toBe(200)
      expect(res.body.carMake).toBe('Honda')
    })

    it('returns 404 when driver not found', async () => {
      vi.mocked(db.updateDriver).mockResolvedValue(null)

      const app = createApp()
      const res = await request(app).put('/api/drivers/9999999').send({ carMake: 'Honda' })

      expect(res.status).toBe(404)
    })
  })

  describe('DELETE /api/drivers/:plate', () => {
    it('deactivates driver', async () => {
      vi.mocked(db.deactivateDriver).mockResolvedValue(true)

      const app = createApp()
      const res = await request(app).delete('/api/drivers/1234567')

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('returns 404 when driver not found', async () => {
      vi.mocked(db.deactivateDriver).mockResolvedValue(false)

      const app = createApp()
      const res = await request(app).delete('/api/drivers/9999999')

      expect(res.status).toBe(404)
    })
  })
})
