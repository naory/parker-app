import { createPublicClient, http, defineChain } from 'viem'
import { baseSepolia } from 'viem/chains'

export { baseSepolia }

export const chain = baseSepolia

export function getPublicClient(rpcUrl?: string) {
  return createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrl || 'https://sepolia.base.org'),
  })
}
