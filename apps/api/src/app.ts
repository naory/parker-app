import express from 'express'
import cors from 'cors'
import { createPaymentMiddleware } from '@parker/x402'

import { authRouter } from './routes/auth'
import { driversRouter } from './routes/drivers'
import { gateRouter } from './routes/gate'
import { sessionsRouter } from './routes/sessions'
import { webhooksRouter } from './routes/webhooks'
import { verifyWallet } from './middleware/auth'
import { isBaseEnabled } from './services/blockchain'
import { isHederaEnabled } from './services/hedera'
import { isStripeEnabled } from './services/stripe'

export function createApp() {
  const app = express()

  // Stripe webhooks need raw body — register BEFORE json parser
  app.use('/api/webhooks', webhooksRouter)

  // Middleware
  app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') || '*' }))
  app.use(express.json({ limit: '10mb' }))
  app.use(verifyWallet)

  // x402 payment middleware
  app.use('/api/gate/exit', createPaymentMiddleware({
    network: process.env.X402_NETWORK || 'base-sepolia',
    token: process.env.X402_STABLECOIN || 'USDC',
    receiverWallet: process.env.LOT_OPERATOR_WALLET,
  }))

  // Health check
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
