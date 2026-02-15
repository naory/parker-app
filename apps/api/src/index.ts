import 'dotenv/config'
import { createServer } from 'http'

import { createApp } from './app'
import { setupWebSocket } from './ws/index'
import { isBaseEnabled } from './services/blockchain'
import { isHederaEnabled } from './services/hedera'
import { isStripeEnabled } from './services/stripe'

const app = createApp()
const server = createServer(app)
const port = process.env.PORT || 3001

// WebSocket
setupWebSocket(server)

server.listen(port, () => {
  console.log(`Parker API running on http://localhost:${port}`)
  console.log(`Hedera NFTs: ${isHederaEnabled() ? 'enabled' : 'disabled'}`)
  console.log(`Base registry: ${isBaseEnabled() ? 'enabled' : 'disabled'}`)
  console.log(`Stripe payments: ${isStripeEnabled() ? 'enabled' : 'disabled'}`)
})
