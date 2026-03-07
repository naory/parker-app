import { Router, raw } from 'express'
import { LIFECYCLE_EVENT } from '@parker/core'

import { db } from '../db'
import { notifyGate, notifyDriver } from '../ws/index'
import {
  isHederaEnabled,
  endParkingSessionOnHedera,
  findActiveSessionOnHedera,
} from '../services/hedera'
import { verifyWebhookSignature, isStripeEnabled } from '../services/stripe'
import { logger, paymentFailuresTotal } from '../services/observability'
import { enforceOrReject } from '../services/policy'
import { sessionLifecycleService } from '../services/sessionLifecycle'

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
webhooksRouter.post('/stripe', raw({ type: 'application/json' }), async (req, res) => {
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
    paymentFailuresTotal.inc({ rail: 'stripe', reason: 'invalid_signature' })
    logger.warn('stripe_webhook_signature_invalid', {}, err)
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
        decisionId?: string
        policyHash?: string
      }
      amount_total?: number | null
    }

    const { sessionId, plateNumber, lotId, feeCurrency, decisionId, policyHash } =
      stripeSession.metadata

    if (!sessionId || !plateNumber || !lotId) {
      paymentFailuresTotal.inc({ rail: 'stripe', reason: 'metadata_missing' })
      logger.warn('stripe_webhook_missing_metadata', { metadata: stripeSession.metadata })
      return res.status(400).json({ error: 'Missing session metadata' })
    }

    logger.info('stripe_payment_completed', {
      session_id: sessionId,
      lot_id: lotId,
      plate_number: plateNumber,
    })

    // Calculate fee from Stripe amount (smallest unit → decimal)
    const feeAmount = stripeSession.amount_total ? stripeSession.amount_total / 100 : 0

    try {
      // Replay protection: same Stripe payment id must not settle twice (shared with EVM/XRPL via policy_events)
      const alreadySettled = await db.hasSettlementForTxHash(stripeSession.id)
      if (alreadySettled) {
        logger.info('stripe_webhook_replay_ignored', { tx_hash: stripeSession.id })
        return res.json({ received: true })
      }

      // Check if session is still active
      const session = await db.getActiveSession(plateNumber)
      if (!session) {
        logger.info('stripe_webhook_idempotent_already_closed', {
          session_id: sessionId,
          plate_number: plateNumber,
        })
        return res.json({ received: true })
      }
      if (session.id !== sessionId || session.lotId !== lotId) {
        paymentFailuresTotal.inc({ rail: 'stripe', reason: 'metadata_mismatch' })
        logger.warn('stripe_webhook_metadata_mismatch', {
          metadata_session_id: sessionId,
          active_session_id: session.id,
          metadata_lot_id: lotId,
          active_lot_id: session.lotId,
          plate_number: plateNumber,
        })
        return res.json({ received: true, ignored: true, reason: 'metadata_mismatch' })
      }

      // Settlement enforcement: must pass before closing (same as XRPL/EVM)
      const amountMinor = String(stripeSession.amount_total ?? 0)
      await db.insertPolicyEvent({
        eventType: LIFECYCLE_EVENT.SETTLEMENT_DETECTED,
        payload: { decisionId: decisionId ?? undefined, amount: amountMinor, rail: 'stripe', txHash: stripeSession.id },
        sessionId,
        decisionId: decisionId ?? undefined,
        txHash: stripeSession.id,
      })
      const settlement = {
        amount: amountMinor,
        rail: 'stripe' as const,
        asset: { kind: 'IOU' as const, currency: feeCurrency || 'USD', issuer: '' },
        expectedSessionGrantId: session.policyGrantId ?? null,
        expectedPolicyHash: policyHash || undefined,
      }
      const enforcement = await enforceOrReject(
        db.getDecisionPayloadByDecisionId.bind(db),
        decisionId,
        settlement,
      )
      if (!enforcement.allowed) {
        await db.insertPolicyEvent({
          eventType: LIFECYCLE_EVENT.POLICY_ENFORCEMENT_FAILED,
          payload: {
            reason: enforcement.reason,
            settlement: { amount: amountMinor, rail: 'stripe', txHash: stripeSession.id },
          },
          sessionId,
          decisionId: decisionId ?? undefined,
          txHash: stripeSession.id,
        })
        await sessionLifecycleService.markPaymentFailed(session, {
          reason: 'settlement_rejected',
          decisionId: decisionId ?? undefined,
          txHash: stripeSession.id,
          metadata: { source: 'stripe_webhook', reason: enforcement.reason },
        })
        paymentFailuresTotal.inc({ rail: 'stripe', reason: 'enforcement_failed' })
        await db.insertPolicyEvent({
          eventType: LIFECYCLE_EVENT.SETTLEMENT_REJECTED,
          payload: {
            decisionId: decisionId ?? undefined,
            reason: enforcement.reason,
            settlement: { amount: amountMinor, rail: 'stripe', txHash: stripeSession.id },
          },
          sessionId,
          decisionId: decisionId ?? undefined,
        })
        logger.warn('stripe_webhook_enforcement_failed', {
          session_id: sessionId,
          reason: enforcement.reason,
        })
        return res.json({ received: true })
      }
      await db.insertPolicyEvent({
        eventType: LIFECYCLE_EVENT.POLICY_ENFORCEMENT_PASSED,
        payload: { settlement: { amount: amountMinor, rail: 'stripe', txHash: stripeSession.id } },
        sessionId,
        decisionId: decisionId ?? undefined,
        txHash: stripeSession.id,
      })
      // Decision→grant linkage: decision must reference session's grant when session has one
      if (session.policyGrantId && decisionId) {
        const decisionPayload = (await db.getDecisionPayloadByDecisionId(decisionId)) as
          | { sessionGrantId?: string | null }
          | null
        if (
          decisionPayload?.sessionGrantId != null &&
          decisionPayload.sessionGrantId !== session.policyGrantId
        ) {
          await sessionLifecycleService.markPaymentFailed(session, {
            reason: 'settlement_rejected',
            decisionId,
            txHash: stripeSession.id,
            metadata: { source: 'stripe_webhook', reason: 'NEEDS_APPROVAL' },
          })
          paymentFailuresTotal.inc({ rail: 'stripe', reason: 'enforcement_failed' })
          await db.insertPolicyEvent({
            eventType: LIFECYCLE_EVENT.SETTLEMENT_REJECTED,
            payload: {
              decisionId,
              reason: 'NEEDS_APPROVAL',
              settlement: { amount: amountMinor, rail: 'stripe', txHash: stripeSession.id },
            },
            sessionId,
            decisionId,
          })
          logger.warn('stripe_webhook_grant_mismatch', {
            session_id: sessionId,
          })
          return res.json({ received: true })
        }
      }
      if (decisionId) {
        const consumed = await db.consumeDecisionOnce(decisionId)
        if (!consumed) {
          logger.info('stripe_webhook_decision_consumed_ignored', { decision_id: decisionId })
          return res.json({ received: true, ignored: true, reason: 'decision_already_consumed' })
        }
        await db.insertPolicyEvent({
          eventType: LIFECYCLE_EVENT.SETTLEMENT_VERIFIED,
          payload: { decisionId, amount: amountMinor, rail: 'stripe' },
          sessionId,
          decisionId,
          txHash: stripeSession.id,
        })
      }

      // Burn Hedera NFT if configured
      let nftBurnSucceeded = !isHederaEnabled() || !session.tokenId
      if (isHederaEnabled() && session.tokenId) {
        try {
          await endParkingSessionOnHedera(session.tokenId)
          nftBurnSucceeded = true
        } catch (err) {
          nftBurnSucceeded = false
          paymentFailuresTotal.inc({ rail: 'stripe', reason: 'hedera_burn_failed' })
          logger.warn(
            'stripe_webhook_hedera_burn_failed',
            {
              session_id: sessionId,
              token_id: session.tokenId,
            },
            err,
          )
        }
      }

      // Close the session
      const closedSession = await sessionLifecycleService.closeSession(session, {
        reason: 'settlement_verified',
        decisionId: decisionId ?? undefined,
        txHash: stripeSession.id,
        metadata: {
          source: 'stripe_webhook',
          rail: 'stripe',
          decisionValidated: true,
          decisionNotExpired: true,
          settlementProofVerified: true,
          enforcementPassed: true,
          txHashUnique: true,
          settlementEventPersisted: true,
          nftBurnSucceeded,
          allowDelayedNftBurn: true,
        },
        feeAmount,
        feeCurrency: feeCurrency || 'USD',
        stripePaymentId: stripeSession.id,
      })

      if (!closedSession) {
        paymentFailuresTotal.inc({ rail: 'stripe', reason: 'db_close_failed' })
        logger.warn('stripe_webhook_close_session_failed', {
          session_id: sessionId,
          plate_number: plateNumber,
        })
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

      logger.info('stripe_webhook_session_closed', {
        session_id: sessionId,
        lot_id: lotId,
        plate_number: plateNumber,
      })
    } catch (dbErr) {
      // DB unavailable — fall back to Hedera to burn NFT + notify gate
      paymentFailuresTotal.inc({ rail: 'stripe', reason: 'db_unavailable' })
      logger.warn(
        'stripe_webhook_db_unavailable',
        {
          session_id: sessionId,
          lot_id: lotId,
          plate_number: plateNumber,
        },
        dbErr,
      )

      if (isHederaEnabled()) {
        try {
          // Find the NFT via Mirror Node and burn it
          const nftSession = await findActiveSessionOnHedera(plateNumber)
          if (nftSession) {
            await endParkingSessionOnHedera(nftSession.serial)
            logger.info('stripe_webhook_fallback_burn_success', {
              session_id: sessionId,
              serial: nftSession.serial,
            })
          }
        } catch (hederaErr) {
          paymentFailuresTotal.inc({ rail: 'stripe', reason: 'fallback_hedera_failed' })
          logger.error(
            'stripe_webhook_fallback_hedera_failed',
            { session_id: sessionId },
            hederaErr,
          )
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
      logger.warn('stripe_webhook_db_close_deferred', {
        session_id: sessionId,
        lot_id: lotId,
        plate_number: plateNumber,
      })
    }
  }

  // Return 200 for all event types (Stripe retries on non-2xx)
  res.json({ received: true })
})
