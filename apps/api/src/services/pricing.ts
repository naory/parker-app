/**
 * Currency-agnostic pricing service.
 *
 * Converts parking fees from any local currency to the configured stablecoin
 * for the x402 crypto payment rail.
 *
 * For MVP: uses static FX rates from environment variables.
 * Future: plug in a live price feed (CoinGecko, Circle, oracle).
 */

// ---- Configuration ----

/** The stablecoin used for x402 settlement (e.g. "USDC") */
export const X402_STABLECOIN = process.env.X402_STABLECOIN || 'USDC'

/** The network used for x402 settlement (e.g. "base-sepolia") */
export const X402_NETWORK = process.env.X402_NETWORK || 'base-sepolia'

/**
 * Load FX rates from env vars.
 * Pattern: FX_RATE_{FROM}_{TO}=<rate>
 * e.g. FX_RATE_EUR_USD=1.08, FX_RATE_GBP_USD=1.27
 *
 * The stablecoin base currency is derived from the stablecoin symbol.
 * USDC → USD, EURC → EUR, etc. Override with X402_BASE_CURRENCY.
 */
export function getStablecoinBaseCurrency(): string {
  if (process.env.X402_BASE_CURRENCY) return process.env.X402_BASE_CURRENCY.toUpperCase()
  const map: Record<string, string> = {
    USDC: 'USD',
    USDT: 'USD',
    EURC: 'EUR',
    DAI: 'USD',
  }
  return map[X402_STABLECOIN.toUpperCase()] || 'USD'
}

/**
 * Get the FX rate for converting `from` currency to `to` currency.
 * Reads from env var FX_RATE_{FROM}_{TO}.
 * Returns 1.0 if currencies match.
 * Throws if no rate is configured.
 */
export function getFxRate(from: string, to: string): number {
  const fromUpper = from.toUpperCase()
  const toUpper = to.toUpperCase()

  if (fromUpper === toUpper) return 1.0

  const envKey = `FX_RATE_${fromUpper}_${toUpper}`
  const rateStr = process.env[envKey]
  if (rateStr) {
    const rate = parseFloat(rateStr)
    if (!isNaN(rate) && rate > 0) return rate
  }

  // Try the inverse: FX_RATE_{TO}_{FROM} and invert
  const inverseKey = `FX_RATE_${toUpper}_${fromUpper}`
  const inverseStr = process.env[inverseKey]
  if (inverseStr) {
    const inverseRate = parseFloat(inverseStr)
    if (!isNaN(inverseRate) && inverseRate > 0) return 1 / inverseRate
  }

  throw new Error(
    `No FX rate configured for ${fromUpper} → ${toUpper}. Set ${envKey} or ${inverseKey} in environment.`,
  )
}

/**
 * Convert an amount from a local currency to the configured stablecoin amount.
 * Used by the x402 payment rail to determine how much stablecoin to charge.
 *
 * @param amount - Fee amount in local currency
 * @param fromCurrency - ISO 4217 code of the local currency (e.g. "EUR", "GBP")
 * @returns The equivalent stablecoin amount (rounded to 6 decimal places)
 */
export function convertToStablecoin(amount: number, fromCurrency: string): number {
  const baseCurrency = getStablecoinBaseCurrency()
  const rate = getFxRate(fromCurrency, baseCurrency)
  return Math.round(amount * rate * 1_000_000) / 1_000_000
}

/**
 * Format a fee amount with its currency for display.
 * e.g. formatLocalFee(37.5, "EUR") → "37.50 EUR"
 */
export function formatLocalFee(amount: number, currency: string): string {
  return `${amount.toFixed(2)} ${currency.toUpperCase()}`
}
