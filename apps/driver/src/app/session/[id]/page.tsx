'use client'

import { useParams } from 'next/navigation'
import Link from 'next/link'

export default function SessionDetail() {
  const { id } = useParams<{ id: string }>()

  // TODO: Fetch session details from API
  return (
    <div className="mx-auto max-w-md p-6">
      <Link href="/" className="mb-4 inline-block text-sm text-parker-600">
        &larr; Back
      </Link>

      <h1 className="mb-6 text-2xl font-bold text-parker-800">Session Detail</h1>

      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-gray-500">Session ID</p>
        <p className="mb-4 font-mono text-sm">{id}</p>

        {/* TODO: Show session details — lot, entry time, duration, cost, NFT link */}
        <p className="text-gray-400">Session details coming soon...</p>
      </div>
    </div>
  )
}
