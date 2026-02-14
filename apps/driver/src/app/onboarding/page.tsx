'use client'

import { useAccount } from 'wagmi'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

import { WalletButton } from '@/components/WalletButton'

export default function Onboarding() {
  const { isConnected } = useAccount()
  const router = useRouter()

  useEffect(() => {
    if (isConnected) {
      router.push('/register')
    }
  }, [isConnected, router])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-6">
      <div className="mx-auto max-w-sm text-center">
        <h1 className="mb-4 text-3xl font-bold text-parker-800">Welcome to Parker</h1>
        <p className="mb-2 text-gray-600">Park smarter with blockchain-powered parking.</p>
        <ul className="mb-8 space-y-2 text-left text-sm text-gray-500">
          <li>No more communication errors at the gate</li>
          <li>Transparent fee calculation on-chain</li>
          <li>Your parking receipts as NFTs</li>
          <li>Pay with crypto or card — your choice</li>
        </ul>

        <WalletButton />
        <p className="mt-4 text-xs text-gray-400">
          Connect your wallet to get started. We use Coinbase Smart Wallet — no seed phrase needed.
        </p>
      </div>
    </div>
  )
}
