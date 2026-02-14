'use client'

import { useState, useCallback } from 'react'

import { CameraFeed } from '@/components/CameraFeed'
import { PlateResult } from '@/components/PlateResult'
import { GateStatus } from '@/components/GateStatus'
import { useGateSocket } from '@/hooks/useGateSocket'
import { useSessionCache } from '@/hooks/useSessionCache'

export default function GateView() {
  const [mode, setMode] = useState<'entry' | 'exit'>('entry')
  const [lastPlate, setLastPlate] = useState<string | null>(null)
  const [gateOpen, setGateOpen] = useState(false)

  const lotId = process.env.NEXT_PUBLIC_LOT_ID || null

  // Layer 3 resilience: local session cache from WebSocket events
  const { addEntry, removeExit, getSession, sessionCount } = useSessionCache()

  // Real-time gate events via WebSocket
  const handleGateEvent = useCallback((event: { type: string; [key: string]: unknown }) => {
    if (event.type === 'entry') {
      const plate = event.plate as string
      if (plate) setLastPlate(plate)
      // Cache the entry for offline resilience
      addEntry(event)
    }
    if (event.type === 'exit') {
      const plate = event.plate as string
      if (plate) setLastPlate(plate)
      // Remove from local cache
      removeExit(event)
      // Payment confirmed (from Stripe webhook or x402) — open the gate
      setGateOpen(true)
      setTimeout(() => setGateOpen(false), 5000)
      const fee = event.fee as number | undefined
      const currency = (event.currency as string) || ''
      const method = (event.paymentMethod as string) || ''
      setLastResult({
        success: true,
        message: `Payment received${method ? ` (${method})` : ''} — ${fee?.toFixed(2)} ${currency}. Gate open.`,
        fee,
        currency,
        waitingForPayment: false,
      })
    }
  }, [addEntry, removeExit])

  const { connected: wsConnected } = useGateSocket(lotId, handleGateEvent)

  const [lastResult, setLastResult] = useState<{
    success: boolean
    message: string
    fee?: number
    currency?: string
    waitingForPayment?: boolean
  } | null>(null)

  async function handlePlateDetected(plate: string) {
    setLastPlate(plate)
    setLastResult(null)

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
    const lotId = process.env.NEXT_PUBLIC_LOT_ID || ''

    try {
      const endpoint = mode === 'entry' ? '/api/gate/entry' : '/api/gate/exit'
      const res = await fetch(`${apiUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plateNumber: plate, lotId }),
      })

      const data = await res.json()

      if (res.ok) {
        if (mode === 'entry') {
          setGateOpen(true)
          setTimeout(() => setGateOpen(false), 5000)
          setLastResult({
            success: true,
            message: 'Vehicle entered — session started',
          })
        } else if (data.paymentOptions && Object.keys(data.paymentOptions).length > 0) {
          // Exit with pending payment — waiting for driver to pay
          setLastResult({
            success: true,
            message: `Fee: ${data.fee?.toFixed(2)} ${data.currency || ''} — waiting for payment...`,
            fee: data.fee,
            currency: data.currency,
            waitingForPayment: true,
          })
        } else {
          // Exit with payment already completed
          setGateOpen(true)
          setTimeout(() => setGateOpen(false), 5000)
          setLastResult({
            success: true,
            message: `Vehicle exited — ${data.durationMinutes}min, ${data.fee?.toFixed(2)} ${data.currency || ''}`,
            fee: data.fee,
            currency: data.currency,
          })
        }
      } else if (res.status === 402 && data.fee !== undefined) {
        // HTTP 402 Payment Required — x402 middleware returned payment details
        setLastResult({
          success: true,
          message: `Fee: ${data.fee?.toFixed(2)} ${data.currency || ''} (${data.durationMinutes}min) — waiting for payment...`,
          fee: data.fee,
          currency: data.currency,
          waitingForPayment: true,
        })
      } else {
        setLastResult({ success: false, message: data.error || 'Operation failed' })
      }
    } catch (error) {
      console.error('Gate operation failed:', error)

      // OFFLINE FALLBACK: handle API-unreachable scenarios
      if (mode === 'exit') {
        // Exit: use local session cache to validate and open the gate
        const cached = getSession(plate)
        if (cached) {
          const durationMin = Math.round((Date.now() - cached.entryTime) / 60_000)
          setLastResult({
            success: true,
            message: `[Offline] Session found in local cache — ${durationMin}min parked. Gate opening (payment deferred).`,
            waitingForPayment: false,
          })
          setGateOpen(true)
          setTimeout(() => setGateOpen(false), 5000)
          removeExit({ plate })
          return
        }
        setLastResult({ success: false, message: 'Network error — no cached session found for this plate' })
      } else {
        // Entry: can't validate driver/lot remotely — warn operator
        setLastResult({
          success: false,
          message: 'Network error — cannot verify driver registration. Check connectivity and retry.',
        })
      }
    }
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold text-parker-800">Live Gate</h1>
          <span
            className={`h-2 w-2 rounded-full ${wsConnected ? 'bg-green-500' : 'bg-gray-300'}`}
            title={wsConnected ? 'Connected' : 'Disconnected'}
          />
          {sessionCount > 0 && (
            <span
              className="rounded-full bg-parker-100 px-2 py-0.5 text-xs font-medium text-parker-700"
              title={`${sessionCount} session(s) cached locally for offline resilience`}
            >
              {sessionCount} cached
            </span>
          )}
        </div>

        {/* Mode toggle */}
        <div className="flex rounded-lg bg-gray-200 p-1">
          <button
            onClick={() => setMode('entry')}
            className={`rounded-md px-4 py-2 text-sm font-medium transition ${
              mode === 'entry'
                ? 'bg-green-500 text-white'
                : 'text-gray-600 hover:text-gray-800'
            }`}
          >
            Entry
          </button>
          <button
            onClick={() => setMode('exit')}
            className={`rounded-md px-4 py-2 text-sm font-medium transition ${
              mode === 'exit'
                ? 'bg-red-500 text-white'
                : 'text-gray-600 hover:text-gray-800'
            }`}
          >
            Exit
          </button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Camera + ALPR */}
        <div>
          <CameraFeed onCapture={handlePlateDetected} />
          {lastPlate && <PlateResult plate={lastPlate} mode={mode} />}
        </div>

        {/* Gate status + result + manual entry */}
        <div className="space-y-6">
          <GateStatus open={gateOpen} mode={mode} />

          {/* Operation result */}
          {lastResult && (
            <div
              className={`rounded-lg p-4 text-sm font-medium ${
                lastResult.waitingForPayment
                  ? 'bg-yellow-50 text-yellow-700 border border-yellow-200'
                  : lastResult.success
                    ? 'bg-green-50 text-green-700 border border-green-200'
                    : 'bg-red-50 text-red-700 border border-red-200'
              }`}
            >
              {lastResult.message}
              {lastResult.waitingForPayment && (
                <div className="mt-2 flex items-center gap-2">
                  <div className="h-2 w-2 animate-pulse rounded-full bg-yellow-500" />
                  <span className="text-xs">Gate will open automatically when payment is confirmed</span>
                </div>
              )}
            </div>
          )}

          {/* Manual plate input */}
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <h3 className="mb-2 text-sm font-medium text-gray-500">Manual Entry</h3>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const input = (e.target as HTMLFormElement).plate as HTMLInputElement
                if (input.value) {
                  handlePlateDetected(input.value)
                  input.value = ''
                }
              }}
              className="flex gap-2"
            >
              <input
                name="plate"
                type="text"
                placeholder="Enter plate number"
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-parker-500 focus:outline-none"
              />
              <button
                type="submit"
                className="rounded-lg bg-parker-600 px-4 py-2 text-sm font-medium text-white hover:bg-parker-700"
              >
                Process
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}
