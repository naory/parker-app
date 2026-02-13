import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { createServer } from 'http'
import { createPaymentMiddleware } from '@parker/x402'

import { driversRouter } from './routes/drivers'
import { gateRouter } from './routes/gate'
import { sessionsRouter } from './routes/sessions'
import { setupWebSocket } from './ws'
import { isBlockchainEnabled } from './services/blockchain'

const app = express()
const server = createServer(app)
const port = process.env.PORT || 3001

// Middleware
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') || '*' }))
app.use(express.json({ limit: '10mb' })) // Large limit for image uploads

// x402 payment middleware (on gate routes that require payment)
app.use('/api/gate/exit', createPaymentMiddleware({
  maxAmount: '50.00',
  description: 'Parking fee payment',
  network: 'base-sepolia',
  token: 'USDC',
  receiverWallet: process.env.LOT_OPERATOR_WALLET,
}))

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    blockchain: isBlockchainEnabled() ? 'enabled' : 'disabled',
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
  console.log(`Blockchain: ${isBlockchainEnabled() ? 'enabled' : 'disabled (set env vars to enable)'}`)
})
