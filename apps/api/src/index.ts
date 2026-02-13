import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { createServer } from 'http'

import { driversRouter } from './routes/drivers'
import { gateRouter } from './routes/gate'
import { sessionsRouter } from './routes/sessions'
import { setupWebSocket } from './ws'

const app = express()
const server = createServer(app)
const port = process.env.PORT || 3001

// Middleware
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') || '*' }))
app.use(express.json({ limit: '10mb' })) // Large limit for image uploads

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Routes
app.use('/api/drivers', driversRouter)
app.use('/api/gate', gateRouter)
app.use('/api/sessions', sessionsRouter)

// WebSocket
setupWebSocket(server)

server.listen(port, () => {
  console.log(`Parker API running on http://localhost:${port}`)
})
