'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import type { SessionRecord } from '@parker/core'
import { calculateFee } from '@parker/core'

import { getActiveSession, getLotStatus } from '@/lib/api'

interface SessionCardProps {
  plate: string | null
}

export function SessionCard({ plate }: SessionCardProps) {
  const [session, setSession] = useState<SessionRecord | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [loading, setLoading] = useState(true)

  // Lot pricing config (fetched when session is available)
  const [lotRate, setLotRate] = useState(0)
  const [lotBilling, setLotBilling] = useState(15)
  const [lotMaxFee, setLotMaxFee] = useState<number | undefined>(undefined)
  const [lotCurrency, setLotCurrency] = useState('')

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

  // Fetch lot config when session is available
  useEffect(() => {
    if (!session) return
    getLotStatus(session.lotId).then((lot) => {
      if (lot) {
        setLotRate(lot.ratePerHour)
        setLotBilling(lot.billingMinutes)
        if (lot.maxDailyFee) setLotMaxFee(lot.maxDailyFee)
        setLotCurrency(lot.currency)
      }
    })
  }, [session?.lotId])

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

  // Estimate cost using lot pricing
  const durationMinutes = elapsed / 60
  const estimatedCost = lotRate > 0
    ? calculateFee(durationMinutes, lotRate, lotBilling, lotMaxFee)
    : 0

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
          {lotRate > 0
            ? `Estimated cost: ${estimatedCost.toFixed(2)} ${lotCurrency}`
            : 'Calculating...'}
        </p>
      </div>
    </Link>
  )
}
