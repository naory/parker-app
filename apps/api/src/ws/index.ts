import { Server as HttpServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'

const gateClients = new Map<string, Set<WebSocket>>() // lotId => clients
const driverClients = new Map<string, Set<WebSocket>>() // plate => clients

export function setupWebSocket(server: HttpServer) {
  const wss = new WebSocketServer({ server, path: '/ws' })

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
