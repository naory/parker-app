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
  /** Default network to accept payment on (can be overridden per-request via res.locals) */
  network?: string
  /** Default token to accept (can be overridden per-request via res.locals) */
  token?: string
  /** Default operator wallet to receive payment */
  receiverWallet?: string
}

export interface PaymentRequired {
  amount: string
  description: string
  plateNumber: string
  sessionId: string
  /** Override defaults per-request (set by route handler) */
  network?: string
  token?: string
  receiver?: string
}

export function createPaymentMiddleware(options: PaymentMiddlewareOptions = {}): RequestHandler {
  const {
    network: defaultNetwork = 'base-sepolia',
    token: defaultToken = 'USDC',
    receiverWallet: defaultReceiver = process.env.LOT_OPERATOR_WALLET || '0x0',
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
        const network = paymentInfo.network || defaultNetwork
        const token = paymentInfo.token || defaultToken
        const receiver = paymentInfo.receiver || defaultReceiver

        res.status(402)
        return originalJson({
          error: 'Payment Required',
          x402: {
            version: '1',
            network,
            token,
            amount: paymentInfo.amount,
            receiver,
            description: paymentInfo.description,
            metadata: {
              plateNumber: paymentInfo.plateNumber,
              sessionId: paymentInfo.sessionId,
            },
          },
          // Also include the full payment options from the route (for non-x402 clients)
          ...(body?.paymentOptions && { paymentOptions: body.paymentOptions }),
          ...(body?.fee !== undefined && { fee: body.fee }),
          ...(body?.currency && { currency: body.currency }),
          ...(body?.durationMinutes !== undefined && { durationMinutes: body.durationMinutes }),
        })
      }

      return originalJson(body)
    }

    next()
  }

  return middleware
}
