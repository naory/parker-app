import {
  createHederaClient,
  mintParkingNFT as htsMint,
  burnParkingNFT as htsBurn,
  getNftInfo,
  type HederaNetwork,
} from '@parker/hedera'
import type { Client } from '@hashgraph/sdk'

// ---- Configuration ----

const HEDERA_ACCOUNT_ID = process.env.HEDERA_ACCOUNT_ID
const HEDERA_PRIVATE_KEY = process.env.HEDERA_PRIVATE_KEY
const HEDERA_NETWORK = (process.env.HEDERA_NETWORK || 'testnet') as HederaNetwork
const HEDERA_TOKEN_ID = process.env.HEDERA_TOKEN_ID

// ---- Client (lazy singleton) ----

let _client: Client | null = null

function getClient(): Client {
  if (!_client) {
    if (!HEDERA_ACCOUNT_ID || !HEDERA_PRIVATE_KEY) {
      throw new Error('HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY are required')
    }
    _client = createHederaClient({
      accountId: HEDERA_ACCOUNT_ID,
      privateKey: HEDERA_PRIVATE_KEY,
      network: HEDERA_NETWORK,
    })
  }
  return _client
}

// ---- Status Check ----

export function isHederaEnabled(): boolean {
  return !!(HEDERA_ACCOUNT_ID && HEDERA_PRIVATE_KEY && HEDERA_TOKEN_ID)
}

// ---- ParkingNFT Operations (Hedera HTS) ----

/**
 * Mint a parking session NFT on Hedera via HTS.
 * Returns the serial number (stored as tokenId in DB) and transaction ID.
 */
export async function mintParkingNFTOnHedera(
  plateNumber: string,
  lotId: string,
): Promise<{ tokenId: number; txHash: string }> {
  if (!HEDERA_TOKEN_ID) {
    throw new Error('HEDERA_TOKEN_ID not configured')
  }

  const client = getClient()
  const result = await htsMint(client, HEDERA_TOKEN_ID, {
    plateNumber,
    lotId,
    entryTime: Math.floor(Date.now() / 1000),
  })

  return {
    tokenId: result.serial,
    txHash: result.transactionId,
  }
}

/**
 * Burn a parking session NFT on Hedera (end of session).
 * The serial number comes from the DB session's tokenId.
 */
export async function endParkingSessionOnHedera(
  serial: number,
): Promise<{ txHash: string }> {
  if (!HEDERA_TOKEN_ID) {
    throw new Error('HEDERA_TOKEN_ID not configured')
  }

  const client = getClient()
  const result = await htsBurn(client, HEDERA_TOKEN_ID, serial)

  return { txHash: result.transactionId }
}

/**
 * Check if a specific NFT serial exists on Hedera (not burned).
 */
export async function isNftActiveOnHedera(serial: number): Promise<boolean> {
  if (!HEDERA_TOKEN_ID) return false

  const info = await getNftInfo(HEDERA_TOKEN_ID, serial, HEDERA_NETWORK)
  return info.exists
}
