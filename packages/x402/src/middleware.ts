import type { RequestHandler } from 'express'

/**
 * Creates x402 payment middleware for Express routes.
 *
 * Usage:
 *   app.use(createPaymentMiddleware({ maxAmount: '50.00' }))
 *
 * This wraps @x402/express paymentMiddleware with Parker-specific defaults.
 */
export interface PaymentMiddlewareOptions {
  /** Maximum payment amount in USD (e.g., "50.00") */
  maxAmount?: string
  /** Payment description shown to the driver */
  description?: string
}

export function createPaymentMiddleware(options: PaymentMiddlewareOptions = {}): RequestHandler {
  const { maxAmount = '50.00', description = 'Parking fee payment' } = options

  // TODO: Integrate @x402/express paymentMiddleware once the package is stable
  // For MVP, this is a pass-through that logs payment intent
  const middleware: RequestHandler = (req, res, next) => {
    // In production, this will intercept responses with 402 status
    // and handle x402 payment negotiation automatically
    console.log(`[x402] Payment middleware active — max: $${maxAmount}, desc: ${description}`)
    next()
  }

  return middleware
}
