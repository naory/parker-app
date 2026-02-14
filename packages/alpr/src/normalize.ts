/**
 * Country-aware license plate normalization and validation.
 *
 * Supported formats:
 *   IL  — 7 digits (XX-XXX-XX) or 8 digits (XXX-XX-XXX)
 *   US  — 1-7 alphanumeric characters
 *   EU  — 1-8 alphanumeric characters (generic, covers most EU countries)
 *
 * Extend by adding a case to `normalizePlate` and `isValidPlate`.
 */

/**
 * Strip a raw plate string to alphanumeric characters only.
 */
function stripPlate(raw: string): string {
  return raw.replace(/[^0-9A-Za-z]/g, '').toUpperCase()
}

// --- Country-specific normalizers ---

function normalizeIL(stripped: string): string | null {
  // 7-digit format: XX-XXX-XX
  const match7 = stripped.match(/^(\d{2})(\d{3})(\d{2})$/)
  if (match7) return `${match7[1]}-${match7[2]}-${match7[3]}`
  // 8-digit format: XXX-XX-XXX
  const match8 = stripped.match(/^(\d{3})(\d{2})(\d{3})$/)
  if (match8) return `${match8[1]}-${match8[2]}-${match8[3]}`
  return null
}

function normalizeUS(stripped: string): string | null {
  // US plates: 1-7 alphanumeric, no standard dash pattern
  if (/^[A-Z0-9]{1,7}$/.test(stripped)) return stripped
  return null
}

function normalizeEU(stripped: string): string | null {
  // Generic EU: 1-8 alphanumeric
  if (/^[A-Z0-9]{1,8}$/.test(stripped)) return stripped
  return null
}

// --- Public API ---

/**
 * Normalize a plate number for a given country code (ISO 3166-1 alpha-2).
 * Returns the formatted plate or null if invalid for that country.
 *
 * When no countryCode is provided, tries all known formats (IL first).
 */
export function normalizePlate(raw: string, countryCode?: string): string | null {
  const stripped = stripPlate(raw)
  if (!stripped) return null

  const code = countryCode?.toUpperCase()

  switch (code) {
    case 'IL':
      return normalizeIL(stripped)
    case 'US':
      return normalizeUS(stripped)
    case 'GB':
    case 'DE':
    case 'FR':
    case 'ES':
    case 'IT':
    case 'NL':
      return normalizeEU(stripped)
    default:
      // No country specified — try IL first, then generic alphanumeric
      return normalizeIL(stripped) ?? normalizeEU(stripped)
  }
}

/**
 * Check if a raw string is a valid plate number for a given country.
 */
export function isValidPlate(raw: string, countryCode?: string): boolean {
  return normalizePlate(raw, countryCode) !== null
}

// --- Backwards-compatible aliases (deprecated) ---

/** @deprecated Use `normalizePlate(raw, 'IL')` instead */
export const normalizeIsraeliPlate = (raw: string) => normalizePlate(raw, 'IL')
/** @deprecated Use `isValidPlate(raw, 'IL')` instead */
export const isValidIsraeliPlate = (raw: string) => isValidPlate(raw, 'IL')
