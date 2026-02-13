'use client'

import { useAccount } from 'wagmi'
import Link from 'next/link'
import { formatPlate } from '@parker/core'

import { useDriverProfile } from '@/hooks/useDriverProfile'

export default function Profile() {
  const { address } = useAccount()
  const { plate, profile, loading, isRegistered } = useDriverProfile()

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

        {loading ? (
          <div className="animate-pulse rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <div className="h-4 w-16 rounded bg-gray-200" />
            <div className="mt-2 h-4 w-32 rounded bg-gray-200" />
          </div>
        ) : !isRegistered ? (
          <Link
            href="/register"
            className="block rounded-lg border-2 border-dashed border-parker-300 bg-parker-50 p-4 text-center text-parker-700 transition hover:border-parker-400"
          >
            Register your vehicle
          </Link>
        ) : (
          <>
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-sm font-medium text-gray-500">License Plate</p>
              <p className="mt-1 text-lg font-bold tracking-wider text-parker-800">
                {plate ? formatPlate(plate) : '--'}
              </p>
            </div>

            {profile && (
              <>
                <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                  <p className="text-sm font-medium text-gray-500">Vehicle</p>
                  <p className="mt-1 text-sm text-gray-800">
                    {profile.carMake} {profile.carModel}
                  </p>
                </div>

                <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                  <p className="text-sm font-medium text-gray-500">Country</p>
                  <p className="mt-1 text-sm text-gray-800">{profile.countryCode}</p>
                </div>

                <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                  <p className="text-sm font-medium text-gray-500">Registered</p>
                  <p className="mt-1 text-sm text-gray-800">
                    {new Date(profile.createdAt).toLocaleDateString()}
                  </p>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
