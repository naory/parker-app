import { Router, raw } from 'express'

import { db } from '../db'
import { notifyGate, notifyDriver } from '../ws/index'
import { isHederaEnabled, endParkingSessionOnHedera, findActiveSessionOnHedera } from '../services/hedera'
import { verifyWebhookSignature, isStripeEnabled } from '../services/stripe'

export const webhooksRouter = Router()

/**
 * POST /api/webhooks/stripe
 *
 * Handles Stripe webhook events. Uses raw body parsing (required by Stripe
 * for signature verification).
 *
 * On `checkout.session.completed`:
 * 1. Extracts session metadata (sessionId, plateNumber, lotId, feeCurrency)
 * 2. Closes the parking session in DB
 * 3. Burns Hedera NFT (if configured)
 * 4. Sends WebSocket notifications to gate + driver
 */
webhooksRouter.post(
  '/stripe',
  raw({ type: 'application/json' }),
  async (req, res) => {
    if (!isStripeEnabled()) {
      return res.status(503).json({ error: 'Stripe is not configured' })
    }

    const signature = req.headers['stripe-signature'] as string
    if (!signature) {
      return res.status(400).json({ error: 'Missing stripe-signature header' })
    }

    let event
    try {
      event = verifyWebhookSignature(req.body as Buffer, signature)
    } catch (err) {
      console.error('Stripe webhook signature verification failed:', err)
      return res.status(400).json({ error: 'Invalid signature' })
    }

    // Handle the event
    if (event.type === 'checkout.session.completed') {
      const stripeSession = event.data.object as {
        id: string
        metadata: {
          sessionId?: string
          plateNumber?: string
          lotId?: string
          feeCurrency?: string
        }
        amount_total?: number | null
      }

      const { sessionId, plateNumber, lotId, feeCurrency } = stripeSession.metadata

      if (!sessionId || !plateNumber || !lotId) {
        console.error('Stripe webhook: missing metadata', stripeSession.metadata)
        return res.status(400).json({ error: 'Missing session metadata' })
      }

      console.log(`[Stripe] Payment completed for session ${sessionId}, plate ${plateNumber}`)

      // Calculate fee from Stripe amount (smallest unit → decimal)
      const feeAmount = stripeSession.amount_total
        ? stripeSession.amount_total / 100
        : 0

      try {
        // Check if session is still active
        const session = await db.getActiveSession(plateNumber)
        if (!session) {
          console.warn(`[Stripe] Session already closed for ${plateNumber} — idempotent OK`)
          return res.json({ received: true })
        }

        // Burn Hedera NFT if configured
        if (isHederaEnabled() && session.tokenId) {
          try {
            await endParkingSessionOnHedera(session.tokenId)
          } catch (err) {
            console.error('Hedera NFT burn failed during Stripe webhook (continuing):', err)
          }
        }

        // Close the session
        const closedSession = await db.endSession(plateNumber, {
          feeAmount,
          feeCurrency: feeCurrency || 'USD',
          stripePaymentId: stripeSession.id,
        })

        if (!closedSession) {
          console.warn(`[Stripe] Failed to close session for ${plateNumber}`)
          return res.json({ received: true })
        }

        const durationMs = closedSession.exitTime
          ? closedSession.exitTime.getTime() - closedSession.entryTime.getTime()
          : 0
        const durationMinutes = Math.round(durationMs / (1000 * 60))

        // WebSocket notifications — use closedSession.feeCurrency (has fallback applied)
        const currency = closedSession.feeCurrency || feeCurrency || 'USD'
        notifyGate(lotId, {
          type: 'exit',
          session: closedSession,
          plate: plateNumber,
          fee: feeAmount,
          currency,
          paymentMethod: 'stripe',
        })
        notifyDriver(plateNumber, {
          type: 'session_ended',
          session: closedSession,
          fee: feeAmount,
          currency,
          durationMinutes,
          paymentMethod: 'stripe',
        })

        console.log(`[Stripe] Session ${sessionId} closed successfully`)
      } catch (dbErr) {
        // DB unavailable — fall back to Hedera to burn NFT + notify gate
        console.warn(`[Stripe] DB unavailable during webhook, attempting Hedera fallback:`, (dbErr as Error).message)

        if (isHederaEnabled()) {
          try {
            // Find the NFT via Mirror Node and burn it
            const nftSession = await findActiveSessionOnHedera(plateNumber)
            if (nftSession) {
              await endParkingSessionOnHedera(nftSession.serial)
              console.log(`[Stripe] Burned NFT serial=${nftSession.serial} via fallback`)
            }
          } catch (hederaErr) {
            console.error('[Stripe] Hedera fallback also failed:', hederaErr)
          }
        }

        // Notify gate to open (best-effort — payment was confirmed by Stripe)
        try {
          notifyGate(lotId, {
            type: 'exit',
            session: { id: sessionId, plateNumber, lotId },
            plate: plateNumber,
            fee: feeAmount,
            currency: feeCurrency || 'USD',
            paymentMethod: 'stripe',
          })
          notifyDriver(plateNumber, {
            type: 'session_ended',
            session: { id: sessionId, plateNumber, lotId },
            fee: feeAmount,
            currency: feeCurrency || 'USD',
            paymentMethod: 'stripe',
          })
        } catch {
          // WS notifications are best-effort
        }

        // Return 200 so Stripe doesn't retry — payment is confirmed, gate was notified.
        // DB session will be reconciled when DB comes back (P2: DB sync queue).
        console.warn(`[Stripe] Session ${sessionId} — payment confirmed, NFT burned, DB close deferred`)
      }
    }

    // Return 200 for all event types (Stripe retries on non-2xx)
    res.json({ received: true })
  },
)
