import { keccak256, toBytes } from 'viem'

/**
 * Normalize an Israeli license plate to a consistent format.
 * Strips whitespace, dashes, and converts to uppercase.
 * Input: "12-345-67", "12 345 67", "1234567"
 * Output: "1234567"
 */
export function normalizePlate(plate: string): string {
  return plate.replace(/[\s-]/g, '').toUpperCase()
}

/**
 * Format a plate number with dashes for display.
 * 7 digits: XX-XXX-XX
 * 8 digits: XXX-XX-XXX
 */
export function formatPlate(plate: string): string {
  const normalized = normalizePlate(plate)
  if (normalized.length === 7) {
    return `${normalized.slice(0, 2)}-${normalized.slice(2, 5)}-${normalized.slice(5)}`
  }
  if (normalized.length === 8) {
    return `${normalized.slice(0, 3)}-${normalized.slice(3, 5)}-${normalized.slice(5)}`
  }
  return normalized
}

/**
 * Hash a plate number for on-chain storage (matches Solidity keccak256).
 */
export function hashPlate(plateNumber: string): `0x${string}` {
  return keccak256(toBytes(plateNumber))
}

/**
 * Format a USDC amount (6 decimals) for display.
 * Input: 7430000n (7.43 USDC)
 * Output: "7.43"
 */
export function formatFee(amountUsdc: bigint): string {
  const whole = amountUsdc / 1_000_000n
  const frac = amountUsdc % 1_000_000n
  const fracStr = frac.toString().padStart(6, '0').replace(/0+$/, '')
  return fracStr ? `${whole}.${fracStr}` : whole.toString()
}

/**
 * Calculate parking fee.
 * fee = ceil(durationMinutes / billingIncrement) * ratePerIncrement
 *
 * Guards:
 * - Negative or zero duration → minimum 1 increment
 * - Zero or negative billingIncrement → defaults to 15
 * - Zero or negative rate → fee = 0
 */
export function calculateFee(
  durationMinutes: number,
  ratePerHourUsdc: number,
  billingIncrementMinutes: number = 15,
  maxDailyFeeUsdc?: number,
): number {
  if (ratePerHourUsdc <= 0) return 0
  if (billingIncrementMinutes <= 0) billingIncrementMinutes = 15

  // At least 1 increment (entering and immediately exiting still costs one unit)
  const increments = Math.max(1, Math.ceil(durationMinutes / billingIncrementMinutes))
  const ratePerIncrement = (ratePerHourUsdc / 60) * billingIncrementMinutes
  const fee = Math.round(increments * ratePerIncrement * 1_000_000) / 1_000_000 // round to 6 dp

  if (maxDailyFeeUsdc !== undefined && maxDailyFeeUsdc > 0) {
    return Math.min(fee, maxDailyFeeUsdc)
  }
  return fee
}
