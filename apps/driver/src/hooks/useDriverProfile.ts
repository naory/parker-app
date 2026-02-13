'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAccount } from 'wagmi'
import type { DriverRecord } from '@parker/core'

const STORAGE_KEY = 'parker_driver_plate'

/**
 * Hook to manage the driver's profile.
 * Stores the plate number in localStorage after registration,
 * and fetches the full profile from the API.
 */
export function useDriverProfile() {
  const { address, isConnected } = useAccount()
  const [plate, setPlateState] = useState<string | null>(null)
  const [profile, setProfile] = useState<DriverRecord | null>(null)
  const [loading, setLoading] = useState(true)

  // Load plate from localStorage
  useEffect(() => {
    if (!isConnected || !address) {
      setPlateState(null)
      setProfile(null)
      setLoading(false)
      return
    }

    const storedPlate = localStorage.getItem(`${STORAGE_KEY}_${address}`)
    if (storedPlate) {
      setPlateState(storedPlate)
    }
    setLoading(false)
  }, [address, isConnected])

  // Fetch profile when plate is known
  useEffect(() => {
    if (!plate) {
      setProfile(null)
      return
    }

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

    fetch(`${apiUrl}/api/drivers/${encodeURIComponent(plate)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setProfile(data))
      .catch(() => setProfile(null))
  }, [plate])

  const setPlate = useCallback(
    (plateNumber: string) => {
      if (address) {
        localStorage.setItem(`${STORAGE_KEY}_${address}`, plateNumber)
      }
      setPlateState(plateNumber)
    },
    [address],
  )

  return { plate, profile, loading, setPlate, isRegistered: !!plate }
}
