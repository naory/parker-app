'use client'

import { useState, useEffect } from 'react'
import type { LotStatus, SessionRecord } from '@parker/core'
import { getLotStatus, getActiveSessionsByLot } from '@/lib/api'

export default function OperatorDashboard() {
  const lotId = process.env.NEXT_PUBLIC_LOT_ID || ''
  const [status, setStatus] = useState<LotStatus | null>(null)
  const [sessions, setSessions] = useState<SessionRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [apiError, setApiError] = useState(false)

  useEffect(() => {
    if (!lotId) {
      setLoading(false)
      return
    }

    Promise.all([
      getLotStatus(lotId).catch(() => null),
      getActiveSessionsByLot(lotId).catch(() => []),
    ])
      .then(([lotStatus, activeSessions]) => {
        setStatus(lotStatus)
        setSessions(activeSessions)
        setApiError(!lotStatus && activeSessions.length === 0)
      })
      .finally(() => setLoading(false))

    // Poll every 15s
    const interval = setInterval(() => {
      Promise.all([
        getLotStatus(lotId).catch(() => null),
        getActiveSessionsByLot(lotId).catch(() => []),
      ]).then(([lotStatus, activeSessions]) => {
        if (lotStatus) {
          setStatus(lotStatus)
          setApiError(false)
        } else {
          setApiError(true)
        }
        if (activeSessions.length > 0 || lotStatus) {
          setSessions(activeSessions)
        }
      })
    }, 15_000)

    return () => clearInterval(interval)
  }, [lotId])

  // Calculate dashboard stats
  const occupancy = status ? `${status.currentOccupancy} / ${status.capacity ?? '--'}` : '-- / --'

  const avgDuration =
    sessions.length > 0
      ? (() => {
          const totalMs = sessions.reduce((sum, s) => {
            return sum + (Date.now() - new Date(s.entryTime).getTime())
          }, 0)
          const avgMinutes = Math.round(totalMs / sessions.length / 60_000)
          const h = Math.floor(avgMinutes / 60)
          const m = avgMinutes % 60
          return h > 0 ? `${h}h ${m}m` : `${m}m`
        })()
      : '--'

  return (
    <div className="p-6">
      <h1 className="mb-6 text-2xl font-bold text-parker-800">Operator Dashboard</h1>

      {apiError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          API unavailable — showing last known data. Retrying automatically...
        </div>
      )}

      {loading ? (
        <div className="grid animate-pulse gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 rounded-lg bg-gray-100" />
          ))}
        </div>
      ) : (
        <>
          {/* Stats cards */}
          <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Current Occupancy" value={occupancy} />
            <StatCard label="Active Sessions" value={String(sessions.length)} />
            <StatCard label="Lot" value={status?.name || lotId} />
            <StatCard label="Avg Duration" value={avgDuration} />
          </div>

          {/* Recent active sessions */}
          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold text-gray-700">Active Sessions</h2>
            {sessions.length === 0 ? (
              <p className="text-sm text-gray-400">No active sessions right now.</p>
            ) : (
              <div className="space-y-2">
                {sessions.slice(0, 10).map((session) => {
                  const entryDate = new Date(session.entryTime)
                  const durationMs = Date.now() - entryDate.getTime()
                  const durationMin = Math.round(durationMs / 60_000)
                  const h = Math.floor(durationMin / 60)
                  const m = durationMin % 60

                  return (
                    <div
                      key={session.id}
                      className="flex items-center justify-between border-b border-gray-50 py-2 last:border-0"
                    >
                      <div>
                        <p className="text-sm font-medium text-gray-800">{session.plateNumber}</p>
                        <p className="text-xs text-gray-400">
                          Since{' '}
                          {entryDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                      <p className="text-sm text-gray-500">
                        {h > 0 ? `${h}h ` : ''}
                        {m}m
                      </p>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-parker-800">{value}</p>
    </div>
  )
}
