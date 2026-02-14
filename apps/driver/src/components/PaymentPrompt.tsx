'use client'

import { useState } from 'react'
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { parseUnits, type Address } from 'viem'
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

// USDC contract addresses by network
const USDC_ADDRESSES: Record<string, Address> = {
  'base-sepolia': '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
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
  const [status, setStatus] = useState<'idle' | 'sending' | 'confirming' | 'settling' | 'done' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  const { writeContractAsync } = useWriteContract()

  async function handlePayWithCrypto() {
    const x402 = paymentOptions.x402
    if (!x402) return

    const usdcAddress = USDC_ADDRESSES[x402.network]
    if (!usdcAddress) {
      setError(`Unsupported network: ${x402.network}`)
      return
    }

    setStatus('sending')
    setError(null)

    try {
      // Step 1: Send USDC transfer via wallet
      const txHash = await writeContractAsync({
        address: usdcAddress,
        abi: ERC20_TRANSFER_ABI,
        functionName: 'transfer',
        args: [x402.receiver as Address, parseUnits(x402.amount, 6)],
      })

      // Step 2: Confirm the exit with the API (X-PAYMENT header)
      setStatus('settling')
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
      const res = await fetch(`${apiUrl}/api/gate/exit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-PAYMENT': txHash,
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
        <p className="mt-1 text-sm text-gray-500">
          You parked for {durationMinutes} minutes
        </p>

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

        {error && (
          <div className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

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
                  ? 'Confirm in wallet...'
                  : status === 'confirming'
                    ? 'Waiting for confirmation...'
                    : status === 'settling'
                      ? 'Opening gate...'
                      : `Pay with ${paymentOptions.x402.token}`}
              </button>
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
