'use client'

import { useState, useMemo } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { useRouter } from 'next/navigation'
import { DRIVER_REGISTRY_ABI, CONTRACT_ADDRESSES } from '@parker/core'
import { useDriverProfile } from '@/hooks/useDriverProfile'
import { useAuth } from '@/providers/AuthProvider'

/** All known countries — filtered by NEXT_PUBLIC_DEPLOYMENT_COUNTRIES at runtime */
const ALL_COUNTRIES: Record<string, string> = {
  US: 'United States',
  GB: 'United Kingdom',
  DE: 'Germany',
  FR: 'France',
  ES: 'Spain',
  IT: 'Italy',
  NL: 'Netherlands',
  IL: 'Israel',
  CA: 'Canada',
  AU: 'Australia',
  JP: 'Japan',
  BR: 'Brazil',
}

export default function Register() {
  const { address } = useAccount()
  const router = useRouter()
  const { setPlate } = useDriverProfile()
  const { token, isAuthenticated, signIn } = useAuth()
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState<'form' | 'onchain' | 'api'>('form')

  // White-label: restrict country list to deployment config
  const deploymentCountries = useMemo(() => {
    const raw = process.env.NEXT_PUBLIC_DEPLOYMENT_COUNTRIES || ''
    const codes = raw
      .split(',')
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean)
    if (codes.length === 0) return Object.keys(ALL_COUNTRIES) // no restriction → show all
    return codes.filter((c) => c in ALL_COUNTRIES)
  }, [])

  const [form, setForm] = useState({
    plateNumber: '',
    // Auto-select if single-country deployment
    countryCode: deploymentCountries.length === 1 ? deploymentCountries[0] : '',
    carMake: '',
    carModel: '',
  })

  const { writeContractAsync } = useWriteContract()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)

    try {
      // Step 1: Register on-chain (if contract is deployed)
      const contractAddress = CONTRACT_ADDRESSES.driverRegistry
      const isContractDeployed = contractAddress !== '0x0000000000000000000000000000000000000000'

      if (isContractDeployed) {
        setStep('onchain')
        try {
          await writeContractAsync({
            address: contractAddress,
            abi: DRIVER_REGISTRY_ABI,
            functionName: 'register',
            args: [form.plateNumber, form.countryCode, form.carMake, form.carModel],
          })
        } catch (err: any) {
          // If user rejected the tx or it failed, still allow API-only registration
          console.warn('On-chain registration failed (continuing with off-chain):', err?.message)
        }
      }

      // Step 2: Ensure SIWE auth before API call
      if (!isAuthenticated) {
        await signIn()
      }

      // Step 3: Register off-chain via API
      setStep('api')
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (token) {
        headers['Authorization'] = `Bearer ${token}`
      } else {
        headers['x-wallet-address'] = address || ''
      }
      const res = await fetch(`${apiUrl}/api/drivers/register`, {
        method: 'POST',
        headers,
        body: JSON.stringify(form),
      })

      if (res.ok) {
        // Save plate number locally so other pages can look up sessions
        setPlate(form.plateNumber)
        router.push('/')
      } else {
        const data = await res.json()
        alert(data.error || 'Registration failed')
      }
    } catch {
      alert('Network error')
    } finally {
      setLoading(false)
      setStep('form')
    }
  }

  return (
    <div className="mx-auto max-w-md p-6">
      <h1 className="mb-6 text-2xl font-bold text-parker-800">Register Vehicle</h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">License Plate</label>
          <input
            type="text"
            placeholder="ABC-1234"
            value={form.plateNumber}
            onChange={(e) => setForm({ ...form, plateNumber: e.target.value })}
            className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-parker-500 focus:outline-none focus:ring-1 focus:ring-parker-500"
            required
          />
        </div>

        {/* Hidden when single-country deployment; shown as dropdown for multi-country */}
        {deploymentCountries.length === 1 ? (
          <input type="hidden" value={form.countryCode} />
        ) : (
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Country</label>
            <select
              value={form.countryCode}
              onChange={(e) => setForm({ ...form, countryCode: e.target.value })}
              className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-parker-500 focus:outline-none focus:ring-1 focus:ring-parker-500"
              required
            >
              <option value="" disabled>
                Select country
              </option>
              {deploymentCountries.map((code) => (
                <option key={code} value={code}>
                  {ALL_COUNTRIES[code] || code}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Car Make</label>
          <input
            type="text"
            placeholder="Toyota"
            value={form.carMake}
            onChange={(e) => setForm({ ...form, carMake: e.target.value })}
            className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-parker-500 focus:outline-none focus:ring-1 focus:ring-parker-500"
            required
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Car Model</label>
          <input
            type="text"
            placeholder="Corolla"
            value={form.carModel}
            onChange={(e) => setForm({ ...form, carModel: e.target.value })}
            className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-parker-500 focus:outline-none focus:ring-1 focus:ring-parker-500"
            required
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-parker-600 px-4 py-3 font-medium text-white transition hover:bg-parker-700 disabled:opacity-50"
        >
          {!loading
            ? 'Register'
            : step === 'onchain'
              ? 'Confirm in wallet...'
              : step === 'api'
                ? 'Saving profile...'
                : 'Registering...'}
        </button>
      </form>
    </div>
  )
}
