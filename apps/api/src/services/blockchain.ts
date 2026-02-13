import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Hash,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'

// ---- Configuration ----

const RPC_URL = process.env.RPC_URL || 'https://sepolia.base.org'
const LOT_OPERATOR_PRIVATE_KEY = process.env.LOT_OPERATOR_PRIVATE_KEY as `0x${string}` | undefined
const PARKING_NFT_ADDRESS = process.env.PARKING_NFT_ADDRESS as `0x${string}` | undefined
const DRIVER_REGISTRY_ADDRESS = process.env.DRIVER_REGISTRY_ADDRESS as `0x${string}` | undefined

// ---- Clients ----

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC_URL),
})

function getWalletClient() {
  if (!LOT_OPERATOR_PRIVATE_KEY) {
    throw new Error('LOT_OPERATOR_PRIVATE_KEY not configured — on-chain operations disabled')
  }
  const account = privateKeyToAccount(LOT_OPERATOR_PRIVATE_KEY)
  return createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(RPC_URL),
  })
}

// ---- ABIs (minimal, matching contract functions we call) ----

const PARKING_NFT_ABI = parseAbi([
  'function startSession(string plateNumber, string lotId) external returns (uint256 tokenId)',
  'function endSession(string plateNumber, uint256 feePaid) external',
  'function getActiveSession(string plateNumber) external view returns ((string plateNumber, string lotId, uint256 entryTime, uint256 exitTime, uint256 feePaid, bool active))',
  'function isParked(string plateNumber) external view returns (bool)',
  'event SessionStarted(uint256 indexed tokenId, string plateNumber, string lotId, uint256 entryTime)',
  'event SessionEnded(uint256 indexed tokenId, string plateNumber, uint256 exitTime, uint256 fee)',
])

const DRIVER_REGISTRY_ABI = parseAbi([
  'function isRegistered(string plateNumber) external view returns (bool)',
  'function getDriver(string plateNumber) external view returns ((address wallet, string plateNumber, string countryCode, string carMake, string carModel, bool active, uint256 registeredAt))',
  'function getDriverByWallet(address wallet) external view returns ((address wallet, string plateNumber, string countryCode, string carMake, string carModel, bool active, uint256 registeredAt))',
])

// ---- Status Check ----

export function isBlockchainEnabled(): boolean {
  return !!(LOT_OPERATOR_PRIVATE_KEY && PARKING_NFT_ADDRESS && DRIVER_REGISTRY_ADDRESS)
}

// ---- ParkingNFT Operations ----

/**
 * Mint a parking session NFT on-chain.
 * Returns the transaction hash and token ID.
 */
export async function mintParkingNFT(
  plateNumber: string,
  lotId: string,
): Promise<{ txHash: Hash; tokenId: number }> {
  if (!PARKING_NFT_ADDRESS) {
    throw new Error('PARKING_NFT_ADDRESS not configured')
  }

  const walletClient = getWalletClient()

  const txHash = await walletClient.writeContract({
    address: PARKING_NFT_ADDRESS,
    abi: PARKING_NFT_ABI,
    functionName: 'startSession',
    args: [plateNumber, lotId],
  })

  // Wait for transaction receipt to get the token ID from event logs
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })

  // Parse SessionStarted event to get tokenId
  let tokenId = 0
  for (const log of receipt.logs) {
    try {
      if (log.address.toLowerCase() === PARKING_NFT_ADDRESS.toLowerCase()) {
        // The first topic is the event signature, second is the indexed tokenId
        if (log.topics[1]) {
          tokenId = Number(BigInt(log.topics[1]))
        }
      }
    } catch {
      // Skip unparseable logs
    }
  }

  console.log(`[blockchain] Minted parking NFT: tokenId=${tokenId}, tx=${txHash}`)
  return { txHash, tokenId }
}

/**
 * End a parking session on-chain.
 * feePaid is in USDC with 6 decimals (e.g., 7.43 USDC = 7430000).
 */
export async function endParkingSession(
  plateNumber: string,
  feeUsdc: number,
): Promise<{ txHash: Hash }> {
  if (!PARKING_NFT_ADDRESS) {
    throw new Error('PARKING_NFT_ADDRESS not configured')
  }

  const walletClient = getWalletClient()

  // Convert USDC (float) to on-chain amount (6 decimals)
  const feePaid = BigInt(Math.round(feeUsdc * 1_000_000))

  const txHash = await walletClient.writeContract({
    address: PARKING_NFT_ADDRESS,
    abi: PARKING_NFT_ABI,
    functionName: 'endSession',
    args: [plateNumber, feePaid],
  })

  await publicClient.waitForTransactionReceipt({ hash: txHash })

  console.log(`[blockchain] Ended parking session: plate=${plateNumber}, fee=${feeUsdc} USDC, tx=${txHash}`)
  return { txHash }
}

/**
 * Check if a vehicle is currently parked on-chain.
 */
export async function isParkedOnChain(plateNumber: string): Promise<boolean> {
  if (!PARKING_NFT_ADDRESS) return false

  return publicClient.readContract({
    address: PARKING_NFT_ADDRESS,
    abi: PARKING_NFT_ABI,
    functionName: 'isParked',
    args: [plateNumber],
  })
}

// ---- DriverRegistry Operations ----

/**
 * Check if a driver is registered on-chain.
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
