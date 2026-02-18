export interface BuildXrplPaymentURIOptions {
  receiver: string
  amount: string
  currency: string
  network: string
  issuer?: string
}

export const XAMAN_LOGO_URL =
  'https://raw.githubusercontent.com/XRPL-Labs/Xaman-Branding/main/Logo/xaman-logo-black.svg'

/**
 * XRPL x402 network values are namespaced as "xrpl:*".
 */
export function isXrplNetwork(network: string | undefined): boolean {
  return Boolean(network?.startsWith('xrpl:'))
}

/**
 * XRPL tx hash is a 64-char hex string (no 0x prefix).
 */
export function isValidXrplTxHash(value: string): boolean {
  return /^[A-Fa-f0-9]{64}$/.test(value.trim())
}

/**
 * Build a wallet-friendly URI for XRPL payment intents.
 * Many wallets support the "xrpl:" scheme with query params.
 */
export function buildXrplPaymentURI({
  receiver,
  amount,
  currency,
  network,
  issuer,
}: BuildXrplPaymentURIOptions): string {
  const query = new URLSearchParams({
    amount,
    currency,
    network,
  })
  if (issuer) {
    query.set('issuer', issuer)
  }
  return `xrpl:${receiver}?${query.toString()}`
}

/**
 * Xaman-first URI builder.
 *
 * Currently returns the generic XRPL payment URI so wallets that support
 * the `xrpl:` scheme (including Xaman) can open directly.
 */
export function buildXamanPaymentURI(options: BuildXrplPaymentURIOptions): string {
  return buildXrplPaymentURI(options)
}
