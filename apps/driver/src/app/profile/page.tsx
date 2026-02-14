'use client'

import { useState, useEffect } from 'react'
import { useAccount } from 'wagmi'
import Link from 'next/link'
import { formatPlate } from '@parker/core'

import { useDriverProfile } from '@/hooks/useDriverProfile'
import { updateDriver } from '@/lib/api'

export default function Profile() {
  const { address } = useAccount()
  const { plate, profile, loading, isRegistered, refreshProfile } = useDriverProfile()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // Edit state
  const [editing, setEditing] = useState(false)
  const [carMake, setCarMake] = useState('')
  const [carModel, setCarModel] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Sync form fields when profile loads or edit starts
  useEffect(() => {
    if (profile) {
      setCarMake(profile.carMake || '')
      setCarModel(profile.carModel || '')
    }
  }, [profile])

  if (!mounted) return null

  async function handleSave() {
    if (!plate) return
    setSaving(true)
    setError(null)
    try {
      await updateDriver(plate, { carMake: carMake.trim(), carModel: carModel.trim() })
      await refreshProfile()
      setEditing(false)
    } catch (e) {
      setError((e as Error).message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  function handleCancel() {
    setEditing(false)
    setError(null)
    if (profile) {
      setCarMake(profile.carMake || '')
      setCarModel(profile.carModel || '')
    }
  }

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
                {plate ? formatPlate(plate, profile?.countryCode) : '--'}
              </p>
            </div>

            {profile && (
              <>
                <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-gray-500">Vehicle</p>
                    {!editing && (
                      <button
                        onClick={() => setEditing(true)}
                        className="text-xs text-parker-600 hover:text-parker-800"
                      >
                        Edit
                      </button>
                    )}
                  </div>
                  {editing ? (
                    <div className="mt-2 space-y-3">
                      <div>
                        <label className="text-xs text-gray-500">Make</label>
                        <input
                          type="text"
                          value={carMake}
                          onChange={(e) => setCarMake(e.target.value)}
                          placeholder="e.g. Toyota"
                          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-parker-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-500">Model</label>
                        <input
                          type="text"
                          value={carModel}
                          onChange={(e) => setCarModel(e.target.value)}
                          placeholder="e.g. Corolla"
                          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-parker-500 focus:outline-none"
                        />
                      </div>
                      {error && (
                        <p className="text-xs text-red-600">{error}</p>
                      )}
                      <div className="flex gap-2">
                        <button
                          onClick={handleSave}
                          disabled={saving}
                          className="rounded-lg bg-parker-600 px-4 py-2 text-sm font-medium text-white hover:bg-parker-700 disabled:opacity-50"
                        >
                          {saving ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          onClick={handleCancel}
                          disabled={saving}
                          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-1 text-sm text-gray-800">
                      {profile.carMake} {profile.carModel}
                    </p>
                  )}
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
