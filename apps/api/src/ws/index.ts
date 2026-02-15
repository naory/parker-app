import { Server as HttpServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'

const gateClients = new Map<string, Set<WebSocket>>() // lotId => clients
const driverClients = new Map<string, Set<WebSocket>>() // plate => clients

export interface WsOptions {
  verifyToken?: (token: string) => Promise<string | null>
  gateApiKey?: string
}

export function setupWebSocket(server: HttpServer, options: WsOptions = {}) {
  const wss = new WebSocketServer({ noServer: true })
  const isDev = process.env.NODE_ENV === 'development'

  // Handle HTTP upgrade manually — accept any path starting with /ws
  server.on('upgrade', async (req, socket, head) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`)
    const pathname = url.pathname

    if (!pathname.startsWith('/ws')) {
      socket.destroy()
      return
    }

    // Authentication (skip in development mode)
    if (!isDev) {
      const isGatePath = pathname.startsWith('/ws/gate/')

      // Gate paths accept apiKey
      if (isGatePath && options.gateApiKey) {
        const apiKey = url.searchParams.get('apiKey')
        if (apiKey === options.gateApiKey) {
          wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit('connection', ws, req)
          })
          return
        }
      }

      // All paths accept JWT token
      const token = url.searchParams.get('token')
        || req.headers.authorization?.replace('Bearer ', '')

      if (token && options.verifyToken) {
        const address = await options.verifyToken(token)
        if (address) {
          wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit('connection', ws, req)
          })
          return
        }
      }

      // No valid auth provided
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req)
    })
  })

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`)
    const path = url.pathname

    // /ws/gate/:lotId
    const gateMatch = path.match(/^\/ws\/gate\/(.+)$/)
    if (gateMatch) {
      const lotId = gateMatch[1]
      if (!gateClients.has(lotId)) gateClients.set(lotId, new Set())
      gateClients.get(lotId)!.add(ws)

      ws.on('close', () => gateClients.get(lotId)?.delete(ws))
      ws.send(JSON.stringify({ type: 'connected', lotId }))
      return
    }

    // /ws/driver/:plate
    const driverMatch = path.match(/^\/ws\/driver\/(.+)$/)
    if (driverMatch) {
      const plate = decodeURIComponent(driverMatch[1])
      if (!driverClients.has(plate)) driverClients.set(plate, new Set())
      driverClients.get(plate)!.add(ws)

      ws.on('close', () => driverClients.get(plate)?.delete(ws))
      ws.send(JSON.stringify({ type: 'connected', plate }))
      return
    }

    ws.close(4000, 'Invalid WebSocket path')
  })

  console.log('WebSocket server ready')
}

/** Notify all gate clients for a lot about an event */
export function notifyGate(lotId: string, event: object) {
  const clients = gateClients.get(lotId)
  if (!clients) return
  const message = JSON.stringify(event)
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message)
    }
  }
}

/** Notify a specific driver about their session */
export function notifyDriver(plate: string, event: object) {
  const clients = driverClients.get(plate)
  if (!clients) return
  const message = JSON.stringify(event)
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message)
    }
  }
}
