import 'dotenv/config'
import { createServer } from 'http'

import { createApp } from './app'
import { setupWebSocket } from './ws/index'
import { verifyJwt } from './routes/auth'
import { createPublicClient, http } from 'viem'
import { baseSepolia } from 'viem/chains'
import { isBaseEnabled } from './services/blockchain'
import { isHederaEnabled } from './services/hedera'
import { isStripeEnabled } from './services/stripe'
import { startPaymentWatcher } from './services/paymentWatcher'
import { logger } from './services/observability'

const app = createApp()
const server = createServer(app)
const port = process.env.PORT || 3001

// WebSocket with authentication
setupWebSocket(server, {
  verifyToken: verifyJwt,
  gateApiKey: process.env.GATE_API_KEY,
})

server.listen(port, () => {
  logger.info('api_server_started', {
    port: Number(port),
    url: `http://localhost:${port}`,
    hedera_enabled: isHederaEnabled(),
    base_enabled: isBaseEnabled(),
    stripe_enabled: isStripeEnabled(),
  })

  // Start on-chain payment watcher (only when Base RPC is configured)
  if (isBaseEnabled()) {
    const rpcUrl = process.env.RPC_URL || 'https://sepolia.base.org'
    const client = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) })
    startPaymentWatcher(client as any)
    logger.info('payment_watcher_started', { enabled: true })
  } else {
    startPaymentWatcher(null)
    logger.info('payment_watcher_started', { enabled: false })
  }
})
