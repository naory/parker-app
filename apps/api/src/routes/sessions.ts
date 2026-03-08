import { Router, type Request } from 'express'
import { normalizePlate } from '@parker/core'

import { db } from '../db'
import { logger } from '../services/observability'

export const sessionsRouter = Router()
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function hasTimelineAccess(req: Request): boolean {
  const expectedApiKey = process.env.SESSION_TIMELINE_API_KEY || process.env.GATE_API_KEY
  if (!expectedApiKey) return true
  return req.header('x-gate-api-key') === expectedApiKey
}

// GET /api/sessions/active/:plate — Get active parking session
sessionsRouter.get('/active/:plate', async (req, res) => {
  try {
    const session = await db.getActiveSession(normalizePlate(req.params.plate))
    if (!session) {
      return res.status(404).json({ error: 'No active session' })
    }
    res.json(session)
  } catch (error) {
    console.error('Failed to get active session:', error)
    res.status(500).json({ error: 'Failed to get active session' })
  }
})

// GET /api/sessions/history/:plate — Get session history
sessionsRouter.get('/history/:plate', async (req, res) => {
  try {
    const rawLimit = parseInt(req.query.limit as string)
    const rawOffset = parseInt(req.query.offset as string)
    const limit = !isNaN(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 50
    const offset = !isNaN(rawOffset) && rawOffset >= 0 ? rawOffset : 0

    const sessions = await db.getSessionHistory(normalizePlate(req.params.plate), limit, offset)
    res.json(sessions)
  } catch (error) {
    console.error('Failed to get session history:', error)
    res.status(500).json({ error: 'Failed to get session history' })
  }
})

// GET /api/sessions/:sessionId/timeline — Get ordered lifecycle event timeline
sessionsRouter.get('/:sessionId/timeline', async (req, res) => {
  try {
    if (!UUID_V4_REGEX.test(req.params.sessionId)) {
      return res.status(400).json({ error: 'Invalid sessionId format' })
    }
    if (!hasTimelineAccess(req)) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    const rawLimit = parseInt(req.query.limit as string)
    const limit = !isNaN(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 1000) : 500
    const sessionId = req.params.sessionId
    const state = await db.getSessionState(sessionId)
    if (!state) {
      return res.status(404).json({ error: 'Session not found' })
    }
    const timeline = await db.getSessionTimeline(sessionId, limit)
    logger.info('timeline.fetch', { sessionId, eventCount: timeline.length })
    res.json({
      sessionId,
      state,
      eventCount: timeline.length,
      events: timeline.map((event) => ({
        eventType: event.eventType,
        createdAt: event.timestamp,
        metadata: event.metadata ?? {},
      })),
    })
  } catch (error) {
    console.error('Failed to get session timeline:', error)
    res.status(500).json({ error: 'Failed to get session timeline' })
  }
})
