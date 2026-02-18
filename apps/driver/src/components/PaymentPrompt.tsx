'use client'

import { useEffect, useState } from 'react'
import { useWriteContract } from 'wagmi'
import { parseUnits, type Address } from 'viem'
import {
  USDC_ADDRESSES,
  isXrplNetwork,
  isValidXrplTxHash,
  buildXamanPaymentURI,
  XAMAN_LOGO_URL,
} from '@parker/core'
import type { PaymentOptions } from '@parker/core'

const ERC20_TRANSFER_ABI = [
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
] as const

function newIdempotencyKey(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  return `${prefix}-${Date.now()}-${rand}`
}

interface PaymentPromptProps {
  fee: number
  currency: string
  durationMinutes: number
  paymentOptions: PaymentOptions
  plateNumber: string
  lotId: string
  onDismiss: () => void
  onPaid: () => void
}

export function PaymentPrompt({
  fee,
  currency,
  durationMinutes,
  paymentOptions,
  plateNumber,
  lotId,
  onDismiss,
  onPaid,
}: PaymentPromptProps) {
  const [status, setStatus] = useState<
    'idle' | 'sending' | 'confirming' | 'settling' | 'done' | 'error'
  >('idle')
  const [error, setError] = useState<string | null>(null)
  const [xrplTxHash, setXrplTxHash] = useState('')
  const [xamanQrPng, setXamanQrPng] = useState<string | null>(null)
  const [xamanAvailable, setXamanAvailable] = useState<boolean | null>(null)

  const { writeContractAsync } = useWriteContract()

  const x402 = paymentOptions.x402
  const isXrplRail = isXrplNetwork(x402?.network)

  useEffect(() => {
    if (!isXrplRail) return
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
    fetch(`${apiUrl}/api/gate/xrpl/xaman-config`)
      .then((r) => r.json())
      .then((data) => setXamanAvailable(Boolean(data?.available)))
      .catch(() => setXamanAvailable(false))
  }, [isXrplRail])

  async function settleWithPaymentProof(paymentProof: string, keyPrefix: string) {
    setStatus('settling')
    setError(null)

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
    const res = await fetch(`${apiUrl}/api/gate/exit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-PAYMENT': paymentProof,
        'Idempotency-Key': newIdempotencyKey(`${keyPrefix}-${lotId}-${plateNumber}`),
      },
      body: JSON.stringify({ plateNumber, lotId }),
    })

    if (res.ok) {
      setStatus('done')
      onPaid()
      return
    }

    const data = await res.json().catch(() => ({}))
    setError(data.error || 'Settlement failed')
    setStatus('error')
  }

  async function handlePayWithCrypto() {
    if (!x402) return

    if (isXrplRail) {
      if (xamanAvailable === false && xrplTxHash.trim().length === 0) {
        setError(
          'Xaman auto-flow is unavailable. Pay in wallet and paste the XRPL transaction hash.',
        )
        return
      }
      // If tx hash already provided manually, confirm directly.
      if (xrplTxHash.trim().length > 0) {
        if (!isValidXrplTxHash(xrplTxHash)) {
          setError('Enter a valid XRPL transaction hash (64 hex chars)')
          return
        }
        try {
          await settleWithPaymentProof(xrplTxHash.trim(), 'driver-exit-pay-xrpl')
        } catch {
          setError('Network error')
          setStatus('error')
        }
        return
      }

      // Xaman-first: ensure pending payment exists (exit without X-PAYMENT), then create payload.
      try {
        setStatus('sending')
        setError(null)

        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

        // Call exit first (no X-PAYMENT) to trigger 402 path and register pending payment.
        const exitRes = await fetch(`${apiUrl}/api/gate/exit`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': newIdempotencyKey(`driver-exit-register-${lotId}-${plateNumber}`),
          },
          body: JSON.stringify({ plateNumber, lotId }),
        })
        if (!exitRes.ok) {
          const exitData = await exitRes.json().catch(() => ({}))
          setError(exitData.error || 'Could not start exit flow')
          setStatus('error')
          return
        }

        const intentRes = await fetch(`${apiUrl}/api/gate/xrpl/xaman-intent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plateNumber, lotId }),
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

        setStatus('confirming')
        const payloadUuid = String(intentData.payloadUuid)
        const timeoutAt = Date.now() + 2 * 60_000
        while (Date.now() < timeoutAt) {
          await new Promise((r) => setTimeout(r, 2000))
          const statusRes = await fetch(`${apiUrl}/api/gate/xrpl/xaman-status/${payloadUuid}`)
          const statusData = await statusRes.json().catch(() => ({}))
          if (!statusRes.ok) continue
          if (statusData.rejected) {
            setError('Payment request was rejected in Xaman')
            setStatus('error')
            return
          }
          if (statusData.resolved && statusData.txHash) {
            await settleWithPaymentProof(String(statusData.txHash), 'driver-exit-pay-xrpl')
            return
          }
        }
        setError('Timed out waiting for Xaman confirmation. You can paste tx hash manually.')
        setStatus('error')
      } catch {
        setError('Network error')
        setStatus('error')
      }
      return
    }

    const usdcAddress = USDC_ADDRESSES[x402.network]
    if (!usdcAddress) {
      setError(`Unsupported network: ${x402.network}`)
      return
    }

    setStatus('sending')
    setError(null)

    try {
      // Step 1: Send EVM token transfer via wallet
      const txHash = await writeContractAsync({
        address: usdcAddress,
        abi: ERC20_TRANSFER_ABI,
        functionName: 'transfer',
        args: [x402.receiver as Address, parseUnits(x402.amount, 6)],
      })

      // Step 2: Confirm the exit with the API (X-PAYMENT header)
      await settleWithPaymentProof(txHash, 'driver-exit-pay-evm')
    } catch (err: any) {
      // User rejected tx or tx failed
      const msg = err?.shortMessage || err?.message || 'Transaction failed'
      setError(msg)
      setStatus('error')
    }
  }

  async function handleSimulatePayment() {
    setStatus('settling')
    setError(null)

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
      const res = await fetch(`${apiUrl}/api/gate/exit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-PAYMENT': 'simulated-dev-payment',
          'Idempotency-Key': newIdempotencyKey(`driver-exit-sim-${lotId}-${plateNumber}`),
        },
        body: JSON.stringify({ plateNumber, lotId }),
      })

      if (res.ok) {
        setStatus('done')
        onPaid()
      } else {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Settlement failed')
        setStatus('error')
      }
    } catch {
      setError('Network error')
      setStatus('error')
    }
  }

  const isProcessing = status === 'sending' || status === 'confirming' || status === 'settling'

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="w-full max-w-md rounded-t-2xl bg-white p-6 shadow-2xl sm:rounded-2xl">
        <h2 className="text-xl font-bold text-gray-900">Payment Required</h2>
        <p className="mt-1 text-sm text-gray-500">You parked for {durationMinutes} minutes</p>

        <div className="mt-4 rounded-lg bg-parker-50 p-4 text-center">
          <p className="text-3xl font-bold text-parker-800">
            {fee.toFixed(2)} {currency}
          </p>
          {paymentOptions.x402 && (
            <p className="mt-1 text-sm text-gray-500">
              {paymentOptions.x402.amount} {paymentOptions.x402.token}
            </p>
          )}
        </div>

        {error && <div className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        {status === 'done' ? (
          <div className="mt-4 rounded-lg bg-green-50 p-4 text-center text-green-700 font-medium">
            Payment confirmed — gate is opening!
          </div>
        ) : (
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
              <button
                onClick={handlePayWithCrypto}
                disabled={isProcessing}
                className="block w-full rounded-lg border-2 border-parker-600 px-4 py-3 text-center font-medium text-parker-600 transition hover:bg-parker-50 disabled:opacity-50"
              >
                {status === 'sending'
                  ? isXrplRail
                    ? 'Opening Xaman...'
                    : 'Confirm in wallet...'
                  : status === 'confirming'
                    ? isXrplRail
                      ? 'Waiting for Xaman confirmation...'
                      : 'Waiting for confirmation...'
                    : status === 'settling'
                      ? 'Opening gate...'
                      : isXrplRail
                        ? xrplTxHash.trim()
                          ? 'Confirm XRPL Tx Hash'
                          : xamanAvailable === false
                            ? 'Confirm XRPL Tx Hash'
                            : 'Pay with Xaman'
                        : `Pay with ${paymentOptions.x402.token}`}
              </button>
            )}

            {paymentOptions.x402 && isXrplRail && (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <p className="text-xs text-gray-600">
                  Send {paymentOptions.x402.amount} {paymentOptions.x402.token} on{' '}
                  {paymentOptions.x402.network} to:
                </p>
                <p className="mt-1 break-all font-mono text-xs text-gray-800">
                  {paymentOptions.x402.receiver}
                </p>
                {xamanAvailable !== false && (
                  <>
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
                    <p className="mt-1 text-[11px] text-gray-500">
                      Xaman is the recommended wallet for this flow. If deep-link handoff fails, pay
                      manually in Xaman and paste the tx hash below.
                    </p>
                  </>
                )}
                {xamanAvailable === false && (
                  <p className="mt-1 text-[11px] text-gray-500">
                    Xaman auto-flow is not configured on this deployment. Complete payment in wallet
                    and paste the tx hash below.
                  </p>
                )}
                {xamanAvailable !== false && xamanQrPng && (
                  <div className="mt-2 flex justify-center">
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
              </div>
            )}

            {/* Dev-only: simulate payment without real USDC */}
            {process.env.NODE_ENV === 'development' && (
              <button
                onClick={handleSimulatePayment}
                disabled={status === 'settling'}
                className="block w-full rounded-lg bg-gray-100 px-4 py-2 text-center text-xs font-medium text-gray-500 transition hover:bg-gray-200 disabled:opacity-50"
              >
                {status === 'settling' ? 'Opening gate...' : 'Simulate Payment (dev)'}
              </button>
            )}
          </div>
        )}

        <button
          onClick={onDismiss}
          className="mt-3 w-full py-2 text-center text-sm text-gray-400 hover:text-gray-600"
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}
