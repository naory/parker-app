import {
  Client,
  TokenId,
  TokenMintTransaction,
  TokenBurnTransaction,
  Status,
} from '@hashgraph/sdk'

// ---- Types ----

export interface ParkingNFTMetadata {
  plateNumber: string
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

// ---- Mirror Node Query ----

/**
 * Check if a specific NFT serial exists (not burned) via the Hedera Mirror Node REST API.
 * This is a read-only query that doesn't cost HBAR.
 */
export async function getNftInfo(
  tokenId: string,
  serial: number,
  network: 'testnet' | 'mainnet' | 'previewnet' = 'testnet',
): Promise<{ exists: boolean; metadata?: string; deleted: boolean }> {
  const baseUrl =
    network === 'mainnet'
      ? 'https://mainnet-public.mirrornode.hedera.com'
      : network === 'previewnet'
        ? 'https://previewnet.mirrornode.hedera.com'
        : 'https://testnet.mirrornode.hedera.com'

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
