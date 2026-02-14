import { Router } from 'express'
import { normalizePlate } from '@parker/core'

import { db } from '../db'

export const sessionsRouter = Router()

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
