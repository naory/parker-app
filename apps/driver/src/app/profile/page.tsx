'use client'

import { useAccount } from 'wagmi'
import Link from 'next/link'

export default function Profile() {
  const { address } = useAccount()

  return (
    <div className="mx-auto max-w-md p-6">
      <Link href="/" className="mb-4 inline-block text-sm text-parker-600">
        &larr; Back
      </Link>

      <h1 className="mb-6 text-2xl font-bold text-parker-800">Profile</h1>

      <div className="space-y-4">
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-medium text-gray-500">Wallet Address</p>
          <p className="mt-1 truncate font-mono text-sm">{address || 'Not connected'}</p>
        </div>

        {/* TODO: Show vehicle details, payment methods, settings */}
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-medium text-gray-500">Vehicle</p>
          <p className="mt-1 text-sm text-gray-400">Loading...</p>
        </div>
      </div>
    </div>
  )
}
