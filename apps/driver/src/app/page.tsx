'use client'

import { useState, useCallback, useEffect } from 'react'
import { useAccount } from 'wagmi'
import Link from 'next/link'

import type { PaymentOptions } from '@parker/core'
import { WalletButton } from '@/components/WalletButton'
import { SessionCard } from '@/components/SessionCard'
import { PaymentPrompt } from '@/components/PaymentPrompt'
import { useDriverProfile } from '@/hooks/useDriverProfile'
import { useParkerSocket } from '@/hooks/useParkerSocket'
import { useAuth } from '@/providers/AuthProvider'

export default function Dashboard() {
  const { isConnected } = useAccount()
  const { plate, isRegistered, setPlate } = useDriverProfile()
  const { isAuthenticated, signIn, signing, token } = useAuth()
  const [sessionKey, setSessionKey] = useState(0)
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])
  const [pendingPayment, setPendingPayment] = useState<{
    fee: number
    currency: string
    durationMinutes: number
    paymentOptions: PaymentOptions
    lotId: string
  } | null>(null)
  // Listen for real-time session events — force SessionCard to re-fetch
  const handleSocketEvent = useCallback((event: { type: string; [key: string]: unknown }) => {
    if (event.type === 'session_started' || event.type === 'session_ended') {
      setSessionKey((k) => k + 1)
    }
    if (event.type === 'session_ended') {
      // Payment was confirmed — dismiss the payment prompt
      setPendingPayment(null)
    }
    if (event.type === 'payment_required') {
      setPendingPayment({
        fee: event.fee as number,
        currency: event.currency as string,
        durationMinutes: event.durationMinutes as number,
        paymentOptions: event.paymentOptions as PaymentOptions,
        lotId: event.lotId as string,
      })
    }
  }, [])

  useParkerSocket(plate, handleSocketEvent, token)

  // Avoid hydration mismatch — wallet state is only available on client
  if (!mounted) {
    return null
  }

  if (!isConnected) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-6">
        <h1 className="mb-2 text-3xl text-parker-800">
          <span className="font-bold">Parker</span>{' '}
          <span className="font-light text-parker-400">Driver</span>
        </h1>
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
        <h1 className="text-2xl text-parker-800">
          <span className="font-bold">Parker</span>{' '}
          <span className="font-light text-parker-400">Driver</span>
        </h1>
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

      {/* Registration / link plate prompt */}
      {!isRegistered && (
        <div className="mb-6 rounded-lg border-2 border-dashed border-parker-300 bg-parker-50 p-4">
          <Link
            href="/register"
            className="block text-center text-parker-700 transition hover:text-parker-900"
          >
            Register your vehicle to get started
          </Link>
          <div className="mt-3 border-t border-parker-200 pt-3">
            <p className="mb-2 text-center text-xs text-gray-500">Already registered? Link your plate:</p>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const input = (e.target as HTMLFormElement).plateInput as HTMLInputElement
                const val = input.value.trim().replace(/[\s-]/g, '').toUpperCase()
                if (val) {
                  setPlate(val)
                  input.value = ''
                }
              }}
              className="flex gap-2"
            >
              <input
                name="plateInput"
                type="text"
                placeholder="e.g. 1234588"
                className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-parker-500 focus:outline-none"
              />
              <button
                type="submit"
                className="rounded-lg bg-parker-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-parker-700"
              >
                Link
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Payment prompt (shown when gate triggers exit) */}
      {pendingPayment && plate && (
        <PaymentPrompt
          fee={pendingPayment.fee}
          currency={pendingPayment.currency}
          durationMinutes={pendingPayment.durationMinutes}
          paymentOptions={pendingPayment.paymentOptions}
          plateNumber={plate}
          lotId={pendingPayment.lotId}
          onDismiss={() => setPendingPayment(null)}
          onPaid={() => {
            setPendingPayment(null)
            setSessionKey((k) => k + 1)
          }}
        />
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
