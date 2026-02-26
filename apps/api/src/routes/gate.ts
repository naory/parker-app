import { Router } from 'express'
import { createHash } from 'node:crypto'
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
import {
  addPendingPayment,
  getPendingPaymentByPlateLot,
  removePendingPayment,
} from '../services/paymentWatcher'
import { failedExitsTotal, logger, paymentFailuresTotal } from '../services/observability'
import type { PaymentRequired } from '@parker/x402'
import {
  createXamanPayloadForPendingPayment,
  getXamanPayloadStatus,
  isXamanConfigured,
} from '../services/xaman'
import {
  resolveEffectivePolicy,
  evaluateEntryPolicy,
  evaluatePaymentPolicy,
  enforcePayment,
} from '@parker/policy-core'
import type {
  Rail,
  Asset,
  PaymentPolicyContext,
  PaymentPolicyDecision,
  SettlementResult,
} from '@parker/policy-core'
// PaymentPolicyContext.quote uses MoneyMinor (amountMinor); .spend uses dayTotalMinor/sessionTotalMinor (policy-core minor-unit types)
import { buildEntryPolicyStack } from '../services/policyStack'

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

const LOT_ID_REGEX = /^[A-Za-z0-9_-]{1,64}$/
const XRPL_PAYLOAD_UUID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/

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

function hashIdempotencyPayload(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

function decimalToScaledBigInt(value: string, decimals: number): bigint {
  const [wholeRaw, fractionRaw = ''] = value.split('.')
  const whole = wholeRaw || '0'
  const fraction = (fractionRaw + '0'.repeat(decimals)).slice(0, decimals)
  return BigInt(`${whole}${fraction}`)
}

function parseXrplIntentBody(body: unknown): { plate: string; lotId: string } | { error: string } {
  if (!body || typeof body !== 'object') {
    return { error: 'Invalid request body' }
  }
  const record = body as Record<string, unknown>
  const plateNumber = record.plateNumber
  const lotIdRaw = record.lotId

  if (typeof plateNumber !== 'string' || typeof lotIdRaw !== 'string') {
    return { error: 'plateNumber and lotId must be strings' }
  }

  const plate = normalizePlate(plateNumber.trim())
  const lotId = lotIdRaw.trim()

  if (!plate || !/^[A-Z0-9]{2,16}$/.test(plate)) {
    return { error: 'Invalid plateNumber format' }
  }
  if (!LOT_ID_REGEX.test(lotId)) {
    return { error: 'Invalid lotId format' }
  }

  return { plate, lotId }
}

// POST /api/gate/xrpl/xaman-intent — Create Xaman payload for pending XRPL payment
gateRouter.post('/xrpl/xaman-intent', async (req, res) => {
  try {
    if (!X402_NETWORK.startsWith('xrpl:')) {
      return res.status(400).json({ error: 'XRPL rail is not active for this deployment' })
    }
    if (!isXamanConfigured()) {
      return res.status(503).json({ error: 'Xaman is not configured on the server' })
    }

    const parsedBody = parseXrplIntentBody(req.body)
    if ('error' in parsedBody) {
      return res.status(400).json({ error: parsedBody.error })
    }
    const { plate, lotId } = parsedBody
    let intent = await db.getActiveXrplPendingIntent(plate, lotId)

    // If pending state is missing (e.g. restart or direct driver flow), derive it here.
    if (!intent) {
      let pending = getPendingPaymentByPlateLot(plate, lotId)
      if (!pending) {
        const session = await db.getActiveSession(plate)
        if (!session) {
          return res.status(404).json({
            error: 'No active session found for this plate/lot.',
          })
        }
        if (session.lotId !== lotId) {
          return res.status(400).json({
            error: 'Lot mismatch for active session',
            parkedInLot: session.lotId,
            requestedLot: lotId,
          })
        }

        const lot = await db.getLot(lotId)
        if (!lot) {
          return res.status(404).json({ error: 'Lot not found', lotId })
        }
        const entryMs = new Date(session.entryTime).getTime()
        const durationMinutes = (Date.now() - entryMs) / (1000 * 60)
        const fee = calculateFee(
          durationMinutes,
          lot.ratePerHour,
          lot.billingMinutes,
          lot.maxDailyFee ?? undefined,
          lot.gracePeriodMinutes ?? 0,
        )
        if (fee <= 0) {
          return res.status(400).json({
            error: 'No payment required for this session',
          })
        }

        const stablecoinAmount = convertToStablecoin(fee, lot.currency || 'USD')
        pending = {
          plate,
          lotId,
          sessionId: session.id,
          expectedAmount: stablecoinAmount.toFixed(6),
          receiverWallet: lot.operatorWallet || process.env.LOT_OPERATOR_WALLET || '',
          fee,
          feeCurrency: lot.currency || 'USD',
          tokenId: session.tokenId,
          createdAt: Date.now(),
        }
        addPendingPayment(pending)
      }

      intent = await db.upsertXrplPendingIntent({
        plateNumber: pending.plate,
        lotId: pending.lotId,
        sessionId: pending.sessionId,
        amount: pending.expectedAmount,
        destination: pending.receiverWallet,
        token: X402_STABLECOIN,
        network: X402_NETWORK,
        expiresAt: new Date(Date.now() + 15 * 60_000),
      })
    }

    if (!intent) {
      return res.status(404).json({
        error: 'No pending XRPL payment found. Request /api/gate/exit first.',
      })
    }

    const payload = await createXamanPayloadForPendingPayment({
      paymentId: intent.paymentId,
      sessionId: intent.sessionId,
      plate: intent.plateNumber,
      lotId: intent.lotId,
      expectedAmount: intent.amount,
      receiverWallet: intent.destination,
      decisionId: intent.decisionId,
      policyHash: intent.policyHash,
      rail: intent.rail,
      asset: intent.asset,
    })

    await db.attachXamanPayloadToIntent({
      paymentId: intent.paymentId,
      payloadUuid: payload.payloadUuid,
      deepLink: payload.deepLink,
      qrPng: payload.qrPng,
    })

    return res.json({
      ...payload,
      paymentId: intent.paymentId,
      expiresAt: intent.expiresAt,
    })
  } catch (error) {
    console.error('Failed to create Xaman payload:', error)
    return res.status(500).json({ error: 'Failed to create Xaman payload' })
  }
})

// GET /api/gate/xrpl/xaman-status/:payloadUuid — Poll Xaman payload state
gateRouter.get('/xrpl/xaman-status/:payloadUuid', async (req, res) => {
  try {
    if (!X402_NETWORK.startsWith('xrpl:')) {
      return res.status(400).json({ error: 'XRPL rail is not active for this deployment' })
    }
    const payloadUuid = String(req.params.payloadUuid || '').trim()
    if (!XRPL_PAYLOAD_UUID_REGEX.test(payloadUuid)) {
      return res.status(400).json({ error: 'Invalid payloadUuid format' })
    }
    const status = await getXamanPayloadStatus(payloadUuid)
    if (status.resolved && status.txHash) {
      await db.resolveXrplIntentByPayloadUuid({
        payloadUuid,
        txHash: status.txHash,
      })
    } else if (status.rejected) {
      await db.cancelXrplIntentByPayloadUuid(payloadUuid)
    }
    return res.json(status)
  } catch (error) {
    console.error('Failed to fetch Xaman payload status:', error)
    return res.status(500).json({ error: 'Failed to fetch Xaman payload status' })
  }
})

// GET /api/gate/xrpl/xaman-config — Check whether Xaman flow is available
gateRouter.get('/xrpl/xaman-config', (_req, res) => {
  res.json({
    available: X402_NETWORK.startsWith('xrpl:') && isXamanConfigured(),
    network: X402_NETWORK,
  })
})

// POST /api/gate/entry — Process vehicle entry
// Requires header: Idempotency-Key
gateRouter.post('/entry', async (req, res) => {
  const endpoint = 'gate:entry'
  let idempotencyKey: string | null = null
  let idempotencyStarted = false

  const reply = async (status: number, body: unknown) => {
    if (idempotencyStarted && idempotencyKey) {
      await db.completeIdempotency({
        endpoint,
        idempotencyKey,
        responseCode: status,
        responseBody: body,
      })
    }
    return res.status(status).json(body)
  }

  try {
    const requestId = (res.locals as any).requestId as string | undefined
    const { plateNumber, image, lotId } = req.body as GateEntryRequest

    if (!lotId) {
      return res.status(400).json({ error: 'lotId is required' })
    }

    const entryPayload = {
      lotId,
      plateNumber: plateNumber ?? null,
      image: image ?? null,
    }
    idempotencyKey = req.header('Idempotency-Key')?.trim() || null
    if (!idempotencyKey && process.env.NODE_ENV === 'test') {
      idempotencyKey = `test-${hashIdempotencyPayload(entryPayload).slice(0, 24)}`
    }
    if (!idempotencyKey) {
      return res.status(400).json({ error: 'Idempotency-Key header is required' })
    }

    const begin = await db.beginIdempotency({
      endpoint,
      idempotencyKey,
      requestHash: hashIdempotencyPayload(entryPayload),
    })

    if (begin.status === 'replay') {
      res.setHeader('Idempotent-Replay', 'true')
      return res.status(begin.responseCode).json(begin.responseBody)
    }
    if (begin.status === 'in_progress') {
      return res
        .status(409)
        .json({ error: 'A request with this Idempotency-Key is already in progress' })
    }
    if (begin.status === 'conflict') {
      return res.status(409).json({
        error: 'Idempotency-Key was already used with different request parameters',
      })
    }
    idempotencyStarted = true

    const resolved = await resolvePlate(plateNumber, image)
    if (!resolved) {
      return reply(400, {
        error: 'Could not determine plate number. Provide plateNumber or a clear image.',
      })
    }

    const { plate, alprResult } = resolved

    // Validate lot exists
    const lot = await db.getLot(lotId)
    if (!lot) {
      return reply(404, { error: 'Lot not found', lotId })
    }

    // Check if driver is registered
    const driver = await db.getDriverByPlate(plate)
    if (!driver) {
      return reply(404, { error: 'Driver not registered', plateNumber: plate })
    }

    // Check lot capacity
    const activeSessions = await db.getActiveSessionsByLot(lotId)
    if (lot.capacity && activeSessions.length >= lot.capacity) {
      return reply(409, { error: 'Lot is full', lotId, capacity: lot.capacity })
    }

    // Check if already parked
    const activeSession = await db.getActiveSession(plate)
    if (activeSession) {
      return reply(409, {
        error: 'Vehicle already has active session',
        session: activeSession,
      })
    }

    // Entry-time policy: resolve stack, evaluate, reject if denied
    const stack = buildEntryPolicyStack(lotId, plate)
    const policy = resolveEffectivePolicy(stack)
    const railsOffered: Rail[] = []
    if (lot.paymentMethods?.includes('stripe')) railsOffered.push('stripe')
    if (lot.paymentMethods?.includes('x402')) {
      railsOffered.push(X402_NETWORK.startsWith('xrpl:') ? 'xrpl' : 'evm')
    }
    if (railsOffered.length === 0) railsOffered.push('stripe', 'xrpl', 'evm') // fallback so policy can still restrict
    const xrplIssuer = process.env.XRPL_ISSUER ?? ''
    const assetsOffered: Asset[] = [
      { kind: 'IOU', currency: lot.currency, issuer: xrplIssuer || 'unknown' },
    ]
    const entryCtx = {
      policy,
      lotId,
      operatorId: lot.operatorWallet,
      nowISO: new Date().toISOString(),
      railsOffered,
      assetsOffered,
    }
    const grant = evaluateEntryPolicy(entryCtx)
    const entryDenied = grant.allowedRails.length === 0 || grant.reasons.some((r) => r === 'LOT_NOT_ALLOWED' || r === 'GEO_NOT_ALLOWED' || r === 'RAIL_NOT_ALLOWED' || r === 'ASSET_NOT_ALLOWED')
    if (entryDenied) {
      return reply(403, {
        error: 'Entry denied by policy',
        reasons: grant.reasons,
        grantId: grant.grantId,
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
      // Persist entry policy grant and bind to session
      const expiresAt = new Date(grant.expiresAtISO)
      const { grantId } = await db.insertPolicyGrant({
        sessionId: session.id,
        policyHash: grant.policyHash,
        allowedRails: grant.allowedRails,
        allowedAssets: grant.allowedAssets,
        maxSpend: grant.maxSpend ?? null,
        requireApproval: grant.requireApproval ?? false,
        reasons: grant.reasons,
        expiresAt,
      })
      await db.updateSessionPolicyGrant(session.id, grantId, grant.policyHash)
      session = { ...session, policyGrantId: grantId, policyHash: grant.policyHash }
      await db.insertPolicyEvent({
        eventType: 'entryGrantCreated',
        payload: {
          grantId,
          policyHash: grant.policyHash,
          sessionId: session.id,
          expiresAtISO: grant.expiresAtISO,
        },
        sessionId: session.id,
      })
    } catch (dbErr) {
      // DB write failed but NFT was minted — session exists on-chain and can be recovered.
      // Log a warning and still open the gate (the NFT is the proof of entry).
      console.error('[entry] DB write failed after NFT mint:', dbErr)
      if (tokenId) {
        console.warn(`[entry] Session recoverable via Hedera NFT serial=${tokenId}`)
        return reply(201, {
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
    logger.info('gate_entry_success', {
      request_id: requestId,
      session_id: session.id,
      lot_id: lotId,
      plate_number: plate,
      token_id: session.tokenId,
    })

    return reply(201, { session, ...(alprResult && { alpr: alprResult }) })
  } catch (error) {
    console.error('Gate entry failed:', error)
    return reply(500, { error: 'Gate entry failed' })
  }
})

// POST /api/gate/exit — Process vehicle exit + trigger payment
// Resilience: if DB is unreachable, falls back to Hedera Mirror Node for session lookup.
// Requires header: Idempotency-Key
gateRouter.post('/exit', async (req, res) => {
  const endpoint = 'gate:exit'
  let idempotencyKey: string | null = null
  let idempotencyStarted = false

  const reply = async (status: number, body: unknown) => {
    if (status >= 400) {
      failedExitsTotal.inc({ status: String(status) })
    }
    if (idempotencyStarted && idempotencyKey) {
      await db.completeIdempotency({
        endpoint,
        idempotencyKey,
        responseCode: status,
        responseBody: body,
      })
    }
    return res.status(status).json(body)
  }

  try {
    const requestId = (res.locals as any).requestId as string | undefined
    const { plateNumber, image, lotId } = req.body as GateExitRequest

    if (!lotId) {
      return res.status(400).json({ error: 'lotId is required' })
    }

    const exitPayload = {
      lotId,
      plateNumber: plateNumber ?? null,
      image: image ?? null,
      paymentVerified: Boolean((req as any).paymentVerified),
    }
    idempotencyKey = req.header('Idempotency-Key')?.trim() || null
    if (!idempotencyKey && process.env.NODE_ENV === 'test') {
      idempotencyKey = `test-${hashIdempotencyPayload(exitPayload).slice(0, 24)}`
    }
    if (!idempotencyKey) {
      return res.status(400).json({ error: 'Idempotency-Key header is required' })
    }

    const begin = await db.beginIdempotency({
      endpoint,
      idempotencyKey,
      requestHash: hashIdempotencyPayload(exitPayload),
    })

    if (begin.status === 'replay') {
      res.setHeader('Idempotent-Replay', 'true')
      return res.status(begin.responseCode).json(begin.responseBody)
    }
    if (begin.status === 'in_progress') {
      return res
        .status(409)
        .json({ error: 'A request with this Idempotency-Key is already in progress' })
    }
    if (begin.status === 'conflict') {
      return res.status(409).json({
        error: 'Idempotency-Key was already used with different request parameters',
      })
    }
    idempotencyStarted = true

    const resolved = await resolvePlate(plateNumber, image)
    if (!resolved) {
      return reply(400, {
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
        return reply(404, { error: 'No active session found', plateNumber: plate })
      }

      if (session.lotId !== lotId) {
        return reply(400, {
          error: 'Lot mismatch: vehicle is parked in a different lot',
          parkedInLot: session.lotId,
          requestedLot: lotId,
        })
      }

      lot = await db.getLot(lotId)
      if (!lot) {
        return reply(404, { error: 'Lot not found' })
      }

      const durationMs = Date.now() - session.entryTime.getTime()
      durationMinutes = durationMs / (1000 * 60)
      fee = calculateFee(
        durationMinutes,
        lot.ratePerHour,
        lot.billingMinutes,
        lot.maxDailyFee ?? undefined,
        lot.gracePeriodMinutes ?? 0,
      )
    } catch (dbError) {
      // DB unreachable — try Mirror Node fallback
      console.warn(
        '[exit] DB lookup failed, attempting Mirror Node fallback:',
        (dbError as Error).message,
      )

      if (!isHederaEnabled()) {
        return reply(503, { error: 'Database unavailable and Hedera fallback not configured' })
      }

      const nftSession = await findActiveSessionOnHedera(plate)
      if (!nftSession) {
        return reply(404, {
          error: 'No active session found (checked Mirror Node fallback)',
          plateNumber: plate,
        })
      }

      if (nftSession.lotId !== lotId) {
        return reply(400, {
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
        ? calculateFee(
            durationMinutes,
            lot.ratePerHour,
            lot.billingMinutes,
            lot.maxDailyFee ?? undefined,
            lot.gracePeriodMinutes ?? 0,
          )
        : 0 // Can't calculate fee without lot config — let payment handle it

      usingFallback = true
      fallbackSerial = nftSession.serial
      console.log(
        `[exit] Mirror Node fallback: found NFT serial=${nftSession.serial}, duration=${Math.round(durationMinutes)}m`,
      )
    }

    const currency = lot?.currency || 'USD'
    const sessionId = session?.id || `hedera-${fallbackSerial}`

    // ---- Phase 2: Payment (with exit-time policy decision) ----

    if (fee > 0 && !(req as any).paymentVerified) {
      // 6. Compute PaymentPolicyContext: quote in minor units, spend totals, grant validity
      const decimals = 2 // fiat minor units (cents)
      const quoteAmountMinor = Math.round(fee * 10 ** decimals).toString()
      const spend = await db.getSpendTotalsMinor(plate, currency)
      let sessionGrantId: string | undefined
      if (session?.policyGrantId) {
        const expiresAt = await db.getPolicyGrantExpiresAt(session.policyGrantId)
        if (expiresAt && expiresAt > new Date()) sessionGrantId = session.policyGrantId
      }

      const stack = buildEntryPolicyStack(lotId, plate)
      const policy = resolveEffectivePolicy(stack)
      const railsOffered: Rail[] = []
      if (lot?.paymentMethods?.includes('stripe')) railsOffered.push('stripe')
      if (lot?.paymentMethods?.includes('x402')) {
        railsOffered.push(X402_NETWORK.startsWith('xrpl:') ? 'xrpl' : 'evm')
      }
      if (railsOffered.length === 0) railsOffered.push('stripe', 'xrpl', 'evm')
      const xrplIssuer = process.env.XRPL_ISSUER ?? ''
      const assetsOffered: Asset[] = [
        { kind: 'IOU', currency, issuer: xrplIssuer || 'unknown' },
      ]

      const paymentCtx = {
        policy,
        lotId,
        operatorId: lot?.operatorWallet,
        nowISO: new Date().toISOString(),
        quote: { amountMinor: quoteAmountMinor, currency },
        spend: {
          dayTotalMinor: spend.dayTotalMinor,
          sessionTotalMinor: spend.sessionTotalMinor,
        },
        railsOffered,
        assetsOffered,
        sessionGrantId,
      }
      const decision = evaluatePaymentPolicy(
        paymentCtx as unknown as PaymentPolicyContext,
      )

      if (decision.action === 'DENY') {
        return reply(403, {
          error: 'Payment denied by policy',
          reasons: decision.reasons,
          decisionId: decision.decisionId,
        })
      }

      await db.insertPolicyEvent({
        eventType: 'paymentDecisionCreated',
        payload: decision,
        sessionId,
        decisionId: decision.decisionId,
      })

      // Build options for x402 and stripe; then filter by decision.rail when ALLOW
      const x402Option =
        (lot?.paymentMethods?.includes('x402') ?? true) &&
        (() => {
          try {
            const stablecoinAmount = convertToStablecoin(fee, currency)
            return {
              amount: stablecoinAmount.toFixed(6),
              token: X402_STABLECOIN,
              network: X402_NETWORK,
              receiver: lot?.operatorWallet || process.env.LOT_OPERATOR_WALLET || '',
            }
          } catch {
            return null
          }
        })()
      let stripeOption: { checkoutUrl: string } | null = null
      if (
        !usingFallback &&
        lot?.paymentMethods?.includes('stripe') &&
        isStripeEnabled() &&
        session
      ) {
        try {
          const policyBind = {
            decisionId: decision.decisionId,
            policyHash: decision.policyHash,
            rail: decision.rail ?? 'stripe',
          }
          const { checkoutUrl } = await createParkingCheckout(session, lot, fee, policyBind)
          stripeOption = { checkoutUrl }
        } catch {
          // ignore
        }
      }

      const paymentOptions: PaymentOptions = {}
      const approvalRequired = decision.action === 'REQUIRE_APPROVAL'
      if (decision.action === 'ALLOW' && decision.rail) {
        if (decision.rail === 'stripe' && stripeOption) paymentOptions.stripe = stripeOption
        else if ((decision.rail === 'xrpl' || decision.rail === 'evm') && x402Option)
          paymentOptions.x402 = x402Option
      } else {
        if (x402Option) paymentOptions.x402 = x402Option
        if (stripeOption) paymentOptions.stripe = stripeOption
      }

      if (paymentOptions.x402) {
        res.locals.paymentRequired = {
          amount: paymentOptions.x402.amount,
          description: `Parking fee: ${Math.round(durationMinutes)} minutes at ${lot?.name || lotId}`,
          plateNumber: plate,
          sessionId,
        } satisfies PaymentRequired
      }

      if (paymentOptions.x402) {
        addPendingPayment({
          plate,
          lotId,
          sessionId,
          expectedAmount: paymentOptions.x402.amount,
          receiverWallet: paymentOptions.x402.receiver,
          fee,
          feeCurrency: currency,
          tokenId: session?.tokenId,
          createdAt: Date.now(),
          decisionId: decision.decisionId,
          policyHash: decision.policyHash,
          rail: decision.rail,
          asset: decision.asset ? JSON.stringify(decision.asset) : undefined,
        })
        if (X402_NETWORK.startsWith('xrpl:')) {
          try {
            await db.upsertXrplPendingIntent({
              plateNumber: plate,
              lotId,
              sessionId,
              amount: paymentOptions.x402.amount,
              destination: paymentOptions.x402.receiver,
              token: paymentOptions.x402.token,
              network: paymentOptions.x402.network,
              expiresAt: new Date(Date.now() + 15 * 60_000),
              decisionId: decision.decisionId,
              policyHash: decision.policyHash,
              rail: decision.rail,
              asset: decision.asset,
            })
          } catch (persistErr) {
            console.warn(
              '[x402:xrpl] Failed to persist pending intent (continuing):',
              (persistErr as Error).message,
            )
          }
        }
      }

      try {
        notifyDriver(plate, {
          type: 'payment_required',
          fee,
          currency,
          durationMinutes: Math.round(durationMinutes),
          paymentOptions,
          sessionId,
          lotId,
          ...(approvalRequired && { approvalRequired: true }),
        })
      } catch {
        // best-effort
      }

      return reply(200, {
        session: session || {
          id: sessionId,
          plateNumber: plate,
          lotId,
          entryTime: new Date(fallbackSerial ? Date.now() - durationMinutes * 60000 : Date.now()),
          status: 'active' as const,
        },
        fee,
        currency,
        durationMinutes: Math.round(durationMinutes),
        paymentOptions,
        ...(approvalRequired && { approvalRequired: true }),
        ...(usingFallback && { fallback: 'hedera-mirror-node', hederaSerial: fallbackSerial }),
        ...(alprResult && { alpr: alprResult }),
      })
    }

    // ---- Phase 3: Payment verified — close session ----

    // Remove from on-chain watcher to prevent double-close
    removePendingPayment(sessionId)

    const isXrplRail = X402_NETWORK.startsWith('xrpl:')
    const paymentVerified = Boolean((req as any).paymentVerified)
    const paymentVerificationRail = (req as any).paymentVerificationRail as
      | 'xrpl'
      | 'evm'
      | undefined
    const isDevSimulated =
      process.env.NODE_ENV === 'development' &&
      (req as any).paymentTxHash === 'simulated-dev-payment'

    // Make XRPL verification path explicit: close only after XRPL adapter verification.
    if (fee > 0 && paymentVerified && isXrplRail && !isDevSimulated) {
      if (paymentVerificationRail !== 'xrpl') {
        paymentFailuresTotal.inc({ reason: 'verification_rail_mismatch' })
        return reply(400, {
          error: 'XRPL payment verification required',
        })
      }
      if (!(req as any).paymentTransfer) {
        paymentFailuresTotal.inc({ reason: 'missing_xrpl_verification_result' })
        return reply(400, {
          error: 'Missing XRPL verification result',
        })
      }
    }

    // Validate on-chain transfer details (when available)
    const transfer = (req as any).paymentTransfer as
      | import('@parker/x402').ERC20TransferResult
      | undefined
    const paymentTxHash =
      typeof (req as any).paymentTxHash === 'string' ? (req as any).paymentTxHash : undefined

    if (isXrplRail && fee > 0 && paymentVerified && !isDevSimulated) {
      const pendingIntent = await db.getActiveXrplPendingIntent(plate, lotId)
      if (!pendingIntent) {
        paymentFailuresTotal.inc({ reason: 'missing_xrpl_pending_intent' })
        return reply(409, {
          error: 'No active XRPL payment intent found for this session',
        })
      }
      if (!transfer) {
        paymentFailuresTotal.inc({ reason: 'missing_xrpl_verification_result' })
        return reply(400, {
          error: 'Missing XRPL verification result',
        })
      }

      const proofHash = paymentTxHash || transfer.txHash
      if (proofHash) {
        const existingByTx = await db.getXrplIntentByTxHash(proofHash)
        if (existingByTx && existingByTx.paymentId !== pendingIntent.paymentId) {
          paymentFailuresTotal.inc({ reason: 'xrpl_replay_detected' })
          return reply(409, {
            error: 'XRPL transaction hash has already been used',
          })
        }
      }

      if (transfer.to !== pendingIntent.destination) {
        paymentFailuresTotal.inc({ reason: 'receiver_mismatch' })
        return reply(400, {
          error: 'Payment receiver mismatch',
          expected: pendingIntent.destination,
          actual: transfer.to,
        })
      }

      const expectedAmount = decimalToScaledBigInt(pendingIntent.amount, 6)
      if (transfer.amount !== expectedAmount) {
        paymentFailuresTotal.inc({ reason: 'amount_mismatch' })
        return reply(400, {
          error: 'Payment amount mismatch',
          expectedAmount: expectedAmount.toString(),
          actualAmount: transfer.amount.toString(),
        })
      }

      if (transfer.paymentReference !== pendingIntent.paymentId) {
        paymentFailuresTotal.inc({ reason: 'payment_reference_mismatch' })
        return reply(400, {
          error: 'Payment memo reference mismatch',
        })
      }

      // Settlement enforcement: bind decision → settlement
      if (pendingIntent.decisionId) {
        const decisionPayload = await db.getDecisionPayloadByDecisionId(
          pendingIntent.decisionId,
        )
        if (decisionPayload) {
          const decision = decisionPayload as PaymentPolicyDecision
          const settlement: SettlementResult = {
            amount: transfer.amount.toString(),
            asset:
              (pendingIntent.asset as Asset) ?? ({
                kind: 'IOU',
                currency: pendingIntent.token ?? X402_STABLECOIN,
                issuer: process.env.XRPL_ISSUER ?? '',
              } as Asset),
            rail: 'xrpl',
            txHash: proofHash,
            payer: transfer.from,
          }
          const enforcement = enforcePayment(decision, settlement)
          if (!enforcement.allowed) {
            await db.insertPolicyEvent({
              eventType: 'enforcementFailed',
              payload: {
                decisionId: pendingIntent.decisionId,
                reason: enforcement.reason,
                settlement: { amount: settlement.amount, rail: settlement.rail, txHash: settlement.txHash },
              },
              paymentId: pendingIntent.paymentId,
              sessionId: pendingIntent.sessionId,
              decisionId: pendingIntent.decisionId,
              txHash: proofHash ?? undefined,
            })
            paymentFailuresTotal.inc({ reason: 'enforcement_failed' })
            return reply(403, {
              error: 'Settlement rejected by policy',
              reason: enforcement.reason,
              decisionId: pendingIntent.decisionId,
            })
          }
        }
        await db.insertPolicyEvent({
          eventType: 'settlementVerified',
          payload: {
            decisionId: pendingIntent.decisionId,
            paymentId: pendingIntent.paymentId,
            amount: transfer.amount.toString(),
            rail: 'xrpl',
          },
          paymentId: pendingIntent.paymentId,
          sessionId: pendingIntent.sessionId,
          decisionId: pendingIntent.decisionId,
          txHash: proofHash ?? undefined,
        })
      }

      const resolved = await db.resolveXrplIntentByPaymentId({
        paymentId: pendingIntent.paymentId,
        txHash: proofHash,
      })
      if (!resolved) {
        paymentFailuresTotal.inc({ reason: 'xrpl_intent_resolution_conflict' })
        return reply(409, {
          error: 'XRPL payment intent is no longer pending',
        })
      }
    } else if (transfer) {
      const expectedReceiver = lot?.operatorWallet || process.env.LOT_OPERATOR_WALLET || ''
      const sameReceiver = X402_NETWORK.startsWith('xrpl:')
        ? transfer.to === expectedReceiver
        : transfer.to.toLowerCase() === expectedReceiver.toLowerCase()
      if (expectedReceiver && !sameReceiver) {
        paymentFailuresTotal.inc({ reason: 'receiver_mismatch' })
        return reply(400, {
          error: 'Payment receiver mismatch',
          expected: expectedReceiver,
          actual: transfer.to,
        })
      }

      // Verify amount is within 1% of expected fee (handles rounding)
      const stablecoinDecimals = 6 // USDC has 6 decimals
      const expectedAmount = BigInt(Math.round(fee * 10 ** stablecoinDecimals))
      if (expectedAmount > 0n) {
        const tolerance = expectedAmount / 100n // 1%
        const diff =
          transfer.amount > expectedAmount
            ? transfer.amount - expectedAmount
            : expectedAmount - transfer.amount
        if (diff > tolerance) {
          paymentFailuresTotal.inc({ reason: 'amount_mismatch' })
          return reply(400, {
            error: 'Payment amount mismatch',
            expectedAmount: expectedAmount.toString(),
            actualAmount: transfer.amount.toString(),
          })
        }
      }
    }

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
        return reply(409, { error: 'Session already closed or not found', plateNumber: plate })
      }
    } else {
      // Try DB close, but don't block the gate if it fails
      try {
        closedSession = await db.endSession(plate, {
          feeAmount: fee,
          feeCurrency: currency,
        })
      } catch (dbErr) {
        console.warn(
          '[exit] DB close failed during fallback — NFT burned, gate will open:',
          (dbErr as Error).message,
        )
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

    logger.info('gate_exit_success', {
      request_id: requestId,
      session_id: closedSession?.id || sessionId,
      lot_id: lotId,
      plate_number: plate,
      using_fallback: usingFallback,
      fee_amount: fee,
      fee_currency: currency,
    })

    return reply(200, {
      session: closedSession || { id: sessionId, plateNumber: plate, lotId, status: 'completed' },
      fee,
      currency,
      durationMinutes: Math.round(durationMinutes),
      ...(usingFallback && { fallback: 'hedera-mirror-node' }),
      ...(alprResult && { alpr: alprResult }),
    })
  } catch (error) {
    console.error('Gate exit failed:', error)
    return reply(500, { error: 'Gate exit failed' })
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
      gracePeriodMinutes: lot.gracePeriodMinutes,
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
    const {
      name,
      address,
      capacity,
      ratePerHour,
      billingMinutes,
      maxDailyFee,
      gracePeriodMinutes,
      currency,
      paymentMethods,
    } = req.body

    // Parse numeric fields — allow 0 as a valid value (only skip if not provided)
    const parseOptionalInt = (v: unknown) =>
      v !== undefined && v !== null && v !== '' ? parseInt(String(v)) : undefined
    const parseOptionalFloat = (v: unknown) =>
      v !== undefined && v !== null && v !== '' ? parseFloat(String(v)) : undefined

    const parsedCapacity = parseOptionalInt(capacity)
    const parsedRate = parseOptionalFloat(ratePerHour)
    const parsedBilling = parseOptionalInt(billingMinutes)
    const parsedMaxFee = parseOptionalFloat(maxDailyFee)
    const parsedGracePeriod = parseOptionalFloat(gracePeriodMinutes)

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
    if (parsedGracePeriod !== undefined && isNaN(parsedGracePeriod)) {
      return res.status(400).json({ error: 'gracePeriodMinutes must be a valid number' })
    }

    const lot = await db.updateLot(req.params.lotId, {
      name,
      address,
      capacity: parsedCapacity,
      ratePerHour: parsedRate,
      billingMinutes: parsedBilling,
      maxDailyFee: parsedMaxFee,
      gracePeriodMinutes: parsedGracePeriod,
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
