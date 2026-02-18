'use client'

import { Suspense, useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  buildXamanPaymentURI,
  isValidXrplTxHash,
  isXrplNetwork,
  XAMAN_LOGO_URL,
} from '@parker/core'
import type { PaymentOptions } from '@parker/core'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

function newIdempotencyKey(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  return `${prefix}-${Date.now()}-${rand}`
}

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
  const [xrplTxHash, setXrplTxHash] = useState('')
  const [xamanQrPng, setXamanQrPng] = useState<string | null>(null)
  const [xamanAvailable, setXamanAvailable] = useState<boolean | null>(null)

  // Fetch fresh payment options from the exit API
  useEffect(() => {
    if (!plate || !lotId) {
      setError('Missing plate or lot information.')
      setLoading(false)
      return
    }

    fetch(`${API_URL}/api/gate/exit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': newIdempotencyKey(`driver-pay-load-${lotId}-${plate}`),
      },
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

  useEffect(() => {
    if (!paymentOptions?.x402 || !isXrplNetwork(paymentOptions.x402.network)) return
    fetch(`${API_URL}/api/gate/xrpl/xaman-config`)
      .then((r) => r.json())
      .then((data) => setXamanAvailable(Boolean(data?.available)))
      .catch(() => setXamanAvailable(false))
  }, [paymentOptions?.x402?.network])

  async function handleSimulatePayment() {
    setStatus('settling')
    setError(null)
    try {
      const res = await fetch(`${API_URL}/api/gate/exit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-PAYMENT': 'simulated-dev-payment',
          'Idempotency-Key': newIdempotencyKey(`driver-pay-sim-${lotId}-${plate}`),
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

  async function handleConfirmXrplPayment() {
    if (!paymentOptions?.x402) return
    const txHash = xrplTxHash.trim()
    if (!isValidXrplTxHash(txHash)) {
      setError('Enter a valid XRPL transaction hash (64 hex chars).')
      return
    }

    setStatus('settling')
    setError(null)
    try {
      const res = await fetch(`${API_URL}/api/gate/exit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-PAYMENT': txHash,
          'Idempotency-Key': newIdempotencyKey(`driver-pay-xrpl-${lotId}-${plate}`),
        },
        body: JSON.stringify({ plateNumber: plate, lotId }),
      })
      if (res.ok) {
        setStatus('done')
      } else {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Payment confirmation failed')
        setStatus('error')
      }
    } catch {
      setError('Network error')
      setStatus('error')
    }
  }

  async function handlePayWithXaman() {
    setError(null)
    setStatus('settling')
    try {
      const intentRes = await fetch(`${API_URL}/api/gate/xrpl/xaman-intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plateNumber: plate, lotId }),
      })
      const intentData = await intentRes.json().catch(() => ({}))
      if (!intentRes.ok || !intentData.payloadUuid) {
        setError(intentData.error || 'Failed to create Xaman payment intent')
        setStatus('error')
        return
      }

      if (intentData.qrPng) {
        setXamanQrPng(String(intentData.qrPng))
      }
      if (intentData.deepLink) {
        window.location.href = String(intentData.deepLink)
      }

      const payloadUuid = String(intentData.payloadUuid)
      const timeoutAt = Date.now() + 2 * 60_000
      while (Date.now() < timeoutAt) {
        await new Promise((r) => setTimeout(r, 2000))
        const statusRes = await fetch(`${API_URL}/api/gate/xrpl/xaman-status/${payloadUuid}`)
        const statusData = await statusRes.json().catch(() => ({}))
        if (!statusRes.ok) continue
        if (statusData.rejected) {
          setError('Payment request was rejected in Xaman')
          setStatus('error')
          return
        }
        if (statusData.resolved && statusData.txHash) {
          const confirmRes = await fetch(`${API_URL}/api/gate/exit`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-PAYMENT': String(statusData.txHash),
              'Idempotency-Key': newIdempotencyKey(`driver-pay-xaman-${lotId}-${plate}`),
            },
            body: JSON.stringify({ plateNumber: plate, lotId }),
          })
          if (confirmRes.ok) {
            setStatus('done')
            return
          }
          const data = await confirmRes.json().catch(() => ({}))
          setError(data.error || 'Settlement confirmation failed')
          setStatus('error')
          return
        }
      }
      setError('Timed out waiting for Xaman confirmation. You can paste tx hash manually.')
      setStatus('error')
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

        {error && <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}

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

              {paymentOptions.x402 &&
                (isXrplNetwork(paymentOptions.x402.network) ? (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                    <p className="text-sm text-gray-600">
                      Send {paymentOptions.x402.amount} {paymentOptions.x402.token} on{' '}
                      {paymentOptions.x402.network} to:
                    </p>
                    <p className="mt-1 break-all font-mono text-xs text-gray-800">
                      {paymentOptions.x402.receiver}
                    </p>
                    {xamanAvailable !== false && (
                      <a
                        href={buildXamanPaymentURI({
                          receiver: paymentOptions.x402.receiver,
                          amount: paymentOptions.x402.amount,
                          currency: paymentOptions.x402.token,
                          network: paymentOptions.x402.network,
                        })}
                        className="mt-2 inline-flex items-center gap-2 text-xs text-parker-700 underline hover:text-parker-900"
                      >
                        <img src={XAMAN_LOGO_URL} alt="Xaman" className="h-4 w-auto" />
                        Open in Xaman
                      </a>
                    )}
                    <p className="mt-1 text-[11px] text-gray-500">
                      Xaman is the recommended wallet for this flow. If deep-link handoff fails, pay
                      manually and confirm with the transaction hash.
                    </p>
                    {xamanAvailable !== false ? (
                      <button
                        onClick={handlePayWithXaman}
                        disabled={status === 'settling'}
                        className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border-2 border-parker-600 px-4 py-2 text-center text-sm font-medium text-parker-600 transition hover:bg-parker-50 disabled:opacity-50"
                      >
                        <img src={XAMAN_LOGO_URL} alt="Xaman" className="h-4 w-auto" />
                        {status === 'settling' ? 'Waiting for Xaman...' : 'Pay with Xaman'}
                      </button>
                    ) : (
                      <p className="mt-2 text-[11px] text-gray-500">
                        Xaman auto-flow is not configured on this deployment. Complete payment in
                        wallet and confirm with tx hash below.
                      </p>
                    )}
                    {xamanAvailable !== false && xamanQrPng && (
                      <div className="mt-3 flex justify-center">
                        <img
                          src={xamanQrPng}
                          alt="Xaman payment QR"
                          className="h-36 w-36 rounded border border-gray-200 bg-white p-1"
                        />
                      </div>
                    )}
                    <label className="mt-3 block text-xs font-medium text-gray-700">
                      XRPL transaction hash
                    </label>
                    <input
                      value={xrplTxHash}
                      onChange={(e) => setXrplTxHash(e.target.value)}
                      placeholder="Paste 64-char tx hash"
                      className="mt-1 w-full rounded-md border border-gray-300 px-2 py-2 text-xs font-mono focus:border-parker-500 focus:outline-none"
                    />
                    <button
                      onClick={handleConfirmXrplPayment}
                      disabled={status === 'settling'}
                      className="mt-3 block w-full rounded-lg border-2 border-parker-600 px-4 py-2 text-center text-sm font-medium text-parker-600 transition hover:bg-parker-50 disabled:opacity-50"
                    >
                      {status === 'settling' ? 'Confirming...' : 'Confirm XRPL Payment'}
                    </button>
                  </div>
                ) : (
                  <p className="text-center text-sm text-gray-500">
                    To pay with {paymentOptions.x402.token}, open the Parker app on your phone.
                  </p>
                ))}

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
