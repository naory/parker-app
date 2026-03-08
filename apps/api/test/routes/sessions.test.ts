import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { sessionsRouter } from '../../src/routes/sessions'

vi.mock('../../src/db', () => ({
  db: {
    getActiveSession: vi.fn(),
    getSessionState: vi.fn(),
    getSessionHistory: vi.fn(),
    getSessionTimeline: vi.fn(),
  },
}))

import { db } from '../../src/db'

function createApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/sessions', sessionsRouter)
  return app
}

describe('sessions routes', () => {
  const originalTimelineApiKey = process.env.SESSION_TIMELINE_API_KEY
  const originalGateApiKey = process.env.GATE_API_KEY

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.SESSION_TIMELINE_API_KEY
    delete process.env.GATE_API_KEY
  })
  afterEach(() => {
    if (originalTimelineApiKey === undefined) {
      delete process.env.SESSION_TIMELINE_API_KEY
    } else {
      process.env.SESSION_TIMELINE_API_KEY = originalTimelineApiKey
    }
    if (originalGateApiKey === undefined) {
      delete process.env.GATE_API_KEY
    } else {
      process.env.GATE_API_KEY = originalGateApiKey
    }
  })

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

  describe('GET /api/sessions/:sessionId/timeline', () => {
    const sessionId = '11111111-1111-4111-8111-111111111111'

    it('returns ordered timeline events with default limit', async () => {
      vi.mocked(db.getSessionState).mockResolvedValue('payment_required')
      vi.mocked(db.getSessionTimeline).mockResolvedValue([
        {
          id: 'evt-1',
          sessionId,
          eventType: 'SESSION.CREATED',
          timestamp: new Date('2026-03-07T09:11:02.000Z'),
          metadata: { plateNumber: '1234567' },
        } as any,
        {
          id: 'evt-2',
          sessionId,
          eventType: 'SESSION.CLOSED',
          timestamp: new Date('2026-03-07T09:18:46.000Z'),
          metadata: {},
        } as any,
      ])

      const app = createApp()
      const res = await request(app).get(`/api/sessions/${sessionId}/timeline`)

      expect(res.status).toBe(200)
      expect(db.getSessionState).toHaveBeenCalledWith(sessionId)
      expect(db.getSessionTimeline).toHaveBeenCalledWith(sessionId, 500)
      expect(res.body).toEqual({
        sessionId,
        state: 'payment_required',
        eventCount: 2,
        events: [
          {
            eventType: 'SESSION.CREATED',
            createdAt: '2026-03-07T09:11:02.000Z',
            metadata: { plateNumber: '1234567' },
          },
          {
            eventType: 'SESSION.CLOSED',
            createdAt: '2026-03-07T09:18:46.000Z',
            metadata: {},
          },
        ],
      })
    })

    it('respects and caps timeline limit', async () => {
      vi.mocked(db.getSessionState).mockResolvedValue('active')
      vi.mocked(db.getSessionTimeline).mockResolvedValue([])
      const app = createApp()

      await request(app).get(`/api/sessions/${sessionId}/timeline?limit=1500`)
      expect(db.getSessionTimeline).toHaveBeenCalledWith(sessionId, 1000)

      await request(app).get(`/api/sessions/${sessionId}/timeline?limit=10`)
      expect(db.getSessionTimeline).toHaveBeenCalledWith(sessionId, 10)
    })

    it('returns 400 for malformed sessionId', async () => {
      const app = createApp()
      const res = await request(app).get('/api/sessions/not-a-uuid/timeline')

      expect(res.status).toBe(400)
      expect(db.getSessionState).not.toHaveBeenCalled()
      expect(db.getSessionTimeline).not.toHaveBeenCalled()
    })

    it('returns 401 when timeline internal API key is configured but missing', async () => {
      process.env.SESSION_TIMELINE_API_KEY = 'internal-key-1'
      const app = createApp()
      const res = await request(app).get(`/api/sessions/${sessionId}/timeline`)

      expect(res.status).toBe(401)
      expect(db.getSessionState).not.toHaveBeenCalled()
      expect(db.getSessionTimeline).not.toHaveBeenCalled()
    })

    it('returns 404 for missing session', async () => {
      vi.mocked(db.getSessionState).mockResolvedValue(null)
      const app = createApp()
      const res = await request(app).get(`/api/sessions/${sessionId}/timeline`)

      expect(res.status).toBe(404)
      expect(db.getSessionTimeline).not.toHaveBeenCalled()
    })

    it('returns 200 with empty events for existing session with no timeline rows', async () => {
      vi.mocked(db.getSessionState).mockResolvedValue('active')
      vi.mocked(db.getSessionTimeline).mockResolvedValue([])
      const app = createApp()
      const res = await request(app).get(`/api/sessions/${sessionId}/timeline`)

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ sessionId, state: 'active', eventCount: 0, events: [] })
    })

    it('preserves db event order when timestamps are identical', async () => {
      vi.mocked(db.getSessionState).mockResolvedValue('closed')
      vi.mocked(db.getSessionTimeline).mockResolvedValue([
        {
          id: '00000000-0000-4000-8000-0000000000b2',
          sessionId,
          eventType: 'POLICY.GRANT_ISSUED',
          timestamp: new Date('2026-03-07T09:11:02.000Z'),
          metadata: { grantId: 'grant-2' },
        } as any,
        {
          id: '00000000-0000-4000-8000-0000000000a1',
          sessionId,
          eventType: 'SESSION.CREATED',
          timestamp: new Date('2026-03-07T09:11:02.000Z'),
          metadata: { lotId: 'LOT-1' },
        } as any,
      ])

      const app = createApp()
      const res = await request(app).get(`/api/sessions/${sessionId}/timeline`)

      expect(res.status).toBe(200)
      expect(res.body.state).toBe('closed')
      expect(res.body.eventCount).toBe(2)
      expect(res.body.events).toEqual([
        {
          eventType: 'POLICY.GRANT_ISSUED',
          createdAt: '2026-03-07T09:11:02.000Z',
          metadata: { grantId: 'grant-2' },
        },
        {
          eventType: 'SESSION.CREATED',
          createdAt: '2026-03-07T09:11:02.000Z',
          metadata: { lotId: 'LOT-1' },
        },
      ])
    })

    it('returns SBA timeline metadata including budgetScope', async () => {
      vi.mocked(db.getSessionState).mockResolvedValue('active')
      vi.mocked(db.getSessionTimeline).mockResolvedValue([
        {
          id: 'evt-sba',
          sessionId,
          eventType: 'SESSION_BUDGET_AUTHORIZATION.ISSUED',
          timestamp: new Date('2026-03-07T09:11:03.000Z'),
          metadata: {
            budgetId: 'bud-1',
            maxAmountMinor: '3000',
            minorUnit: 2,
            currency: 'USD',
            budgetScope: 'SESSION',
            scopeId: 'veh_123',
          },
        } as any,
      ])
      const app = createApp()
      const res = await request(app).get(`/api/sessions/${sessionId}/timeline`)

      expect(res.status).toBe(200)
      expect(res.body.events[0]).toEqual({
        eventType: 'SESSION_BUDGET_AUTHORIZATION.ISSUED',
        createdAt: '2026-03-07T09:11:03.000Z',
        metadata: {
          budgetId: 'bud-1',
          maxAmountMinor: '3000',
          minorUnit: 2,
          currency: 'USD',
          budgetScope: 'SESSION',
          scopeId: 'veh_123',
        },
      })
    })
  })
})
