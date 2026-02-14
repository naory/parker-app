'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import type { SessionRecord } from '@parker/core'
import { calculateFee } from '@parker/core'
import { useDriverProfile } from '@/hooks/useDriverProfile'
import { getSessionHistory, getLotStatus } from '@/lib/api'

export default function SessionDetail() {
  const { id } = useParams<{ id: string }>()
  const { plate } = useDriverProfile()
  const [session, setSession] = useState<SessionRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [elapsed, setElapsed] = useState(0)

  // Lot pricing config
  const [lotRate, setLotRate] = useState(0)
  const [lotBilling, setLotBilling] = useState(15)
  const [lotMaxFee, setLotMaxFee] = useState<number | undefined>(undefined)
  const [lotCurrency, setLotCurrency] = useState('')

  // Find session by ID from history
  useEffect(() => {
    if (!plate) {
      setLoading(false)
      return
    }

    getSessionHistory(plate, 100)
      .then((sessions) => {
        const found = sessions.find((s) => s.id === id)
        setSession(found || null)
      })
      .catch(() => setSession(null))
      .finally(() => setLoading(false))
  }, [plate, id])

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

  // Live timer for active sessions
  useEffect(() => {
    if (!session || session.status !== 'active') return

    const entryTime = new Date(session.entryTime).getTime()
    const updateElapsed = () => setElapsed(Math.floor((Date.now() - entryTime) / 1000))
    updateElapsed()

    const interval = setInterval(updateElapsed, 1000)
    return () => clearInterval(interval)
  }, [session])

  if (loading) {
    return (
      <div className="mx-auto max-w-md p-6">
        <Link href="/" className="mb-4 inline-block text-sm text-parker-600">
          &larr; Back
        </Link>
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 rounded bg-gray-200" />
          <div className="h-40 rounded-lg bg-gray-100" />
        </div>
      </div>
    )
  }

  const entryDate = session ? new Date(session.entryTime) : null
  const exitDate = session?.exitTime ? new Date(session.exitTime) : null
  const durationMs = session
    ? exitDate
      ? exitDate.getTime() - entryDate!.getTime()
      : Date.now() - entryDate!.getTime()
    : 0
  const durationMinutes = Math.round(durationMs / 60_000)
  const hours = Math.floor(durationMinutes / 60)
  const mins = durationMinutes % 60

  const estimatedCost = session?.feeAmount ?? (lotRate > 0 ? calculateFee(durationMinutes, lotRate, lotBilling, lotMaxFee) : 0)
  const currency = session?.feeCurrency || lotCurrency

  return (
    <div className="mx-auto max-w-md p-6">
      <Link href="/" className="mb-4 inline-block text-sm text-parker-600">
        &larr; Back
      </Link>

      <h1 className="mb-6 text-2xl font-bold text-parker-800">Session Detail</h1>

      {!session ? (
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <p className="text-gray-400">Session not found.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Status banner */}
          {session.status === 'active' && (
            <div className="rounded-xl bg-parker-600 p-6 text-white shadow-lg">
              <p className="text-sm font-medium uppercase tracking-wide opacity-80">Active Session</p>
              <div className="mt-3 font-mono text-3xl font-bold">
                {String(Math.floor(elapsed / 3600)).padStart(2, '0')}:
                {String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0')}:
                {String(elapsed % 60).padStart(2, '0')}
              </div>
              <p className="mt-2 text-sm opacity-80">
                Est. cost: {estimatedCost.toFixed(2)} {currency}
              </p>
            </div>
          )}

          {/* Session info */}
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <InfoRow label="Session ID" value={session.id} mono />
            <InfoRow label="Lot" value={session.lotId} />
            <InfoRow
              label="Entry"
              value={
                entryDate
                  ? `${entryDate.toLocaleDateString()} ${entryDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                  : '--'
              }
            />
            {exitDate && (
              <InfoRow
                label="Exit"
                value={`${exitDate.toLocaleDateString()} ${exitDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
              />
            )}
            <InfoRow
              label="Duration"
              value={`${hours > 0 ? `${hours}h ` : ''}${mins}m`}
            />
            <InfoRow
              label={session.status === 'completed' ? 'Fee Paid' : 'Est. Fee'}
              value={`${estimatedCost.toFixed(2)} ${currency}`}
            />
            <InfoRow
              label="Status"
              value={session.status}
              badge={
                session.status === 'active'
                  ? 'green'
                  : session.status === 'completed'
                    ? 'gray'
                    : 'red'
              }
            />
          </div>

          {/* On-chain info */}
          {(session.tokenId || session.txHash) && (
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="mb-2 text-sm font-medium text-gray-500">On-chain</p>
              {session.tokenId && <InfoRow label="NFT Token ID" value={`#${session.tokenId}`} />}
              {session.txHash && <InfoRow label="Tx Hash" value={session.txHash} mono />}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function InfoRow({
  label,
  value,
  mono,
  badge,
}: {
  label: string
  value: string
  mono?: boolean
  badge?: 'green' | 'gray' | 'red'
}) {
  return (
    <div className="flex items-center justify-between border-b border-gray-50 py-2 last:border-0">
      <p className="text-sm text-gray-500">{label}</p>
      {badge ? (
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            badge === 'green'
              ? 'bg-green-100 text-green-700'
              : badge === 'red'
                ? 'bg-red-100 text-red-700'
                : 'bg-gray-100 text-gray-500'
          }`}
        >
          {value}
        </span>
      ) : (
        <p className={`text-sm text-gray-800 ${mono ? 'truncate max-w-[180px] font-mono text-xs' : ''}`}>
          {value}
        </p>
      )}
    </div>
  )
}
