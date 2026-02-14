'use client'

import { useState, useCallback } from 'react'
import { useAccount } from 'wagmi'
import Link from 'next/link'

import { WalletButton } from '@/components/WalletButton'
import { SessionCard } from '@/components/SessionCard'
import { useDriverProfile } from '@/hooks/useDriverProfile'
import { useParkerSocket } from '@/hooks/useParkerSocket'
import { useAuth } from '@/providers/AuthProvider'

export default function Dashboard() {
  const { isConnected } = useAccount()
  const { plate, isRegistered } = useDriverProfile()
  const { isAuthenticated, signIn, signing } = useAuth()
  const [sessionKey, setSessionKey] = useState(0)

  // Listen for real-time session events — force SessionCard to re-fetch
  const handleSocketEvent = useCallback((event: { type: string }) => {
    if (event.type === 'session_started' || event.type === 'session_ended') {
      setSessionKey((k) => k + 1)
    }
  }, [])

  useParkerSocket(plate, handleSocketEvent)

  if (!isConnected) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-6">
        <h1 className="mb-2 text-3xl font-bold text-parker-800">Parker</h1>
        <p className="mb-8 text-gray-500">Smart Parking, Decentralized</p>
        <WalletButton />
        <Link href="/onboarding" className="mt-4 text-sm text-parker-600 underline">
          New here? Get started
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-md p-6">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-parker-800">Parker</h1>
        <WalletButton />
      </header>

      {/* Sign-in prompt */}
      {!isAuthenticated && (
        <button
          onClick={signIn}
          disabled={signing}
          className="mb-4 w-full rounded-lg bg-parker-600 px-4 py-3 font-medium text-white transition hover:bg-parker-700 disabled:opacity-50"
        >
          {signing ? 'Sign message in wallet...' : 'Sign in with Ethereum'}
        </button>
      )}

      {/* Registration prompt */}
      {!isRegistered && (
        <Link
          href="/register"
          className="mb-6 block rounded-lg border-2 border-dashed border-parker-300 bg-parker-50 p-4 text-center text-parker-700 transition hover:border-parker-400 hover:bg-parker-100"
        >
          Register your vehicle to get started
        </Link>
      )}

      {/* Active Session */}
      <SessionCard key={sessionKey} plate={plate} />

      {/* Quick Actions */}
      <nav className="mt-6 space-y-3">
        <Link
          href="/history"
          className="block rounded-lg border border-gray-200 bg-white p-4 text-gray-700 shadow-sm transition hover:shadow-md"
        >
          Parking History
        </Link>
        <Link
          href="/profile"
          className="block rounded-lg border border-gray-200 bg-white p-4 text-gray-700 shadow-sm transition hover:shadow-md"
        >
          Profile & Settings
        </Link>
      </nav>
    </div>
  )
}
