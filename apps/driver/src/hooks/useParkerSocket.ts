'use client'

import { useEffect, useRef, useCallback, useState } from 'react'

interface SocketEvent {
  type: string
  [key: string]: unknown
}

/**
 * WebSocket hook for the driver app.
 * Connects to /ws/driver/:plate and receives real-time session events.
 *
 * Events:
 * - session_started: a new parking session began
 * - session_ended: session completed (with fee info)
 */
export function useParkerSocket(
  plate: string | null,
  onEvent?: (event: SocketEvent) => void,
) {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [connected, setConnected] = useState(false)
  // Store the latest onEvent in a ref to avoid stale closures
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent

  const connect = useCallback(() => {
    if (!plate) return

    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001/ws'
    const url = `${wsUrl}/driver/${encodeURIComponent(plate)}`

    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      console.log('[ws] Connected to Parker socket')
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as SocketEvent
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
  }, [plate])

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
