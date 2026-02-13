import { Router } from 'express'
import type { GateEntryRequest, GateExitRequest } from '@parker/core'
import { calculateFee } from '@parker/core'

import { db } from '../db'

export const gateRouter = Router()

// POST /api/gate/entry — Process vehicle entry
gateRouter.post('/entry', async (req, res) => {
  try {
    const { plateNumber, image, lotId } = req.body as GateEntryRequest

    let plate = plateNumber

    // If image provided, run ALPR
    if (!plate && image) {
      // TODO: Integrate @parker/alpr
      return res.status(400).json({ error: 'ALPR not yet implemented, provide plateNumber' })
    }

    if (!plate) {
      return res.status(400).json({ error: 'plateNumber or image required' })
    }

    // Check if driver is registered
    const driver = await db.getDriverByPlate(plate)
    if (!driver) {
      return res.status(404).json({ error: 'Driver not registered', plateNumber: plate })
    }

    // Check if already parked
    const activeSession = await db.getActiveSession(plate)
    if (activeSession) {
      return res.status(409).json({ error: 'Vehicle already has active session', session: activeSession })
    }

    // Create session
    // TODO: Also mint NFT on-chain
    const session = await db.createSession({
      plateNumber: plate,
      lotId,
    })

    res.status(201).json(session)
  } catch (error) {
    console.error('Gate entry failed:', error)
    res.status(500).json({ error: 'Gate entry failed' })
  }
})

// POST /api/gate/exit — Process vehicle exit + trigger payment
gateRouter.post('/exit', async (req, res) => {
  try {
    const { plateNumber, image, lotId } = req.body as GateExitRequest

    let plate = plateNumber

    if (!plate && image) {
      return res.status(400).json({ error: 'ALPR not yet implemented, provide plateNumber' })
    }

    if (!plate) {
      return res.status(400).json({ error: 'plateNumber or image required' })
    }

    // Find active session
    const session = await db.getActiveSession(plate)
    if (!session) {
      return res.status(404).json({ error: 'No active session found', plateNumber: plate })
    }

    // Get lot pricing
    const lot = await db.getLot(lotId)
    if (!lot) {
      return res.status(404).json({ error: 'Lot not found' })
    }

    // Calculate fee
    const durationMs = Date.now() - session.entryTime.getTime()
    const durationMinutes = durationMs / (1000 * 60)
    const fee = calculateFee(
      durationMinutes,
      lot.ratePerHour,
      lot.billingMinutes,
      lot.maxDailyFee ?? undefined,
    )

    // TODO: Trigger x402 payment
    // TODO: End NFT session on-chain

    // End session in DB
    const closedSession = await db.endSession(plate, fee)

    res.json({
      session: closedSession,
      fee,
      durationMinutes: Math.round(durationMinutes),
    })
  } catch (error) {
    console.error('Gate exit failed:', error)
    res.status(500).json({ error: 'Gate exit failed' })
  }
})

// POST /api/gate/scan — ALPR: upload image, get plate string
gateRouter.post('/scan', async (req, res) => {
  try {
    const { image } = req.body as { image: string }
    if (!image) {
      return res.status(400).json({ error: 'image required (base64)' })
    }

    // TODO: Integrate @parker/alpr
    res.status(501).json({ error: 'ALPR not yet implemented' })
  } catch (error) {
    console.error('Scan failed:', error)
    res.status(500).json({ error: 'Scan failed' })
  }
})

// GET /api/gate/lot/:lotId/status — Lot occupancy & stats
gateRouter.get('/lot/:lotId/status', async (req, res) => {
  try {
    const lot = await db.getLot(req.params.lotId)
    if (!lot) {
      return res.status(404).json({ error: 'Lot not found' })
    }

    const activeSessions = await db.getActiveSessionsByLot(req.params.lotId)

    res.json({
      lotId: lot.id,
      name: lot.name,
      currentOccupancy: activeSessions.length,
      capacity: lot.capacity,
      activeSessions: activeSessions.length,
    })
  } catch (error) {
    console.error('Failed to get lot status:', error)
    res.status(500).json({ error: 'Failed to get lot status' })
  }
})
