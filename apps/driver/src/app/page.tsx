'use client'

import { useAccount } from 'wagmi'
import Link from 'next/link'

import { WalletButton } from '@/components/WalletButton'
import { SessionCard } from '@/components/SessionCard'

export default function Dashboard() {
  const { isConnected } = useAccount()

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

      {/* Active Session */}
      <SessionCard />

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
