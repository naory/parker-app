'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import type { SessionRecord } from '@parker/core'
import { calculateFee } from '@parker/core'

import { getActiveSession } from '@/lib/api'

interface SessionCardProps {
  plate: string | null
}

export function SessionCard({ plate }: SessionCardProps) {
  const [session, setSession] = useState<SessionRecord | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [loading, setLoading] = useState(true)

  // Fetch active session
  useEffect(() => {
    if (!plate) {
      setSession(null)
      setLoading(false)
      return
    }

    setLoading(true)
    getActiveSession(plate)
      .then((s) => setSession(s))
      .catch(() => setSession(null))
      .finally(() => setLoading(false))

    // Poll every 30s for updates
    const interval = setInterval(() => {
      getActiveSession(plate).then((s) => setSession(s)).catch(() => {})
    }, 30_000)

    return () => clearInterval(interval)
  }, [plate])

  // Live elapsed timer
  useEffect(() => {
    if (!session) {
      setElapsed(0)
      return
    }

    const entryTime = new Date(session.entryTime).getTime()
    const updateElapsed = () => setElapsed(Math.floor((Date.now() - entryTime) / 1000))
    updateElapsed()

    const interval = setInterval(updateElapsed, 1000)
    return () => clearInterval(interval)
  }, [session])

  if (loading) {
    return (
      <div className="animate-pulse rounded-xl border-2 border-dashed border-gray-200 bg-white p-8 text-center">
        <p className="text-lg font-medium text-gray-300">Checking session...</p>
      </div>
    )
  }

  if (!session) {
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

  // Estimate cost (default rate if lot info not available)
  const durationMinutes = elapsed / 60
  const estimatedCost = calculateFee(durationMinutes, 3.3, 15)

  return (
    <Link href={`/session/${session.id}`}>
      <div className="rounded-xl bg-parker-600 p-6 text-white shadow-lg transition hover:bg-parker-700">
        <p className="text-sm font-medium uppercase tracking-wide opacity-80">Currently Parked</p>
        <p className="mt-1 text-xl font-bold">Lot {session.lotId}</p>
        <div className="mt-4 font-mono text-3xl font-bold">
          {String(hours).padStart(2, '0')}:{String(minutes).padStart(2, '0')}:
          {String(seconds).padStart(2, '0')}
        </div>
        <p className="mt-2 text-sm opacity-80">
          Estimated cost: ${estimatedCost.toFixed(2)}
        </p>
      </div>
    </Link>
  )
}
