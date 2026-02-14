'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAccount } from 'wagmi'
import { normalizePlate } from '@parker/core'
import type { DriverRecord } from '@parker/core'

const STORAGE_KEY = 'parker_driver_plate'
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

/**
 * Hook to manage the driver's profile.
 * 1. Checks localStorage for a saved plate number
 * 2. If not found, looks up the driver by wallet address via API
 * 3. Fetches the full profile from the API
 */
export function useDriverProfile() {
  const { address, isConnected } = useAccount()
  const [plate, setPlateState] = useState<string | null>(null)
  const [profile, setProfile] = useState<DriverRecord | null>(null)
  const [loading, setLoading] = useState(true)

  // Load plate from localStorage, or look up by wallet
  useEffect(() => {
    if (!isConnected || !address) {
      setPlateState(null)
      setProfile(null)
      setLoading(false)
      return
    }

    const storedPlate = localStorage.getItem(`${STORAGE_KEY}_${address}`)
    if (storedPlate) {
      setPlateState(normalizePlate(storedPlate))
      setLoading(false)
      return
    }

    // No stored plate — try to look up by wallet address
    fetch(`${API_URL}/api/drivers/wallet/${address}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: DriverRecord | null) => {
        if (data?.plateNumber) {
          localStorage.setItem(`${STORAGE_KEY}_${address}`, data.plateNumber)
          setPlateState(data.plateNumber)
          setProfile(data)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [address, isConnected])

  // Fetch profile when plate is known (and not already loaded from wallet lookup)
  useEffect(() => {
    if (!plate) {
      setProfile(null)
      return
    }

    // Skip if we already have the profile from the wallet lookup
    if (profile?.plateNumber === plate) return

    fetch(`${API_URL}/api/drivers/${encodeURIComponent(plate)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setProfile(data))
      .catch(() => setProfile(null))
  }, [plate, profile?.plateNumber])

  const setPlate = useCallback(
    (plateNumber: string) => {
      const normalized = normalizePlate(plateNumber)
      if (address) {
        localStorage.setItem(`${STORAGE_KEY}_${address}`, normalized)
      }
      setPlateState(normalized)
    },
    [address],
  )

  const refreshProfile = useCallback(async () => {
    if (!plate) return
    try {
      const res = await fetch(`${API_URL}/api/drivers/${encodeURIComponent(plate)}`)
      if (res.ok) {
        const data = await res.json()
        setProfile(data)
      }
    } catch {}
  }, [plate])

  return { plate, profile, loading, setPlate, refreshProfile, isRegistered: !!plate }
}
