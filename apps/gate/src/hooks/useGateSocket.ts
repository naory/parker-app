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
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [connected, setConnected] = useState(false)
  // Store the latest onEvent in a ref to avoid stale closures
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent

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
        onEventRef.current?.(data)
      } catch {
        // ignore non-JSON messages
      }
    }

    ws.onclose = () => {
      setConnected(false)
      // Auto-reconnect after 5s (cleared on unmount)
      reconnectTimer.current = setTimeout(connect, 5000)
    }

    ws.onerror = () => {
      ws.close()
    }
  }, [lotId])

  useEffect(() => {
    connect()
    return () => {
      // Clear any pending reconnect timer
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current)
        reconnectTimer.current = null
      }
      wsRef.current?.close()
    }
  }, [connect])

  return { connected }
}
