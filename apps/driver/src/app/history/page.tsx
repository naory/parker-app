'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import type { SessionRecord } from '@parker/core'
import { formatPlate, getHashscanNftUrl } from '@parker/core'

const HEDERA_TOKEN_ID = process.env.NEXT_PUBLIC_HEDERA_TOKEN_ID || ''
const HEDERA_NETWORK = process.env.NEXT_PUBLIC_HEDERA_NETWORK || 'testnet'

import { useDriverProfile } from '@/hooks/useDriverProfile'
import { getSessionHistory, getLotStatus } from '@/lib/api'

export default function History() {
  const { plate } = useDriverProfile()
  const [sessions, setSessions] = useState<SessionRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [lotMap, setLotMap] = useState<Record<string, { name: string; address?: string }>>({})

  useEffect(() => {
    if (!plate) {
      setLoading(false)
      return
    }

    getSessionHistory(plate)
      .then((s) => setSessions(s))
      .catch(() => setSessions([]))
      .finally(() => setLoading(false))
  }, [plate])

  // Fetch lot info for all unique lot IDs
  useEffect(() => {
    if (sessions.length === 0) return
    const uniqueLotIds = [...new Set(sessions.map((s) => s.lotId))]
    Promise.all(
      uniqueLotIds.map((id) =>
        getLotStatus(id).then((lot) => [id, lot] as const),
      ),
    ).then((results) => {
      const map: Record<string, { name: string; address?: string }> = {}
      for (const [id, lot] of results) {
        if (lot) map[id] = { name: lot.name, address: lot.address }
      }
      setLotMap(map)
    })
  }, [sessions])

  return (
    <div className="mx-auto max-w-md p-6">
      <Link href="/" className="mb-4 inline-block text-sm text-parker-600">
        &larr; Back
      </Link>

      <h1 className="mb-6 text-2xl font-bold text-parker-800">Parking History</h1>

      {loading ? (
        <div className="animate-pulse space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-lg bg-gray-100" />
          ))}
        </div>
      ) : sessions.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-gray-400">No parking sessions yet.</p>
          <p className="text-xs text-gray-300">Sessions will appear here after your first park.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map((session) => {
            const entryDate = new Date(session.entryTime)
            const exitDate = session.exitTime ? new Date(session.exitTime) : null
            const durationMs = exitDate
              ? exitDate.getTime() - entryDate.getTime()
              : Date.now() - entryDate.getTime()
            const durationMinutes = Math.round(durationMs / 60_000)
            const hours = Math.floor(durationMinutes / 60)
            const mins = durationMinutes % 60
            const lot = lotMap[session.lotId]

            return (
              <Link key={session.id} href={`/session/${session.id}`}>
                <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition hover:shadow-md">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-800">
                        {lot?.name || `Lot ${session.lotId}`}
                      </p>
                      {lot?.address && (
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lot.address)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs text-parker-500 underline hover:text-parker-700"
                        >
                          {lot.address}
                        </a>
                      )}
                      <p className="text-xs text-gray-400">
                        {entryDate.toLocaleDateString()} at{' '}
                        {entryDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-parker-800">
                        {session.feeAmount !== undefined
                          ? `${session.feeAmount.toFixed(2)} ${session.feeCurrency || ''}`
                          : '--'}
                      </p>
                      <p className="text-xs text-gray-400">
                        {hours > 0 ? `${hours}h ` : ''}{mins}m
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        session.status === 'active'
                          ? 'bg-green-100 text-green-700'
                          : session.status === 'completed'
                            ? 'bg-gray-100 text-gray-500'
                            : 'bg-red-100 text-red-700'
                      }`}
                    >
                      {session.status}
                    </span>
                    {session.tokenId && (
                      HEDERA_TOKEN_ID ? (
                        <a
                          href={getHashscanNftUrl(session.tokenId, HEDERA_TOKEN_ID, HEDERA_NETWORK)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs text-parker-500 hover:text-parker-700 underline"
                        >
                          NFT #{session.tokenId}
                        </a>
                      ) : (
                        <span className="text-xs text-gray-300">NFT #{session.tokenId}</span>
                      )
                    )}
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
