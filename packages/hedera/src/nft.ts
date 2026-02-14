import {
  Client,
  TokenId,
  TokenMintTransaction,
  TokenBurnTransaction,
  Status,
} from '@hashgraph/sdk'

// ---- Types ----

/**
 * On-chain NFT metadata — stored publicly on Hedera.
 * PRIVACY: plate is stored as a keccak256 hash, never in plaintext.
 * The API correlates NFTs to sessions by matching hashPlate(plate) against plateHash.
 */
export interface ParkingNFTMetadata {
  plateHash: string // keccak256 hash of the normalized plate number
  lotId: string
  entryTime: number // unix timestamp (seconds)
}

export interface MintResult {
  serial: number
  transactionId: string
}

export interface BurnResult {
  transactionId: string
}

// ---- Mint ----

/**
 * Mint a parking session NFT on Hedera via HTS.
 * The metadata is encoded as a JSON string in the NFT's metadata bytes.
 * Returns the serial number assigned by HTS.
 */
export async function mintParkingNFT(
  client: Client,
  tokenId: string,
  metadata: ParkingNFTMetadata,
): Promise<MintResult> {
  const metadataBytes = Buffer.from(JSON.stringify(metadata), 'utf-8')

  const tx = new TokenMintTransaction()
    .setTokenId(TokenId.fromString(tokenId))
    .addMetadata(metadataBytes)

  const response = await tx.execute(client)
  const receipt = await response.getReceipt(client)

  if (receipt.status !== Status.Success) {
    throw new Error(`HTS mint failed: ${receipt.status.toString()}`)
  }

  const serial = receipt.serials[0]?.toNumber()
  if (serial === undefined || serial === null) {
    throw new Error('HTS mint succeeded but no serial returned')
  }

  const transactionId = response.transactionId.toString()

  console.log(`[hedera] Minted parking NFT: token=${tokenId}, serial=${serial}, tx=${transactionId}`)

  return { serial, transactionId }
}

// ---- Burn ----

/**
 * Burn a parking session NFT on Hedera (end of session).
 * The serial is destroyed; on-chain state reflects the car is no longer parked.
 */
export async function burnParkingNFT(
  client: Client,
  tokenId: string,
  serial: number,
): Promise<BurnResult> {
  const tx = new TokenBurnTransaction()
    .setTokenId(TokenId.fromString(tokenId))
    .setSerials([serial])

  const response = await tx.execute(client)
  const receipt = await response.getReceipt(client)

  if (receipt.status !== Status.Success) {
    throw new Error(`HTS burn failed: ${receipt.status.toString()}`)
  }

  const transactionId = response.transactionId.toString()

  console.log(`[hedera] Burned parking NFT: token=${tokenId}, serial=${serial}, tx=${transactionId}`)

  return { transactionId }
}

// ---- Mirror Node Helpers ----

function getMirrorNodeBaseUrl(network: 'testnet' | 'mainnet' | 'previewnet'): string {
  switch (network) {
    case 'mainnet': return 'https://mainnet-public.mirrornode.hedera.com'
    case 'previewnet': return 'https://previewnet.mirrornode.hedera.com'
    default: return 'https://testnet.mirrornode.hedera.com'
  }
}

// ---- Mirror Node Query: Single NFT ----

/**
 * Check if a specific NFT serial exists (not burned) via the Hedera Mirror Node REST API.
 * This is a read-only query that doesn't cost HBAR.
 */
export async function getNftInfo(
  tokenId: string,
  serial: number,
  network: 'testnet' | 'mainnet' | 'previewnet' = 'testnet',
): Promise<{ exists: boolean; metadata?: string; deleted: boolean }> {
  const baseUrl = getMirrorNodeBaseUrl(network)
  const url = `${baseUrl}/api/v1/tokens/${tokenId}/nfts/${serial}`

  try {
    const res = await fetch(url)
    if (res.status === 404) {
      return { exists: false, deleted: true }
    }
    if (!res.ok) {
      throw new Error(`Mirror node error: ${res.status}`)
    }

    const data = (await res.json()) as {
      deleted: boolean
      metadata: string // base64-encoded
    }

    const metadata = data.metadata
      ? Buffer.from(data.metadata, 'base64').toString('utf-8')
      : undefined

    return {
      exists: !data.deleted,
      metadata,
      deleted: data.deleted,
    }
  } catch (error) {
    console.error(`[hedera] Mirror node query failed for ${tokenId}/${serial}:`, error)
    return { exists: false, deleted: false }
  }
}

// ---- Mirror Node Query: Find Active NFT by Plate Hash ----

/** Parsed NFT with decoded metadata */
export interface ActiveNftSession {
  serial: number
  plateHash: string
  lotId: string
  entryTime: number // unix seconds
}

/**
 * Search the Mirror Node for an active (not burned) parking NFT matching a given plateHash.
 * Used as a DB fallback when PostgreSQL is unreachable.
 *
 * Scans the most recent NFTs in the collection (paginated, newest first).
 * Returns the first active NFT whose metadata.plateHash matches the target.
 */
export async function findActiveNftByPlateHash(
  tokenId: string,
  plateHash: string,
  network: 'testnet' | 'mainnet' | 'previewnet' = 'testnet',
): Promise<ActiveNftSession | null> {
  const baseUrl = getMirrorNodeBaseUrl(network)

  // Paginate through NFTs (newest first, up to 3 pages of 100)
  let nextUrl: string | null = `${baseUrl}/api/v1/tokens/${tokenId}/nfts?order=desc&limit=100`
  let pagesChecked = 0
  const maxPages = 3 // Safety limit — don't scan the entire collection

  while (nextUrl && pagesChecked < maxPages) {
    try {
      const res = await fetch(nextUrl)
      if (!res.ok) {
        console.error(`[hedera] Mirror node list error: ${res.status}`)
        return null
      }

      const data = (await res.json()) as {
        nfts: Array<{
          serial_number: number
          deleted: boolean
          metadata: string // base64-encoded
        }>
        links?: { next?: string }
      }

      for (const nft of data.nfts) {
        // Skip burned NFTs
        if (nft.deleted) continue

        // Decode metadata and check plateHash
        try {
          const metadataStr = Buffer.from(nft.metadata, 'base64').toString('utf-8')
          const meta = JSON.parse(metadataStr) as ParkingNFTMetadata
          if (meta.plateHash === plateHash) {
            return {
              serial: nft.serial_number,
              plateHash: meta.plateHash,
              lotId: meta.lotId,
              entryTime: meta.entryTime,
            }
          }
        } catch {
          // Skip NFTs with unparseable metadata
          continue
        }
      }

      // Follow pagination link (if any)
      nextUrl = data.links?.next ? `${baseUrl}${data.links.next}` : null
      pagesChecked++
    } catch (error) {
      console.error('[hedera] Mirror node scan failed:', error)
      return null
    }
  }

  return null
}
