import { keccak256, toBytes } from 'viem'

/**
 * Normalize a license plate to a consistent format.
 * Strips whitespace, dashes, and converts to uppercase.
 * Input: "12-345-67", "12 345 67", "1234567", "ABC 1234"
 * Output: "1234567", "ABC1234"
 */
export function normalizePlate(plate: string): string {
  return plate.replace(/[\s-]/g, '').toUpperCase()
}

/**
 * Format a plate number for display.
 * Country-aware: if countryCode is provided, applies country-specific formatting.
 * Falls back to raw alphanumeric when no specific format is known.
 */
export function formatPlate(plate: string, countryCode?: string): string {
  const normalized = normalizePlate(plate)
  const code = countryCode?.toUpperCase()

  if (code === 'IL' || !code) {
    // IL format: 7-digit (XX-XXX-XX) or 8-digit (XXX-XX-XXX)
    if (/^\d{7}$/.test(normalized)) {
      return `${normalized.slice(0, 2)}-${normalized.slice(2, 5)}-${normalized.slice(5)}`
    }
    if (/^\d{8}$/.test(normalized)) {
      return `${normalized.slice(0, 3)}-${normalized.slice(3, 5)}-${normalized.slice(5)}`
    }
    // If no country and didn't match IL, fall through to generic
    if (code === 'IL') return normalized
  }

  // Generic: return the stripped alphanumeric string
  return normalized
}

/**
 * Hash a plate number for on-chain storage (matches Solidity keccak256).
 */
export function hashPlate(plateNumber: string): `0x${string}` {
  return keccak256(toBytes(plateNumber))
}

/**
 * Format a token amount with 6 decimals for display.
 * Input: 7430000n (7.43 in 6-decimal token)
 * Output: "7.43"
 */
export function formatFee(amount: bigint): string {
  const whole = amount / 1_000_000n
  const frac = amount % 1_000_000n
  const fracStr = frac.toString().padStart(6, '0').replace(/0+$/, '')
  return fracStr ? `${whole}.${fracStr}` : whole.toString()
}

/**
 * Calculate parking fee in the lot's local currency.
 * fee = ceil(durationMinutes / billingIncrement) * ratePerIncrement
 *
 * Guards:
 * - Negative or zero duration → minimum 1 increment
 * - Zero or negative billingIncrement → defaults to 15
 * - Zero or negative rate → fee = 0
 */
/**
 * Build a Hashscan URL for an NFT.
 * @param serial  The NFT serial number (e.g. 42)
 * @param tokenId Hedera token ID (e.g. "0.0.12345")
 * @param network "mainnet" | "testnet" | "previewnet"
 */
export function getHashscanNftUrl(
  serial: number | string,
  tokenId: string,
  network: string = 'testnet',
): string {
  return `https://hashscan.io/${network}/token/${tokenId}/${serial}`
}

export function calculateFee(
  durationMinutes: number,
  ratePerHour: number,
  billingIncrementMinutes: number = 15,
  maxDailyFee?: number,
  gracePeriodMinutes: number = 0,
): number {
  if (ratePerHour <= 0) return 0
  if (gracePeriodMinutes > 0 && durationMinutes <= gracePeriodMinutes) return 0
  if (billingIncrementMinutes <= 0) billingIncrementMinutes = 15

  // At least 1 increment (entering and immediately exiting still costs one unit)
  const increments = Math.max(1, Math.ceil(durationMinutes / billingIncrementMinutes))
  const ratePerIncrement = (ratePerHour / 60) * billingIncrementMinutes
  const fee = Math.round(increments * ratePerIncrement * 1_000_000) / 1_000_000 // round to 6 dp

  if (maxDailyFee !== undefined && maxDailyFee > 0) {
    return Math.min(fee, maxDailyFee)
  }
  return fee
}
