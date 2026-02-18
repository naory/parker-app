import express from 'express'
import cors from 'cors'
import { createPaymentMiddleware } from '@parker/x402'
import { createXrplSettlementAdapter } from '@parker/x402-xrpl-settlement-adapter'
import { getPublicClient } from '@parker/core'

import { authRouter } from './routes/auth'
import { driversRouter } from './routes/drivers'
import { gateRouter } from './routes/gate'
import { sessionsRouter } from './routes/sessions'
import { webhooksRouter } from './routes/webhooks'
import { verifyWallet } from './middleware/auth'
import { strictLimit, mediumLimit, standardLimit } from './middleware/rateLimit'
import { observabilityMiddleware } from './middleware/observability'
import { isBaseEnabled } from './services/blockchain'
import { isHederaEnabled } from './services/hedera'
import { isStripeEnabled } from './services/stripe'
import { metrics } from './services/observability'
import { getReadinessReport } from './services/health'

export function createApp() {
  const app = express()

  // Stripe webhooks need raw body — register BEFORE json parser
  app.use('/api/webhooks', webhooksRouter)

  // Middleware
  app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') || '*' }))
  app.use(express.json({ limit: '10mb' }))
  app.use(observabilityMiddleware)
  app.use(verifyWallet)

  // Rate limiting
  app.use('/api/auth', strictLimit)
  app.use('/api/gate/scan', mediumLimit)
  app.use('/api/gate/entry', mediumLimit)
  app.use('/api/gate/exit', mediumLimit)
  app.use('/api/drivers/register', mediumLimit)
  app.use('/api', standardLimit)

  // x402 payment middleware with on-chain verification
  const x402Network = process.env.X402_NETWORK || 'base-sepolia'
  const isXrplRail = x402Network.startsWith('xrpl:')
  const publicClient = !isXrplRail && isBaseEnabled() ? getPublicClient() : undefined
  const settlementAdapter =
    isXrplRail && process.env.XRPL_RPC_URL
      ? createXrplSettlementAdapter({ serverUrl: process.env.XRPL_RPC_URL })
      : undefined
  app.use(
    '/api/gate/exit',
    createPaymentMiddleware({
      network: x402Network,
      token: process.env.X402_STABLECOIN || 'USDC',
      receiverWallet: process.env.LOT_OPERATOR_WALLET,
      publicClient,
      settlementAdapter,
    }),
  )

  // Basic health check (liveness)
  app.get('/healthz', (_req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
    })
  })

  // Detailed readiness check (dependencies/config)
  app.get('/readyz', async (_req, res) => {
    const readiness = await getReadinessReport()
    const status = readiness.ready ? 200 : 503
    res.status(status).json({
      status: readiness.ready ? 'ready' : 'not_ready',
      timestamp: new Date().toISOString(),
      checks: {
        db: readiness.db ? 'ok' : 'fail',
        hedera: readiness.hedera ? 'ok' : 'fail',
        mirror: readiness.mirror ? 'ok' : 'fail',
        paymentRails: readiness.paymentRails,
      },
    })
  })

  // Metrics snapshot
  app.get('/metrics', (_req, res) => {
    res.json({
      timestamp: new Date().toISOString(),
      metrics: metrics.asJson(),
      tracing: { status: 'todo' },
    })
  })

  // Backward-compatible health endpoint
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      hedera: isHederaEnabled() ? 'enabled' : 'disabled',
      base: isBaseEnabled() ? 'enabled' : 'disabled',
      stripe: isStripeEnabled() ? 'enabled' : 'disabled',
    })
  })

  // Routes
  app.use('/api/auth', authRouter)
  app.use('/api/drivers', driversRouter)
  app.use('/api/gate', gateRouter)
  app.use('/api/sessions', sessionsRouter)

  return app
}
