'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import type { SessionRecord } from '@parker/core'
import { calculateFee } from '@parker/core'

import { getActiveSession, getLotStatus } from '@/lib/api'

interface SessionCardProps {
  plate: string | null
}

export function SessionCard({ plate }: SessionCardProps) {
  const router = useRouter()
  const [session, setSession] = useState<SessionRecord | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [loading, setLoading] = useState(true)

  // Lot pricing config (fetched when session is available)
  const [lotRate, setLotRate] = useState(0)
  const [lotBilling, setLotBilling] = useState(15)
  const [lotMaxFee, setLotMaxFee] = useState<number | undefined>(undefined)
  const [lotCurrency, setLotCurrency] = useState('')
  const [lotName, setLotName] = useState<string | null>(null)
  const [lotAddress, setLotAddress] = useState<string | null>(null)
  const [lotGracePeriod, setLotGracePeriod] = useState(0)

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
        if (lot.name) setLotName(lot.name)
        if (lot.address) setLotAddress(lot.address)
        setLotGracePeriod(lot.gracePeriodMinutes ?? 0)
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

  // Grace period logic
  const gracePeriodSeconds = lotGracePeriod * 60
  const inGracePeriod = gracePeriodSeconds > 0 && elapsed < gracePeriodSeconds
  const graceRemaining = Math.max(0, Math.ceil(gracePeriodSeconds - elapsed))
  const graceMin = Math.floor(graceRemaining / 60)
  const graceSec = graceRemaining % 60

  // Timer display
  const hours = Math.floor(elapsed / 3600)
  const minutes = Math.floor((elapsed % 3600) / 60)
  const seconds = elapsed % 60

  // Estimate cost using lot pricing
  const durationMinutes = elapsed / 60
  const estimatedCost = lotRate > 0
    ? calculateFee(durationMinutes, lotRate, lotBilling, lotMaxFee, lotGracePeriod)
    : 0

  return (
    <div
      onClick={() => router.push(`/session/${session.id}`)}
      className="cursor-pointer rounded-xl bg-parker-600 p-6 text-white shadow-lg transition hover:bg-parker-700"
    >
      <p className="text-sm font-medium uppercase tracking-wide opacity-80">
        {inGracePeriod ? 'Grace Period' : 'Currently Parked'}
      </p>
      <p className="mt-1 text-xl font-bold">{lotName || `Lot ${session.lotId}`}</p>
      {lotAddress && (
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lotAddress)}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="mt-0.5 inline-block text-sm underline opacity-80 hover:opacity-100"
        >
          {lotAddress}
        </a>
      )}

      {inGracePeriod ? (
        <>
          <div className="mt-4 font-mono text-3xl font-bold">
            {String(graceMin).padStart(2, '0')}:{String(graceSec).padStart(2, '0')}
          </div>
          <p className="mt-2 text-sm opacity-80">Free exit remaining</p>
        </>
      ) : (
        <>
          <div className="mt-4 font-mono text-3xl font-bold">
            {String(hours).padStart(2, '0')}:{String(minutes).padStart(2, '0')}:
            {String(seconds).padStart(2, '0')}
          </div>
          <p className="mt-2 text-sm opacity-80">
            {lotRate > 0
              ? `Estimated cost: ${estimatedCost.toFixed(2)} ${lotCurrency}`
              : 'Calculating...'}
          </p>
        </>
      )}
    </div>
  )
}
