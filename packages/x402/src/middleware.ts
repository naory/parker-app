import type { RequestHandler, Request, Response, NextFunction } from 'express'

/**
 * x402 Payment Middleware for Parker.
 *
 * Flow:
 * 1. Route handler sets `res.locals.paymentRequired` with amount and details
 * 2. This middleware intercepts the response and returns HTTP 402 with x402 headers
 * 3. Client wallet signs the payment
 * 4. Client resends request with `X-PAYMENT` header containing signed tx
 * 5. Middleware verifies payment, allows request through
 *
 * For MVP: Middleware checks for an `X-PAYMENT` header. If present, it marks
 * payment as complete. If not, and the route signals payment is needed,
 * it returns a 402 response with payment instructions.
 */

export interface PaymentMiddlewareOptions {
  /** Maximum payment amount in USD (e.g., "50.00") */
  maxAmount?: string
  /** Payment description shown to the driver */
  description?: string
  /** Network to accept payment on */
  network?: string
  /** Token to accept */
  token?: string
  /** Operator wallet to receive payment */
  receiverWallet?: string
}

export interface PaymentRequired {
  amount: string
  description: string
  plateNumber: string
  sessionId: string
}

export function createPaymentMiddleware(options: PaymentMiddlewareOptions = {}): RequestHandler {
  const {
    maxAmount = '50.00',
    description = 'Parking fee payment',
    network = 'base-sepolia',
    token = 'USDC',
    receiverWallet = process.env.LOT_OPERATOR_WALLET || '0x0',
  } = options

  const middleware: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
    // Check if client already provided payment proof
    const paymentHeader = req.headers['x-payment'] as string | undefined
    if (paymentHeader) {
      // In production: verify the signed transaction / payment proof on-chain
      // For MVP: trust the header and mark payment as verified
      console.log(`[x402] Payment header received: ${paymentHeader.slice(0, 20)}...`)
      ;(req as any).paymentVerified = true
      ;(req as any).paymentTxHash = paymentHeader
    }

    // Intercept the response to check if the route requested payment
    const originalJson = res.json.bind(res)
    res.json = function (body: any) {
      const paymentInfo = res.locals.paymentRequired as PaymentRequired | undefined

      // If route requested payment and client hasn't paid yet
      if (paymentInfo && !(req as any).paymentVerified) {
        res.status(402)
        return originalJson({
          error: 'Payment Required',
          x402: {
            version: '1',
            network,
            token,
            amount: paymentInfo.amount,
            maxAmount,
            receiver: receiverWallet,
            description: paymentInfo.description || description,
            metadata: {
              plateNumber: paymentInfo.plateNumber,
              sessionId: paymentInfo.sessionId,
            },
          },
        })
      }

      return originalJson(body)
    }

    next()
  }

  return middleware
}
