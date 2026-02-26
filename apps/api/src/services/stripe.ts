/**
 * Stripe payment service for Parker.
 *
 * Creates Stripe Checkout Sessions for credit card payments in the lot's
 * local currency. Handles webhook signature verification.
 */

import Stripe from 'stripe'
import type { Lot, SessionRecord } from '@parker/core'

// ---- Configuration ----

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET
const STRIPE_SUCCESS_URL = process.env.STRIPE_SUCCESS_URL || 'http://localhost:3000/payment/success'
const STRIPE_CANCEL_URL = process.env.STRIPE_CANCEL_URL || 'http://localhost:3000/payment/cancel'

// ---- Client (lazy singleton) ----

let _stripe: Stripe | null = null

function getStripe(): Stripe {
  if (!_stripe) {
    if (!STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY is required')
    }
    _stripe = new Stripe(STRIPE_SECRET_KEY)
  }
  return _stripe
}

// ---- Status Check ----

export function isStripeEnabled(): boolean {
  return !!STRIPE_SECRET_KEY
}

// ---- Checkout ----

/**
 * Create a Stripe Checkout Session for a parking fee.
 *
 * @param session - The active parking session
 * @param lot - The lot configuration (provides currency)
 * @param feeAmount - Fee in the lot's local currency
 * @param policyBind - Optional policy decision binding (decisionId, policyHash, rail) for enforcement
 * @returns The Stripe Checkout Session URL
 */
export async function createParkingCheckout(
  session: SessionRecord,
  lot: Lot,
  feeAmount: number,
  policyBind?: { decisionId: string; policyHash: string; rail: string },
): Promise<{ checkoutUrl: string; stripeSessionId: string }> {
  const stripe = getStripe()

  // Stripe expects amounts in the smallest currency unit (cents, agorot, etc.)
  const amountInSmallestUnit = Math.round(feeAmount * 100)

  const metadata: Record<string, string> = {
    sessionId: session.id,
    plateNumber: session.plateNumber,
    lotId: lot.id,
    feeCurrency: lot.currency,
  }
  if (policyBind) {
    metadata.decisionId = policyBind.decisionId
    metadata.policyHash = policyBind.policyHash
    metadata.rail = policyBind.rail
  }

  const checkoutSession = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    mode: 'payment',
    line_items: [
      {
        price_data: {
          currency: lot.currency.toLowerCase(),
          product_data: {
            name: `Parking at ${lot.name}`,
            description: `Session ${session.id} — ${session.plateNumber}`,
          },
          unit_amount: amountInSmallestUnit,
        },
        quantity: 1,
      },
    ],
    metadata,
    success_url: `${STRIPE_SUCCESS_URL}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: STRIPE_CANCEL_URL,
  })

  if (!checkoutSession.url) {
    throw new Error('Stripe Checkout Session created without a URL')
  }

  return {
    checkoutUrl: checkoutSession.url,
    stripeSessionId: checkoutSession.id,
  }
}

// ---- Webhook Verification ----

/**
 * Verify a Stripe webhook signature and parse the event.
 *
 * @param rawBody - Raw request body (Buffer)
 * @param signature - Stripe-Signature header value
 * @returns The verified Stripe event
 */
export function verifyWebhookSignature(rawBody: Buffer, signature: string): Stripe.Event {
  if (!STRIPE_WEBHOOK_SECRET) {
    throw new Error('STRIPE_WEBHOOK_SECRET is required for webhook verification')
  }

  const stripe = getStripe()
  return stripe.webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET)
}
