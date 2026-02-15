'use client'

import { useState, useEffect } from 'react'
import type { Lot } from '@parker/core'
import { getLotStatus } from '@/lib/api'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

export default function Settings() {
  const lotId = process.env.NEXT_PUBLIC_LOT_ID || ''
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [currency, setCurrency] = useState('USD')
  const [form, setForm] = useState({
    name: '',
    address: '',
    capacity: '',
    ratePerHour: '',
    billingMinutes: '15',
    maxDailyFee: '',
    gracePeriodMinutes: '0',
    currency: 'USD',
    paymentMethods: 'stripe,x402',
  })

  // Load lot settings
  useEffect(() => {
    if (!lotId) {
      setLoading(false)
      return
    }

    fetch(`${API_URL}/api/gate/lot/${encodeURIComponent(lotId)}/status`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          const cur = data.currency || 'USD'
          setCurrency(cur)
          setForm({
            name: data.name || '',
            address: data.address || '',
            capacity: data.capacity?.toString() || '',
            ratePerHour: data.ratePerHour?.toString() || '',
            billingMinutes: data.billingMinutes?.toString() || '15',
            maxDailyFee: data.maxDailyFee?.toString() || '',
            gracePeriodMinutes: data.gracePeriodMinutes?.toString() || '0',
            currency: cur,
            paymentMethods: (data.paymentMethods || ['stripe', 'x402']).join(','),
          })
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [lotId])

  function updateField(key: string, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
    setMessage(null)
  }

  async function handleSave() {
    setSaving(true)
    setMessage(null)

    try {
      const res = await fetch(`${API_URL}/api/gate/lot/${encodeURIComponent(lotId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name || undefined,
          address: form.address || undefined,
          capacity: form.capacity || undefined,
          ratePerHour: form.ratePerHour || undefined,
          billingMinutes: form.billingMinutes || undefined,
          maxDailyFee: form.maxDailyFee || undefined,
          gracePeriodMinutes: form.gracePeriodMinutes || undefined,
          currency: form.currency || undefined,
          paymentMethods: form.paymentMethods
            ? form.paymentMethods.split(',').map((m) => m.trim()).filter(Boolean)
            : undefined,
        }),
      })

      if (res.ok) {
        setMessage({ type: 'success', text: 'Settings saved successfully' })
      } else {
        const data = await res.json()
        setMessage({ type: 'error', text: data.error || 'Failed to save settings' })
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error — failed to save' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-6">
      <h1 className="mb-6 text-2xl font-bold text-parker-800">Lot Settings</h1>

      <div className="max-w-lg space-y-6">
        {/* Lot info */}
        <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 font-semibold text-gray-700">Lot Information</h2>
          <div className="space-y-3">
            <Field label="Lot ID" value={lotId} disabled />
            <Field
              label="Lot Name"
              value={form.name}
              placeholder="My Parking Lot"
              onChange={(v) => updateField('name', v)}
            />
            <Field
              label="Address"
              value={form.address}
              placeholder="123 Main St, City"
              onChange={(v) => updateField('address', v)}
            />
            <Field
              label="Capacity"
              value={form.capacity}
              placeholder="100"
              type="number"
              onChange={(v) => updateField('capacity', v)}
            />
          </div>
        </section>

        {/* Pricing */}
        <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 font-semibold text-gray-700">Pricing</h2>
          <div className="space-y-3">
            <Field
              label="Currency (ISO 4217)"
              value={form.currency}
              placeholder="USD"
              onChange={(v) => {
                updateField('currency', v.toUpperCase())
                setCurrency(v.toUpperCase() || 'USD')
              }}
            />
            <Field
              label={`Rate per Hour (${currency})`}
              value={form.ratePerHour}
              placeholder="12.00"
              type="number"
              onChange={(v) => updateField('ratePerHour', v)}
            />
            <Field
              label="Billing Increment (min)"
              value={form.billingMinutes}
              type="number"
              onChange={(v) => updateField('billingMinutes', v)}
            />
            <Field
              label="Grace Period (min)"
              value={form.gracePeriodMinutes}
              placeholder="0"
              type="number"
              onChange={(v) => updateField('gracePeriodMinutes', v)}
            />
            <Field
              label={`Max Daily Fee (${currency})`}
              value={form.maxDailyFee}
              placeholder="90.00"
              type="number"
              onChange={(v) => updateField('maxDailyFee', v)}
            />
          </div>
        </section>

        {/* Payment Methods */}
        <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 font-semibold text-gray-700">Payment Methods</h2>
          <div className="space-y-3">
            <Field
              label="Accepted methods (comma-separated: stripe, x402)"
              value={form.paymentMethods}
              placeholder="stripe,x402"
              onChange={(v) => updateField('paymentMethods', v)}
            />
          </div>
        </section>

        {message && (
          <p
            className={`text-sm ${
              message.type === 'success' ? 'text-green-600' : 'text-red-600'
            }`}
          >
            {message.text}
          </p>
        )}

        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-parker-600 px-6 py-3 font-medium text-white transition hover:bg-parker-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  placeholder,
  type = 'text',
  disabled = false,
  onChange,
}: {
  label: string
  value: string
  placeholder?: string
  type?: string
  disabled?: boolean
  onChange?: (value: string) => void
}) {
  return (
    <div>
      <label className="mb-1 block text-sm text-gray-500">{label}</label>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        readOnly={!onChange}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-parker-500 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
      />
    </div>
  )
}
