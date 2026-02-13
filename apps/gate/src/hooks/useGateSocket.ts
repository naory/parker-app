'use client'

import { useEffect, useRef, useCallback, useState } from 'react'

interface GateEvent {
  type: string
  [key: string]: unknown
}

/**
 * WebSocket hook for the gate app.
 * Connects to /ws/gate/:lotId and receives real-time gate events.
 *
 * Events:
 * - entry: a vehicle entered the lot
 * - exit: a vehicle exited the lot
 */
export function useGateSocket(
  lotId: string | null,
  onEvent?: (event: GateEvent) => void,
) {
  const wsRef = useRef<WebSocket | null>(null)
  const [connected, setConnected] = useState(false)

  const connect = useCallback(() => {
    if (!lotId) return

    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001/ws'
    const url = `${wsUrl}/gate/${encodeURIComponent(lotId)}`

    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      console.log('[ws] Connected to gate socket')
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as GateEvent
        onEvent?.(data)
      } catch {
        // ignore non-JSON messages
      }
    }

    ws.onclose = () => {
      setConnected(false)
      // Auto-reconnect after 5s
      setTimeout(connect, 5000)
    }

    ws.onerror = () => {
      ws.close()
    }
  }, [lotId, onEvent])

  useEffect(() => {
    connect()
    return () => {
      wsRef.current?.close()
    }
  }, [connect])

  return { connected }
}
