import type { RequestHandler, Request, Response, NextFunction } from 'express'
import type { PublicClient } from 'viem'
import { verifyERC20Transfer, type ERC20TransferResult } from './verify'
import type { SettlementAdapter } from './adapter'

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
 * When `publicClient` is provided, on-chain verification is performed.
 * Without `publicClient` (dev mode): trusts the header with a console warning.
 */

export interface PaymentMiddlewareOptions {
  /** Default network to accept payment on (can be overridden per-request via res.locals) */
  network?: string
  /** Default token to accept (can be overridden per-request via res.locals) */
  token?: string
  /** Default operator wallet to receive payment */
  receiverWallet?: string
  /** viem PublicClient for on-chain tx verification. If omitted, header is trusted (dev mode). */
  publicClient?: PublicClient
  /** Optional settlement adapter (e.g. XRPL) to verify payment proofs. */
  settlementAdapter?: SettlementAdapter
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

const TX_HASH_REGEX = /^0x[0-9a-fA-F]{64}$/

export function createPaymentMiddleware(options: PaymentMiddlewareOptions = {}): RequestHandler {
  const {
    network: defaultNetwork = 'base-sepolia',
    token: defaultToken = 'USDC',
    receiverWallet: defaultReceiver = process.env.LOT_OPERATOR_WALLET || '0x0',
    publicClient,
    settlementAdapter,
  } = options

  const middleware: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
    const isXrplNetwork = defaultNetwork.startsWith('xrpl:')

    // Check if client already provided payment proof
    const paymentHeader = req.headers['x-payment'] as string | undefined
    if (paymentHeader) {
      // Dev simulation bypass — accept 'simulated-dev-payment' in development
      const isDev = process.env.NODE_ENV === 'development'
      if (isDev && paymentHeader === 'simulated-dev-payment') {
        console.warn(`[x402] Dev mode — accepting simulated payment`)
        ;(req as any).paymentVerified = true
        ;(req as any).paymentTxHash = paymentHeader
        ;(req as any).paymentVerificationRail = isXrplNetwork ? 'xrpl' : 'evm'
      } else if (isXrplNetwork) {
        // Explicit XRPL verification path: only settlement adapter is accepted.
        if (!settlementAdapter) {
          return res.status(503).json({
            error: 'XRPL settlement adapter is not configured',
          })
        }
        try {
          const transfer = await settlementAdapter.verifyPayment(paymentHeader)
          // Mark verified only after adapter validation succeeds.
          ;(req as any).paymentVerified = true
          ;(req as any).paymentTxHash = paymentHeader
          ;(req as any).paymentTransfer = transfer
          ;(req as any).paymentVerificationRail = 'xrpl'
        } catch (err) {
          return res.status(400).json({
            error: 'Payment verification failed',
            details: (err as Error).message,
          })
        }
      } else if (publicClient) {
        // On-chain verification mode
        if (!TX_HASH_REGEX.test(paymentHeader)) {
          return res.status(400).json({ error: 'Invalid transaction hash format' })
        }

        try {
          const transfer = await verifyERC20Transfer(publicClient, paymentHeader as `0x${string}`)
          // Mark verified only after receipt/log validation succeeds.
          ;(req as any).paymentVerified = true
          ;(req as any).paymentTxHash = paymentHeader
          ;(req as any).paymentTransfer = transfer
          ;(req as any).paymentVerificationRail = 'evm'
        } catch (err) {
          return res.status(400).json({
            error: 'Payment verification failed',
            details: (err as Error).message,
          })
        }
      } else {
        if (!isDev) {
          return res.status(503).json({
            error: 'No payment verifier configured for selected x402 network',
          })
        }
        // Dev-only fallback for non-XRPL networks without a verifier client.
        console.warn(`[x402] Dev mode — trusting X-PAYMENT header without verification`)
        ;(req as any).paymentVerified = true
        ;(req as any).paymentTxHash = paymentHeader
        ;(req as any).paymentVerificationRail = 'evm'
      }
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
