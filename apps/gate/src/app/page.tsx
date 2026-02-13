'use client'

import { useState } from 'react'

import { CameraFeed } from '@/components/CameraFeed'
import { PlateResult } from '@/components/PlateResult'
import { GateStatus } from '@/components/GateStatus'

export default function GateView() {
  const [mode, setMode] = useState<'entry' | 'exit'>('entry')
  const [lastPlate, setLastPlate] = useState<string | null>(null)
  const [gateOpen, setGateOpen] = useState(false)

  async function handlePlateDetected(plate: string) {
    setLastPlate(plate)

    const apiUrl = process.env.NEXT_PUBLIC_API_URL
    const lotId = process.env.NEXT_PUBLIC_LOT_ID

    try {
      const endpoint = mode === 'entry' ? '/api/gate/entry' : '/api/gate/exit'
      const res = await fetch(`${apiUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plateNumber: plate, lotId }),
      })

      if (res.ok) {
        setGateOpen(true)
        setTimeout(() => setGateOpen(false), 5000)
      }
    } catch (error) {
      console.error('Gate operation failed:', error)
    }
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-parker-800">Live Gate</h1>

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

        {/* Gate status + manual entry */}
        <div className="space-y-6">
          <GateStatus open={gateOpen} mode={mode} />

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
