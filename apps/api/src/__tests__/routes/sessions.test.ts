import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { sessionsRouter } from '../../routes/sessions'

vi.mock('../../db', () => ({
  db: {
    getActiveSession: vi.fn(),
    getSessionHistory: vi.fn(),
  },
}))

import { db } from '../../db'

function createApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/sessions', sessionsRouter)
  return app
}

describe('sessions routes', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('GET /api/sessions/active/:plate', () => {
    it('returns active session', async () => {
      const session = {
        id: 's1',
        plateNumber: '1234567',
        lotId: 'LOT-1',
        entryTime: new Date(),
        status: 'active' as const,
      }
      vi.mocked(db.getActiveSession).mockResolvedValue(session)

      const app = createApp()
      const res = await request(app).get('/api/sessions/active/12-345-67')

      expect(res.status).toBe(200)
      expect(res.body.id).toBe('s1')
      expect(db.getActiveSession).toHaveBeenCalledWith('1234567')
    })

    it('returns 404 when no active session', async () => {
      vi.mocked(db.getActiveSession).mockResolvedValue(null)

      const app = createApp()
      const res = await request(app).get('/api/sessions/active/1234567')

      expect(res.status).toBe(404)
    })
  })

  describe('GET /api/sessions/history/:plate', () => {
    it('returns session history with defaults', async () => {
      vi.mocked(db.getSessionHistory).mockResolvedValue([])

      const app = createApp()
      const res = await request(app).get('/api/sessions/history/1234567')

      expect(res.status).toBe(200)
      expect(db.getSessionHistory).toHaveBeenCalledWith('1234567', 50, 0)
    })

    it('respects limit and offset params', async () => {
      vi.mocked(db.getSessionHistory).mockResolvedValue([])

      const app = createApp()
      const res = await request(app).get('/api/sessions/history/1234567?limit=10&offset=20')

      expect(res.status).toBe(200)
      expect(db.getSessionHistory).toHaveBeenCalledWith('1234567', 10, 20)
    })

    it('caps limit at 200', async () => {
      vi.mocked(db.getSessionHistory).mockResolvedValue([])

      const app = createApp()
      await request(app).get('/api/sessions/history/1234567?limit=999')

      expect(db.getSessionHistory).toHaveBeenCalledWith('1234567', 200, 0)
    })

    it('ignores invalid limit/offset', async () => {
      vi.mocked(db.getSessionHistory).mockResolvedValue([])

      const app = createApp()
      await request(app).get('/api/sessions/history/1234567?limit=abc&offset=-5')

      expect(db.getSessionHistory).toHaveBeenCalledWith('1234567', 50, 0)
    })
  })
})
