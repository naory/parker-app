import {
  createHederaClient,
  mintParkingNFT as htsMint,
  burnParkingNFT as htsBurn,
  getNftInfo,
  findActiveNftByPlateHash as htsFindByPlate,
  parseEncryptionKey,
  type HederaNetwork,
  type ActiveNftSession,
} from '@parker/hedera'
import { hashPlate } from '@parker/core'
import { TokenInfoQuery, type Client } from '@hashgraph/sdk'
import { logger, mintLatencyMs, burnLatencyMs, mirrorLagSeconds } from './observability'

// ---- Configuration ----

const HEDERA_ACCOUNT_ID = process.env.HEDERA_ACCOUNT_ID
const HEDERA_PRIVATE_KEY = process.env.HEDERA_PRIVATE_KEY
const HEDERA_NETWORK = (process.env.HEDERA_NETWORK || 'testnet') as HederaNetwork
const HEDERA_TOKEN_ID = process.env.HEDERA_TOKEN_ID

// ---- NFT Metadata Encryption (required) ----

if (!process.env.NFT_ENCRYPTION_KEY) {
  throw new Error('NFT_ENCRYPTION_KEY is required. Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"')
}
const _encryptionKey = parseEncryptionKey(process.env.NFT_ENCRYPTION_KEY)
console.log('[hedera] NFT metadata encryption enabled (AES-256-GCM)')

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
 * PRIVACY: the plate number is hashed (keccak256) before going on-chain.
 * Only the hash is stored in the NFT metadata — never the raw plate.
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
  const startedAt = Date.now()
  const result = await htsMint(client, HEDERA_TOKEN_ID, {
    plateHash: hashPlate(plateNumber),
    lotId,
    entryTime: Math.floor(Date.now() / 1000),
  }, _encryptionKey)
  mintLatencyMs.observe(Date.now() - startedAt)
  logger.info('hedera_mint_success', {
    token_id: HEDERA_TOKEN_ID,
    serial: result.serial,
    duration_ms: Date.now() - startedAt,
    lot_id: lotId,
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
  const startedAt = Date.now()
  const result = await htsBurn(client, HEDERA_TOKEN_ID, serial)
  burnLatencyMs.observe(Date.now() - startedAt)
  logger.info('hedera_burn_success', {
    token_id: HEDERA_TOKEN_ID,
    serial,
    duration_ms: Date.now() - startedAt,
  })

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

// ---- Mirror Node Fallback (DB-down resilience) ----

/**
 * Find an active parking NFT by plate number via the Mirror Node.
 * Used as a fallback when the DB is unreachable during exit.
 * The plate is hashed before querying — Mirror Node never sees the raw plate.
 */
export async function findActiveSessionOnHedera(
  plateNumber: string,
): Promise<ActiveNftSession | null> {
  if (!HEDERA_TOKEN_ID) return null

  const plate_hash = hashPlate(plateNumber)
  const result = await htsFindByPlate(HEDERA_TOKEN_ID, plate_hash, HEDERA_NETWORK, _encryptionKey)
  if (result?.entryTime) {
    const lagSeconds = Math.max(0, Math.floor(Date.now() / 1000) - result.entryTime)
    mirrorLagSeconds.observe(lagSeconds)
  }
  return result
}

export async function checkHederaConnectivity(): Promise<boolean> {
  if (!isHederaEnabled() || !HEDERA_TOKEN_ID) return false
  try {
    const client = getClient()
    await new TokenInfoQuery().setTokenId(HEDERA_TOKEN_ID).execute(client)
    return true
  } catch (error) {
    logger.warn('hedera_connectivity_check_failed', { token_id: HEDERA_TOKEN_ID }, error)
    return false
  }
}

export async function checkMirrorNodeConnectivity(): Promise<boolean> {
  if (!HEDERA_TOKEN_ID) return false
  const baseUrl =
    HEDERA_NETWORK === 'mainnet'
      ? 'https://mainnet-public.mirrornode.hedera.com'
      : HEDERA_NETWORK === 'previewnet'
        ? 'https://previewnet.mirrornode.hedera.com'
        : 'https://testnet.mirrornode.hedera.com'
  try {
    const res = await fetch(`${baseUrl}/api/v1/tokens/${HEDERA_TOKEN_ID}`)
    return res.ok || res.status === 404
  } catch (error) {
    logger.warn('mirror_connectivity_check_failed', { base_url: baseUrl }, error)
    return false
  }
}

export { type ActiveNftSession }
