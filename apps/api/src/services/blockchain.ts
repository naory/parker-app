/**
 * Base Sepolia blockchain service.
 *
 * Handles DriverRegistry reads on Base L2.
 * ParkingNFT operations have moved to Hedera (see hedera.ts).
 */

import {
  createPublicClient,
  http,
  parseAbi,
} from 'viem'
import { baseSepolia } from 'viem/chains'

// ---- Configuration ----

const RPC_URL = process.env.RPC_URL || 'https://sepolia.base.org'
const DRIVER_REGISTRY_ADDRESS = process.env.DRIVER_REGISTRY_ADDRESS as `0x${string}` | undefined

// ---- Clients ----

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC_URL),
})

// ---- ABIs ----

const DRIVER_REGISTRY_ABI = parseAbi([
  'function isRegistered(string plateNumber) external view returns (bool)',
  'function getDriver(string plateNumber) external view returns ((address wallet, string plateNumber, string countryCode, string carMake, string carModel, bool active, uint256 registeredAt))',
  'function getDriverByWallet(address wallet) external view returns ((address wallet, string plateNumber, string countryCode, string carMake, string carModel, bool active, uint256 registeredAt))',
])

// ---- Status Check ----

export function isBaseEnabled(): boolean {
  return !!DRIVER_REGISTRY_ADDRESS
}

// ---- DriverRegistry Operations (Base Sepolia) ----

/**
 * Check if a driver is registered on-chain (Base).
 */
export async function isDriverRegisteredOnChain(plateNumber: string): Promise<boolean> {
  if (!DRIVER_REGISTRY_ADDRESS) return false

  return publicClient.readContract({
    address: DRIVER_REGISTRY_ADDRESS,
    abi: DRIVER_REGISTRY_ABI,
    functionName: 'isRegistered',
    args: [plateNumber],
  })
}

/**
 * Get driver info from on-chain registry (Base).
 */
export async function getDriverOnChain(plateNumber: string) {
  if (!DRIVER_REGISTRY_ADDRESS) return null

  try {
    return await publicClient.readContract({
      address: DRIVER_REGISTRY_ADDRESS,
      abi: DRIVER_REGISTRY_ABI,
      functionName: 'getDriver',
      args: [plateNumber],
    })
  } catch {
    return null
  }
}
