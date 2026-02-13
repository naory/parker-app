'use client'

import { useState, useEffect } from 'react'

export function SessionCard() {
  // TODO: Fetch active session from API
  const [hasSession] = useState(false)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!hasSession) return
    const interval = setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => clearInterval(interval)
  }, [hasSession])

  if (!hasSession) {
    return (
      <div className="rounded-xl border-2 border-dashed border-gray-200 bg-white p-8 text-center">
        <p className="text-lg font-medium text-gray-400">Not currently parked</p>
        <p className="mt-1 text-sm text-gray-300">Your active session will appear here</p>
      </div>
    )
  }

  const hours = Math.floor(elapsed / 3600)
  const minutes = Math.floor((elapsed % 3600) / 60)
  const seconds = elapsed % 60

  return (
    <div className="rounded-xl bg-parker-600 p-6 text-white shadow-lg">
      <p className="text-sm font-medium uppercase tracking-wide opacity-80">Currently Parked</p>
      <p className="mt-1 text-xl font-bold">Lot Name</p>
      <div className="mt-4 text-3xl font-mono font-bold">
        {String(hours).padStart(2, '0')}:{String(minutes).padStart(2, '0')}:
        {String(seconds).padStart(2, '0')}
      </div>
      <p className="mt-2 text-sm opacity-80">Estimated cost: $0.00</p>
    </div>
  )
}
