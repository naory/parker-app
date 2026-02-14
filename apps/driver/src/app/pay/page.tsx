'use client'

import { Suspense, useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import type { PaymentOptions } from '@parker/core'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

export default function PayPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
          <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-parker-600 border-t-transparent" />
        </div>
      }
    >
      <PayContent />
    </Suspense>
  )
}

function PayContent() {
  const searchParams = useSearchParams()
  const plate = searchParams.get('plate') || ''
  const fee = parseFloat(searchParams.get('fee') || '0')
  const currency = searchParams.get('currency') || ''
  const lotId = searchParams.get('lotId') || ''

  const [paymentOptions, setPaymentOptions] = useState<PaymentOptions | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'settling' | 'done' | 'error'>('idle')

  // Fetch fresh payment options from the exit API
  useEffect(() => {
    if (!plate || !lotId) {
      setError('Missing plate or lot information.')
      setLoading(false)
      return
    }

    fetch(`${API_URL}/api/gate/exit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plateNumber: plate, lotId }),
    })
      .then(async (res) => {
        const data = await res.json()
        if (data.paymentOptions) {
          setPaymentOptions(data.paymentOptions)
        } else if (res.ok && !data.paymentOptions) {
          setStatus('done')
        } else {
          setError(data.error || 'Could not load payment options.')
        }
      })
      .catch(() => setError('Network error — could not reach server.'))
      .finally(() => setLoading(false))
  }, [plate, lotId])

  async function handleSimulatePayment() {
    setStatus('settling')
    setError(null)
    try {
      const res = await fetch(`${API_URL}/api/gate/exit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-PAYMENT': 'simulated-dev-payment',
        },
        body: JSON.stringify({ plateNumber: plate, lotId }),
      })
      if (res.ok) {
        setStatus('done')
      } else {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Payment failed')
        setStatus('error')
      }
    } catch {
      setError('Network error')
      setStatus('error')
    }
  }

  if (!plate || !lotId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
        <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-lg text-center">
          <p className="text-gray-500">Invalid payment link. Missing plate or lot information.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-lg">
        <h1 className="text-xl font-bold text-gray-900">Parking Payment</h1>
        <p className="mt-1 text-sm text-gray-500">
          Plate: {plate} &middot; Lot: {lotId}
        </p>

        {fee > 0 && (
          <div className="mt-4 rounded-lg bg-parker-50 p-4 text-center">
            <p className="text-3xl font-bold text-parker-800">
              {fee.toFixed(2)} {currency}
            </p>
            {paymentOptions?.x402 && (
              <p className="mt-1 text-sm text-gray-500">
                {paymentOptions.x402.amount} {paymentOptions.x402.token}
              </p>
            )}
          </div>
        )}

        {loading && (
          <div className="mt-6 text-center">
            <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-parker-600 border-t-transparent" />
            <p className="mt-2 text-sm text-gray-400">Loading payment options...</p>
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}

        {status === 'done' ? (
          <div className="mt-4 rounded-lg bg-green-50 p-4 text-center font-medium text-green-700">
            Payment confirmed — gate is opening!
          </div>
        ) : (
          !loading &&
          paymentOptions && (
            <div className="mt-4 space-y-3">
              {paymentOptions.stripe && (
                <a
                  href={paymentOptions.stripe.checkoutUrl}
                  className="block w-full rounded-lg bg-parker-600 px-4 py-3 text-center font-medium text-white transition hover:bg-parker-700"
                >
                  Pay with Card
                </a>
              )}

              {paymentOptions.x402 && (
                <p className="text-center text-sm text-gray-500">
                  To pay with {paymentOptions.x402.token}, open the Parker app on your phone.
                </p>
              )}

              {process.env.NODE_ENV === 'development' && (
                <button
                  onClick={handleSimulatePayment}
                  disabled={status === 'settling'}
                  className="block w-full rounded-lg bg-gray-100 px-4 py-2 text-center text-xs font-medium text-gray-500 transition hover:bg-gray-200 disabled:opacity-50"
                >
                  {status === 'settling' ? 'Processing...' : 'Simulate Payment (dev)'}
                </button>
              )}
            </div>
          )
        )}
      </div>
    </div>
  )
}
