'use client'

import Link from 'next/link'

export default function History() {
  // TODO: Fetch session history from API using driver's plate

  return (
    <div className="mx-auto max-w-md p-6">
      <Link href="/" className="mb-4 inline-block text-sm text-parker-600">
        &larr; Back
      </Link>

      <h1 className="mb-6 text-2xl font-bold text-parker-800">Parking History</h1>

      <div className="space-y-3">
        {/* TODO: Map over sessions */}
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-gray-400">No parking sessions yet.</p>
          <p className="text-xs text-gray-300">Sessions will appear here after your first park.</p>
        </div>
      </div>
    </div>
  )
}
