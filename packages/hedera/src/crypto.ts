import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

// ---- Types ----

export interface NftPlaintext {
  plateHash: string // keccak256 hash (with 0x prefix)
  lotId: string
  entryTime: number // unix timestamp (seconds)
}

// ---- Constants ----

const VERSION_ENCRYPTED = 0x01
const IV_LEN = 12
const TAG_LEN = 16
const PLATE_HASH_LEN = 32 // raw bytes (no 0x prefix)
const ENTRY_TIME_LEN = 4 // uint32 BE
const ALGORITHM = 'aes-256-gcm'

// ---- Binary Encode / Decode ----

/**
 * Binary-pack plaintext NFT metadata.
 * Format: [32B raw plateHash][1B lotIdLen][NB lotId UTF-8][4B entryTime uint32 BE]
 */
export function encodePlaintext(data: NftPlaintext): Buffer {
  const plateHashHex = data.plateHash.replace(/^0x/, '')
  const plateHashBuf = Buffer.from(plateHashHex, 'hex')
  if (plateHashBuf.length !== PLATE_HASH_LEN) {
    throw new Error(`Invalid plateHash length: expected ${PLATE_HASH_LEN} bytes, got ${plateHashBuf.length}`)
  }

  const lotIdBuf = Buffer.from(data.lotId, 'utf-8')
  if (lotIdBuf.length > 255) {
    throw new Error(`lotId too long: ${lotIdBuf.length} bytes (max 255)`)
  }

  const buf = Buffer.alloc(PLATE_HASH_LEN + 1 + lotIdBuf.length + ENTRY_TIME_LEN)
  let offset = 0

  plateHashBuf.copy(buf, offset)
  offset += PLATE_HASH_LEN

  buf.writeUInt8(lotIdBuf.length, offset)
  offset += 1

  lotIdBuf.copy(buf, offset)
  offset += lotIdBuf.length

  buf.writeUInt32BE(data.entryTime, offset)

  return buf
}

/**
 * Binary-unpack plaintext NFT metadata.
 */
export function decodePlaintext(buf: Buffer): NftPlaintext {
  let offset = 0

  const plateHashBuf = buf.subarray(offset, offset + PLATE_HASH_LEN)
  offset += PLATE_HASH_LEN

  const lotIdLen = buf.readUInt8(offset)
  offset += 1

  const lotId = buf.subarray(offset, offset + lotIdLen).toString('utf-8')
  offset += lotIdLen

  const entryTime = buf.readUInt32BE(offset)

  return {
    plateHash: `0x${plateHashBuf.toString('hex')}`,
    lotId,
    entryTime,
  }
}

// ---- Encrypt / Decrypt ----

/**
 * Encrypt NFT metadata with AES-256-GCM.
 * Output format: [1B version=0x01][12B IV][NB ciphertext][16B auth tag]
 */
export function encryptMetadata(data: NftPlaintext, key: Buffer): Buffer {
  const plaintext = encodePlaintext(data)
  const iv = randomBytes(IV_LEN)

  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()

  return Buffer.concat([
    Buffer.from([VERSION_ENCRYPTED]),
    iv,
    encrypted,
    tag,
  ])
}

/**
 * Decrypt NFT metadata from AES-256-GCM envelope.
 * Returns null if decryption or parsing fails (wrong key, tampered data, etc.)
 */
export function decryptMetadata(buf: Buffer, key: Buffer): NftPlaintext | null {
  try {
    if (buf.length < 1 + IV_LEN + TAG_LEN + 1) return null
    if (buf[0] !== VERSION_ENCRYPTED) return null

    const iv = buf.subarray(1, 1 + IV_LEN)
    const ciphertext = buf.subarray(1 + IV_LEN, buf.length - TAG_LEN)
    const tag = buf.subarray(buf.length - TAG_LEN)

    const decipher = createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(tag)
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])

    return decodePlaintext(plaintext)
  } catch {
    return null
  }
}

// ---- Parse from Mirror Node ----

/**
 * Parse NFT metadata from base64-encoded Mirror Node response.
 * Decrypts the AES-256-GCM envelope and returns the plaintext, or null on failure.
 */
export function parseMetadata(rawBase64: string, key: Buffer): NftPlaintext | null {
  try {
    const buf = Buffer.from(rawBase64, 'base64')
    return decryptMetadata(buf, key)
  } catch {
    return null
  }
}

// ---- Key Parsing ----

/**
 * Parse an encryption key from a string.
 * Accepts 64-char hex or 44-char base64 (both representing 32 bytes).
 * Throws if the key is invalid.
 */
export function parseEncryptionKey(keyStr: string): Buffer {
  const trimmed = keyStr.trim()

  // Try hex (64 chars = 32 bytes)
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex')
  }

  // Try base64 (44 chars with padding = 32 bytes)
  if (/^[A-Za-z0-9+/]{43}=$/.test(trimmed) || /^[A-Za-z0-9+/]{42}==$/.test(trimmed)) {
    const buf = Buffer.from(trimmed, 'base64')
    if (buf.length === 32) return buf
  }

  throw new Error(
    `Invalid NFT_ENCRYPTION_KEY: expected 64-char hex or 44-char base64 (32 bytes). Got ${trimmed.length} chars.`,
  )
}
