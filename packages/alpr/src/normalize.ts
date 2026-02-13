/**
 * Israeli license plate formats:
 * - 7 digits: XX-XXX-XX (older format)
 * - 8 digits: XXX-XX-XXX (newer format)
 *
 * This module normalizes and validates Israeli plate numbers.
 */

const PLATE_7_REGEX = /^(\d{2})-?(\d{3})-?(\d{2})$/
const PLATE_8_REGEX = /^(\d{3})-?(\d{2})-?(\d{3})$/

/**
 * Normalize a raw plate string by removing whitespace, dashes, and non-alphanumeric chars.
 */
function stripPlate(raw: string): string {
  return raw.replace(/[^0-9A-Za-z]/g, '').toUpperCase()
}

/**
 * Validate and format an Israeli plate number.
 * Returns the formatted plate (with dashes) or null if invalid.
 */
export function normalizeIsraeliPlate(raw: string): string | null {
  const stripped = stripPlate(raw)

  // Try 7-digit format
  const match7 = stripped.match(/^(\d{2})(\d{3})(\d{2})$/)
  if (match7) {
    return `${match7[1]}-${match7[2]}-${match7[3]}`
  }

  // Try 8-digit format
  const match8 = stripped.match(/^(\d{3})(\d{2})(\d{3})$/)
  if (match8) {
    return `${match8[1]}-${match8[2]}-${match8[3]}`
  }

  return null
}

/**
 * Check if a raw string is a valid Israeli plate number.
 */
export function isValidIsraeliPlate(raw: string): boolean {
  return normalizeIsraeliPlate(raw) !== null
}
