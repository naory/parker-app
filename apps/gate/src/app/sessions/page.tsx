'use client'

import { useState, useEffect, useMemo } from 'react'
import type { SessionRecord } from '@parker/core'
import { formatPlate, calculateFee } from '@parker/core'
import { getActiveSessionsByLot, getLotStatus } from '@/lib/api'

export default function Sessions() {
  const lotId = process.env.NEXT_PUBLIC_LOT_ID || ''
  const [sessions, setSessions] = useState<SessionRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [now, setNow] = useState(Date.now())

  // Lot pricing config
  const [lotRate, setLotRate] = useState(12.0)
  const [lotBilling, setLotBilling] = useState(15)
  const [lotMaxFee, setLotMaxFee] = useState<number | undefined>(undefined)
  const [lotCurrency, setLotCurrency] = useState('')

  // Fetch lot config + sessions
  useEffect(() => {
    if (!lotId) {
      setLoading(false)
      return
    }

    // Fetch lot config for pricing
    getLotStatus(lotId)
      .then((lot) => {
        if (lot.ratePerHour) setLotRate(lot.ratePerHour)
        if (lot.billingMinutes) setLotBilling(lot.billingMinutes)
        if (lot.maxDailyFee) setLotMaxFee(lot.maxDailyFee)
        if (lot.currency) setLotCurrency(lot.currency)
      })
      .catch(() => {})

    getActiveSessionsByLot(lotId)
      .then(setSessions)
      .catch(() => setSessions([]))
      .finally(() => setLoading(false))

    // Poll every 15s
    const interval = setInterval(() => {
      getActiveSessionsByLot(lotId).then(setSessions).catch(() => {})
    }, 15_000)

    return () => clearInterval(interval)
  }, [lotId])

  // Tick every second for live durations
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  // Filter by search
  const filtered = useMemo(() => {
    if (!search) return sessions
    const q = search.toLowerCase().replace(/[\s-]/g, '')
    return sessions.filter((s) =>
      s.plateNumber.toLowerCase().replace(/[\s-]/g, '').includes(q),
    )
  }, [sessions, search])

  return (
    <div className="p-6">
      <h1 className="mb-6 text-2xl font-bold text-parker-800">Active Sessions</h1>
      <p className="mb-4 text-sm text-gray-500">Lot: {lotId}</p>

      {/* Search */}
      <div className="mb-6">
        <input
          type="text"
          placeholder="Search by plate number..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-md rounded-lg border border-gray-300 px-4 py-2 focus:border-parker-500 focus:outline-none"
        />
      </div>

      {/* Sessions table */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">Plate</th>
              <th className="px-4 py-3">Entry Time</th>
              <th className="px-4 py-3">Duration</th>
              <th className="px-4 py-3">Est. Fee</th>
              <th className="px-4 py-3">NFT</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                  Loading...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                  {search ? 'No matching sessions' : 'No active sessions'}
                </td>
              </tr>
            ) : (
              filtered.map((session) => {
                const entryDate = new Date(session.entryTime)
                const durationMs = now - entryDate.getTime()
                const durationMin = Math.round(durationMs / 60_000)
                const h = Math.floor(durationMin / 60)
                const m = durationMin % 60
                const fee = calculateFee(durationMin, lotRate, lotBilling, lotMaxFee)

                return (
                  <tr key={session.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium tracking-wider text-parker-800">
                      {formatPlate(session.plateNumber)}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {entryDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {h > 0 ? `${h}h ` : ''}{m}m
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-800">
                      {fee.toFixed(2)} {lotCurrency}
                    </td>
                    <td className="px-4 py-3 text-gray-400">
                      {session.tokenId ? `#${session.tokenId}` : '--'}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
