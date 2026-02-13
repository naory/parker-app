import { Router } from 'express'
import type { GateEntryRequest, GateExitRequest } from '@parker/core'
import { calculateFee } from '@parker/core'
import { recognizePlate } from '@parker/alpr'

import { db } from '../db'
import { notifyGate, notifyDriver } from '../ws'
import {
  isBlockchainEnabled,
  mintParkingNFT,
  endParkingSession,
} from '../services/blockchain'
import type { PaymentRequired } from '@parker/x402'

export const gateRouter = Router()

/**
 * Resolve a plate number from either the provided string or an image via ALPR.
 * Returns the plate string or null if nothing could be resolved.
 */
async function resolvePlate(
  plateNumber?: string,
  image?: string,
): Promise<{ plate: string; alprResult?: { raw: string; confidence: number } } | null> {
  if (plateNumber) {
    return { plate: plateNumber }
  }

  if (image) {
    const imageBuffer = Buffer.from(image, 'base64')
    const result = await recognizePlate(imageBuffer)
    if (result?.normalized) {
      return {
        plate: result.normalized,
        alprResult: { raw: result.raw, confidence: result.confidence },
      }
    }
    // ALPR couldn't extract a valid plate
    return null
  }

  return null
}

// POST /api/gate/entry — Process vehicle entry
gateRouter.post('/entry', async (req, res) => {
  try {
    const { plateNumber, image, lotId } = req.body as GateEntryRequest

    const resolved = await resolvePlate(plateNumber, image)
    if (!resolved) {
      return res.status(400).json({
        error: 'Could not determine plate number. Provide plateNumber or a clear image.',
      })
    }

    const { plate, alprResult } = resolved

    // Check if driver is registered
    const driver = await db.getDriverByPlate(plate)
    if (!driver) {
      return res.status(404).json({ error: 'Driver not registered', plateNumber: plate })
    }

    // Check if already parked
    const activeSession = await db.getActiveSession(plate)
    if (activeSession) {
      return res.status(409).json({
        error: 'Vehicle already has active session',
        session: activeSession,
      })
    }

    // Mint NFT on-chain (if blockchain is configured)
    let tokenId: number | undefined
    let txHash: string | undefined
    if (isBlockchainEnabled()) {
      try {
        const result = await mintParkingNFT(plate, lotId)
        tokenId = result.tokenId
        txHash = result.txHash
      } catch (err) {
        console.error('On-chain NFT minting failed (continuing with off-chain):', err)
      }
    }

    // Create session in DB
    const session = await db.createSession({
      plateNumber: plate,
      lotId,
      tokenId,
    })

    // Notify via WebSocket
    notifyGate(lotId, { type: 'entry', session, plate })
    notifyDriver(plate, { type: 'session_started', session })

    res.status(201).json({ session, ...(alprResult && { alpr: alprResult }) })
  } catch (error) {
    console.error('Gate entry failed:', error)
    res.status(500).json({ error: 'Gate entry failed' })
  }
})

// POST /api/gate/exit — Process vehicle exit + trigger payment
gateRouter.post('/exit', async (req, res) => {
  try {
    const { plateNumber, image, lotId } = req.body as GateExitRequest

    const resolved = await resolvePlate(plateNumber, image)
    if (!resolved) {
      return res.status(400).json({
        error: 'Could not determine plate number. Provide plateNumber or a clear image.',
      })
    }

    const { plate, alprResult } = resolved

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

    // End NFT session on-chain (if blockchain is configured)
    let txHash: string | undefined
    if (isBlockchainEnabled()) {
      try {
        const result = await endParkingSession(plate, fee)
        txHash = result.txHash
      } catch (err) {
        console.error('On-chain session end failed (continuing with off-chain):', err)
      }
    }

    // Trigger x402 payment (if client hasn't already paid)
    if (!(req as any).paymentVerified) {
      res.locals.paymentRequired = {
        amount: fee.toFixed(6),
        description: `Parking fee: ${Math.round(durationMinutes)} minutes at ${lot.name}`,
        plateNumber: plate,
        sessionId: session.id,
      } satisfies PaymentRequired
    }

    // End session in DB
    const closedSession = await db.endSession(plate, fee)

    // Notify via WebSocket
    notifyGate(lotId, { type: 'exit', session: closedSession, plate, fee })
    notifyDriver(plate, { type: 'session_ended', session: closedSession, fee, durationMinutes: Math.round(durationMinutes) })

    res.json({
      session: closedSession,
      fee,
      durationMinutes: Math.round(durationMinutes),
      ...(alprResult && { alpr: alprResult }),
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

    const imageBuffer = Buffer.from(image, 'base64')
    const result = await recognizePlate(imageBuffer)

    if (!result) {
      return res.status(422).json({ error: 'No text detected in image' })
    }

    res.json({
      plateNumber: result.normalized,
      raw: result.raw,
      confidence: result.confidence,
      valid: result.normalized !== null,
    })
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

// GET /api/gate/lot/:lotId/sessions — Active sessions list for a lot
gateRouter.get('/lot/:lotId/sessions', async (req, res) => {
  try {
    const activeSessions = await db.getActiveSessionsByLot(req.params.lotId)
    res.json(activeSessions)
  } catch (error) {
    console.error('Failed to get lot sessions:', error)
    res.status(500).json({ error: 'Failed to get lot sessions' })
  }
})
