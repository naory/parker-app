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

const app = createApp()
const server = createServer(app)
const port = process.env.PORT || 3001

// WebSocket with authentication
setupWebSocket(server, {
  verifyToken: verifyJwt,
  gateApiKey: process.env.GATE_API_KEY,
})

server.listen(port, () => {
  console.log(`Parker API running on http://localhost:${port}`)
  console.log(`Hedera NFTs: ${isHederaEnabled() ? 'enabled' : 'disabled'}`)
  console.log(`Base registry: ${isBaseEnabled() ? 'enabled' : 'disabled'}`)
  console.log(`Stripe payments: ${isStripeEnabled() ? 'enabled' : 'disabled'}`)

  // Start on-chain payment watcher (only when Base RPC is configured)
  if (isBaseEnabled()) {
    const rpcUrl = process.env.RPC_URL || 'https://sepolia.base.org'
    const client = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) })
    startPaymentWatcher(client as any)
    console.log('On-chain payment watcher: enabled')
  } else {
    startPaymentWatcher(null)
  }
})
