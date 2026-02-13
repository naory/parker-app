'use client'

import { useState } from 'react'
import { useAccount } from 'wagmi'
import { useRouter } from 'next/navigation'

export default function Register() {
  const { address } = useAccount()
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    plateNumber: '',
    countryCode: 'IL',
    carMake: '',
    carModel: '',
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/drivers/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-wallet-address': address || '',
        },
        body: JSON.stringify(form),
      })

      if (res.ok) {
        router.push('/')
      } else {
        const data = await res.json()
        alert(data.error || 'Registration failed')
      }
    } catch {
      alert('Network error')
    } finally {
      setLoading(false)
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
            placeholder="12-345-67"
            value={form.plateNumber}
            onChange={(e) => setForm({ ...form, plateNumber: e.target.value })}
            className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-parker-500 focus:outline-none focus:ring-1 focus:ring-parker-500"
            required
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Country</label>
          <select
            value={form.countryCode}
            onChange={(e) => setForm({ ...form, countryCode: e.target.value })}
            className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-parker-500 focus:outline-none focus:ring-1 focus:ring-parker-500"
          >
            <option value="IL">Israel</option>
          </select>
        </div>

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
          {loading ? 'Registering...' : 'Register'}
        </button>
      </form>
    </div>
  )
}
