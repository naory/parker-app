import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { createServer } from 'http'
import { createPaymentMiddleware } from '@parker/x402'

import { driversRouter } from './routes/drivers'
import { gateRouter } from './routes/gate'
import { sessionsRouter } from './routes/sessions'
import { webhooksRouter } from './routes/webhooks'
import { setupWebSocket } from './ws/index'
import { isBaseEnabled } from './services/blockchain'
import { isHederaEnabled } from './services/hedera'
import { isStripeEnabled } from './services/stripe'

const app = express()
const server = createServer(app)
const port = process.env.PORT || 3001

// Stripe webhooks need raw body — register BEFORE json parser
app.use('/api/webhooks', webhooksRouter)

// Middleware
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') || '*' }))
app.use(express.json({ limit: '10mb' })) // Large limit for image uploads

// x402 payment middleware (on gate exit routes — amount/token/receiver set dynamically by route handler)
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
app.use('/api/drivers', driversRouter)
app.use('/api/gate', gateRouter)
app.use('/api/sessions', sessionsRouter)

// WebSocket
setupWebSocket(server)

server.listen(port, () => {
  console.log(`Parker API running on http://localhost:${port}`)
  console.log(`Hedera NFTs: ${isHederaEnabled() ? 'enabled' : 'disabled'}`)
  console.log(`Base registry: ${isBaseEnabled() ? 'enabled' : 'disabled'}`)
  console.log(`Stripe payments: ${isStripeEnabled() ? 'enabled' : 'disabled'}`)
})
