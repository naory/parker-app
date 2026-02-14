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
  findActiveSessionOnHedera,
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

    // WRITE-AHEAD: Mint parking NFT on Hedera FIRST (authoritative proof of entry)
    // The on-chain NFT is the leading indicator — if DB write fails, the NFT proves the car is parked.
    let tokenId: number | undefined
    let txHash: string | undefined
    if (isHederaEnabled()) {
      try {
        const result = await mintParkingNFTOnHedera(plate, lotId)
        tokenId = result.tokenId
        txHash = result.txHash
        console.log(`[entry] NFT minted on Hedera: serial=${tokenId}, tx=${txHash}`)
      } catch (err) {
        console.error('Hedera NFT minting failed (continuing with off-chain):', err)
      }
    }

    // Create session in DB (includes Hedera serial if minted)
    let session
    try {
      session = await db.createSession({
        plateNumber: plate,
        lotId,
        tokenId,
      })
    } catch (dbErr) {
      // DB write failed but NFT was minted — session exists on-chain and can be recovered.
      // Log a warning and still open the gate (the NFT is the proof of entry).
      console.error('[entry] DB write failed after NFT mint:', dbErr)
      if (tokenId) {
        console.warn(`[entry] Session recoverable via Hedera NFT serial=${tokenId}`)
        return res.status(201).json({
          warning: 'Session recorded on-chain only — DB temporarily unavailable',
          hederaSerial: tokenId,
          txHash,
          plate,
          lotId,
          ...(alprResult && { alpr: alprResult }),
        })
      }
      throw dbErr // No NFT either — nothing to recover from, propagate error
    }

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
// Resilience: if DB is unreachable, falls back to Hedera Mirror Node for session lookup.
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

    // ---- Phase 1: Find session + lot + calculate fee ----
    // Try DB first (fast path), fall back to Mirror Node if DB is down.

    let session: import('@parker/core').SessionRecord | null = null
    let lot: import('@parker/core').Lot | null = null
    let durationMinutes: number
    let fee: number
    let usingFallback = false
    let fallbackSerial: number | undefined

    try {
      // Fast path: DB lookup
      session = await db.getActiveSession(plate)
      if (!session) {
        return res.status(404).json({ error: 'No active session found', plateNumber: plate })
      }

      if (session.lotId !== lotId) {
        return res.status(400).json({
          error: 'Lot mismatch: vehicle is parked in a different lot',
          parkedInLot: session.lotId,
          requestedLot: lotId,
        })
      }

      lot = await db.getLot(lotId)
      if (!lot) {
        return res.status(404).json({ error: 'Lot not found' })
      }

      const durationMs = Date.now() - session.entryTime.getTime()
      durationMinutes = durationMs / (1000 * 60)
      fee = calculateFee(durationMinutes, lot.ratePerHour, lot.billingMinutes, lot.maxDailyFee ?? undefined)
    } catch (dbError) {
      // DB unreachable — try Mirror Node fallback
      console.warn('[exit] DB lookup failed, attempting Mirror Node fallback:', (dbError as Error).message)

      if (!isHederaEnabled()) {
        return res.status(503).json({ error: 'Database unavailable and Hedera fallback not configured' })
      }

      const nftSession = await findActiveSessionOnHedera(plate)
      if (!nftSession) {
        return res.status(404).json({
          error: 'No active session found (checked Mirror Node fallback)',
          plateNumber: plate,
        })
      }

      if (nftSession.lotId !== lotId) {
        return res.status(400).json({
          error: 'Lot mismatch: vehicle is parked in a different lot',
          parkedInLot: nftSession.lotId,
          requestedLot: lotId,
        })
      }

      // Try to get lot config from DB (might work for lot reads even if session reads failed)
      try {
        lot = await db.getLot(lotId)
      } catch {
        // Lot config also unavailable — use minimal defaults
        console.warn('[exit] Lot config unavailable, using fallback defaults')
      }

      const entryTimeMs = nftSession.entryTime * 1000
      durationMinutes = (Date.now() - entryTimeMs) / (1000 * 60)
      fee = lot
        ? calculateFee(durationMinutes, lot.ratePerHour, lot.billingMinutes, lot.maxDailyFee ?? undefined)
        : 0 // Can't calculate fee without lot config — let payment handle it

      usingFallback = true
      fallbackSerial = nftSession.serial
      console.log(`[exit] Mirror Node fallback: found NFT serial=${nftSession.serial}, duration=${Math.round(durationMinutes)}m`)
    }

    const currency = lot?.currency || 'USD'
    const sessionId = session?.id || `hedera-${fallbackSerial}`

    // ---- Phase 2: Payment ----

    if (!(req as any).paymentVerified) {
      const paymentOptions: PaymentOptions = {}

      if (lot?.paymentMethods.includes('x402') ?? true) {
        try {
          const stablecoinAmount = convertToStablecoin(fee, currency)
          paymentOptions.x402 = {
            amount: stablecoinAmount.toFixed(6),
            token: X402_STABLECOIN,
            network: X402_NETWORK,
            receiver: lot?.operatorWallet || process.env.LOT_OPERATOR_WALLET || '',
          }
        } catch (err) {
          console.warn(`[x402] FX conversion failed for ${currency}:`, err)
        }
      }

      if (!usingFallback && lot?.paymentMethods.includes('stripe') && isStripeEnabled() && session) {
        try {
          const { checkoutUrl } = await createParkingCheckout(session, lot, fee)
          paymentOptions.stripe = { checkoutUrl }
        } catch (err) {
          console.warn('[Stripe] Checkout creation failed:', err)
        }
      }

      if (paymentOptions.x402) {
        res.locals.paymentRequired = {
          amount: paymentOptions.x402.amount,
          description: `Parking fee: ${Math.round(durationMinutes)} minutes at ${lot?.name || lotId}`,
          plateNumber: plate,
          sessionId,
        } satisfies PaymentRequired
      }

      // Notify driver that payment is required (so the driver app shows a payment prompt)
      try {
        notifyDriver(plate, {
          type: 'payment_required',
          fee,
          currency,
          durationMinutes: Math.round(durationMinutes),
          paymentOptions,
          sessionId,
          lotId,
        })
      } catch {
        // WS notification is best-effort
      }

      return res.json({
        session: session || { id: sessionId, plateNumber: plate, lotId, entryTime: new Date((fallbackSerial ? Date.now() - durationMinutes * 60000 : Date.now())), status: 'active' as const },
        fee,
        currency,
        durationMinutes: Math.round(durationMinutes),
        paymentOptions,
        ...(usingFallback && { fallback: 'hedera-mirror-node', hederaSerial: fallbackSerial }),
        ...(alprResult && { alpr: alprResult }),
      })
    }

    // ---- Phase 3: Payment verified — close session ----

    // Burn parking NFT on Hedera
    const serialToBurn = session?.tokenId || fallbackSerial
    if (isHederaEnabled() && serialToBurn) {
      try {
        await endParkingSessionOnHedera(serialToBurn)
      } catch (err) {
        console.error('Hedera NFT burn failed (continuing with off-chain):', err)
      }
    }

    // End session in DB (skip if using fallback and DB is down)
    let closedSession = null
    if (!usingFallback) {
      closedSession = await db.endSession(plate, {
        feeAmount: fee,
        feeCurrency: currency,
      })
      if (!closedSession) {
        return res.status(409).json({ error: 'Session already closed or not found', plateNumber: plate })
      }
    } else {
      // Try DB close, but don't block the gate if it fails
      try {
        closedSession = await db.endSession(plate, {
          feeAmount: fee,
          feeCurrency: currency,
        })
      } catch (dbErr) {
        console.warn('[exit] DB close failed during fallback — NFT burned, gate will open:', (dbErr as Error).message)
      }
    }

    // Notify via WebSocket (best-effort)
    try {
      notifyGate(lotId, {
        type: 'exit',
        session: closedSession || { id: sessionId, plateNumber: plate, lotId },
        plate,
        fee,
        currency,
        paymentMethod: 'x402',
      })
      notifyDriver(plate, {
        type: 'session_ended',
        session: closedSession || { id: sessionId, plateNumber: plate, lotId },
        fee,
        currency,
        durationMinutes: Math.round(durationMinutes),
        paymentMethod: 'x402',
      })
    } catch {
      // WS notifications are best-effort
    }

    res.json({
      session: closedSession || { id: sessionId, plateNumber: plate, lotId, status: 'completed' },
      fee,
      currency,
      durationMinutes: Math.round(durationMinutes),
      ...(usingFallback && { fallback: 'hedera-mirror-node' }),
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
