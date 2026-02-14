import { Router } from 'express'
import type { GateEntryRequest, GateExitRequest, PaymentOptions } from '@parker/core'
import { calculateFee, normalizePlate } from '@parker/core'
import { recognizePlate } from '@parker/alpr'

import { db } from '../db'
import { notifyGate, notifyDriver } from '../ws/index'
import {
  isHederaEnabled,
  mintParkingNFTOnHedera,
  endParkingSessionOnHedera,
} from '../services/hedera'
import { convertToStablecoin, X402_STABLECOIN, X402_NETWORK } from '../services/pricing'
import { isStripeEnabled, createParkingCheckout } from '../services/stripe'
import type { PaymentRequired } from '@parker/x402'

export const gateRouter = Router()

/**
 * Deployment country codes from env — used for ALPR plate format hints.
 * Single-country deployments (e.g. "IL") restrict ALPR to that format.
 * Multi-country (e.g. "DE,FR,ES") tries all listed formats.
 */
const DEPLOYMENT_COUNTRIES = (process.env.DEPLOYMENT_COUNTRIES || '')
  .split(',')
  .map((c) => c.trim().toUpperCase())
  .filter(Boolean)

/**
 * Resolve a plate number from either the provided string or an image via ALPR.
 * Returns the plate string or null if nothing could be resolved.
 */
async function resolvePlate(
  plateNumber?: string,
  image?: string,
): Promise<{ plate: string; alprResult?: { raw: string; confidence: number } } | null> {
  if (plateNumber) {
    return { plate: normalizePlate(plateNumber) }
  }

  if (image) {
    const imageBuffer = Buffer.from(image, 'base64')
    // Use the first deployment country as the ALPR hint (single-country deployment)
    const countryHint = DEPLOYMENT_COUNTRIES.length === 1 ? DEPLOYMENT_COUNTRIES[0] : undefined
    const result = await recognizePlate(imageBuffer, countryHint)
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

    if (!lotId) {
      return res.status(400).json({ error: 'lotId is required' })
    }

    const resolved = await resolvePlate(plateNumber, image)
    if (!resolved) {
      return res.status(400).json({
        error: 'Could not determine plate number. Provide plateNumber or a clear image.',
      })
    }

    const { plate, alprResult } = resolved

    // Validate lot exists
    const lot = await db.getLot(lotId)
    if (!lot) {
      return res.status(404).json({ error: 'Lot not found', lotId })
    }

    // Check if driver is registered
    const driver = await db.getDriverByPlate(plate)
    if (!driver) {
      return res.status(404).json({ error: 'Driver not registered', plateNumber: plate })
    }

    // Check lot capacity
    const activeSessions = await db.getActiveSessionsByLot(lotId)
    if (lot.capacity && activeSessions.length >= lot.capacity) {
      return res.status(409).json({ error: 'Lot is full', lotId, capacity: lot.capacity })
    }

    // Check if already parked
    const activeSession = await db.getActiveSession(plate)
    if (activeSession) {
      return res.status(409).json({
        error: 'Vehicle already has active session',
        session: activeSession,
      })
    }

    // Mint parking NFT on Hedera (if configured)
    let tokenId: number | undefined
    let txHash: string | undefined
    if (isHederaEnabled()) {
      try {
        const result = await mintParkingNFTOnHedera(plate, lotId)
        tokenId = result.tokenId
        txHash = result.txHash
      } catch (err) {
        console.error('Hedera NFT minting failed (continuing with off-chain):', err)
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

    if (!lotId) {
      return res.status(400).json({ error: 'lotId is required' })
    }

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

    // Validate the exit lot matches the session's lot
    if (session.lotId !== lotId) {
      return res.status(400).json({
        error: 'Lot mismatch: vehicle is parked in a different lot',
        parkedInLot: session.lotId,
        requestedLot: lotId,
      })
    }

    // Get lot pricing
    const lot = await db.getLot(lotId)
    if (!lot) {
      return res.status(404).json({ error: 'Lot not found' })
    }

    // Calculate fee in the lot's local currency
    const durationMs = Date.now() - session.entryTime.getTime()
    const durationMinutes = durationMs / (1000 * 60)
    const fee = calculateFee(
      durationMinutes,
      lot.ratePerHour,
      lot.billingMinutes,
      lot.maxDailyFee ?? undefined,
    )

    // If client hasn't paid yet, build payment options and return them
    if (!(req as any).paymentVerified) {
      // Build payment options based on lot's accepted methods
      const paymentOptions: PaymentOptions = {}

      // x402 crypto rail
      if (lot.paymentMethods.includes('x402')) {
        try {
          const stablecoinAmount = convertToStablecoin(fee, lot.currency)
          paymentOptions.x402 = {
            amount: stablecoinAmount.toFixed(6),
            token: X402_STABLECOIN,
            network: X402_NETWORK,
            receiver: lot.operatorWallet,
          }
        } catch (err) {
          console.warn(`[x402] FX conversion failed for ${lot.currency}:`, err)
        }
      }

      // Stripe credit card rail
      if (lot.paymentMethods.includes('stripe') && isStripeEnabled()) {
        try {
          const { checkoutUrl } = await createParkingCheckout(session, lot, fee)
          paymentOptions.stripe = { checkoutUrl }
        } catch (err) {
          console.warn('[Stripe] Checkout creation failed:', err)
        }
      }

      // Set x402 payment info for the middleware (if x402 is available)
      if (paymentOptions.x402) {
        res.locals.paymentRequired = {
          amount: paymentOptions.x402.amount,
          description: `Parking fee: ${Math.round(durationMinutes)} minutes at ${lot.name}`,
          plateNumber: plate,
          sessionId: session.id,
        } satisfies PaymentRequired
      }

      // Return fee info + payment options without closing the session
      return res.json({
        session,
        fee,
        currency: lot.currency,
        durationMinutes: Math.round(durationMinutes),
        paymentOptions,
        ...(alprResult && { alpr: alprResult }),
      })
    }

    // Payment verified (x402 path) — end the session

    // Burn parking NFT on Hedera (if configured and session has a token)
    if (isHederaEnabled() && session.tokenId) {
      try {
        await endParkingSessionOnHedera(session.tokenId)
      } catch (err) {
        console.error('Hedera NFT burn failed (continuing with off-chain):', err)
      }
    }

    // End session in DB
    const closedSession = await db.endSession(plate, {
      feeAmount: fee,
      feeCurrency: lot.currency,
    })
    if (!closedSession) {
      return res.status(409).json({ error: 'Session already closed or not found', plateNumber: plate })
    }

    // Notify via WebSocket
    notifyGate(lotId, {
      type: 'exit',
      session: closedSession,
      plate,
      fee,
      currency: lot.currency,
      paymentMethod: 'x402',
    })
    notifyDriver(plate, {
      type: 'session_ended',
      session: closedSession,
      fee,
      currency: lot.currency,
      durationMinutes: Math.round(durationMinutes),
      paymentMethod: 'x402',
    })

    res.json({
      session: closedSession,
      fee,
      currency: lot.currency,
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
    const countryHint = DEPLOYMENT_COUNTRIES.length === 1 ? DEPLOYMENT_COUNTRIES[0] : undefined
    const result = await recognizePlate(imageBuffer, countryHint)

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
      address: lot.address,
      currentOccupancy: activeSessions.length,
      capacity: lot.capacity,
      activeSessions: activeSessions.length,
      ratePerHour: lot.ratePerHour,
      billingMinutes: lot.billingMinutes,
      maxDailyFee: lot.maxDailyFee,
      currency: lot.currency,
      paymentMethods: lot.paymentMethods,
      operatorWallet: lot.operatorWallet,
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

// PUT /api/gate/lot/:lotId — Update lot settings
gateRouter.put('/lot/:lotId', async (req, res) => {
  try {
    const { name, address, capacity, ratePerHour, billingMinutes, maxDailyFee, currency, paymentMethods } = req.body

    // Parse numeric fields — allow 0 as a valid value (only skip if not provided)
    const parseOptionalInt = (v: unknown) => v !== undefined && v !== null && v !== '' ? parseInt(String(v)) : undefined
    const parseOptionalFloat = (v: unknown) => v !== undefined && v !== null && v !== '' ? parseFloat(String(v)) : undefined

    const parsedCapacity = parseOptionalInt(capacity)
    const parsedRate = parseOptionalFloat(ratePerHour)
    const parsedBilling = parseOptionalInt(billingMinutes)
    const parsedMaxFee = parseOptionalFloat(maxDailyFee)

    // Reject NaN values
    if (parsedCapacity !== undefined && isNaN(parsedCapacity)) {
      return res.status(400).json({ error: 'capacity must be a valid number' })
    }
    if (parsedRate !== undefined && isNaN(parsedRate)) {
      return res.status(400).json({ error: 'ratePerHour must be a valid number' })
    }
    if (parsedBilling !== undefined && isNaN(parsedBilling)) {
      return res.status(400).json({ error: 'billingMinutes must be a valid number' })
    }
    if (parsedMaxFee !== undefined && isNaN(parsedMaxFee)) {
      return res.status(400).json({ error: 'maxDailyFee must be a valid number' })
    }

    const lot = await db.updateLot(req.params.lotId, {
      name,
      address,
      capacity: parsedCapacity,
      ratePerHour: parsedRate,
      billingMinutes: parsedBilling,
      maxDailyFee: parsedMaxFee,
      currency,
      paymentMethods,
    })

    if (!lot) {
      return res.status(404).json({ error: 'Lot not found' })
    }

    res.json(lot)
  } catch (error) {
    console.error('Failed to update lot:', error)
    res.status(500).json({ error: 'Failed to update lot' })
  }
})
