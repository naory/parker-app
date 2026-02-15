/**
 * EIP-681 URI builder for ERC-20 token transfers.
 *
 * Generates `ethereum:` URIs that can be encoded as QR codes and scanned
 * by any EIP-681-compatible wallet (MetaMask, Coinbase Wallet, etc.).
 *
 * Format: ethereum:<tokenAddress>@<chainId>/transfer?address=<to>&uint256=<amountInSmallestUnit>
 *
 * @see https://eips.ethereum.org/EIPS/eip-681
 */

/** Map of chain name → EIP-155 chain ID */
const CHAIN_IDS: Record<string, number> = {
  'base-sepolia': 84532,
  'base': 8453,
}

export interface BuildERC20TransferURIOptions {
  /** ERC-20 token contract address */
  tokenAddress: string
  /** Recipient address */
  to: string
  /** Human-readable amount (e.g. "1.50" for 1.50 USDC) */
  amount: string
  /** Token decimals (default: 6 for USDC) */
  decimals?: number
  /** Chain name (e.g. "base-sepolia") or numeric chain ID */
  chainId?: string | number
}

/**
 * Build an EIP-681 URI for an ERC-20 `transfer(address,uint256)` call.
 *
 * Example output:
 *   ethereum:0x036C...@84532/transfer?address=0xABC...&uint256=1500000
 */
export function buildERC20TransferURI({
  tokenAddress,
  to,
  amount,
  decimals = 6,
  chainId = 'base-sepolia',
}: BuildERC20TransferURIOptions): string {
  // Resolve chain ID from name if needed
  const numericChainId = typeof chainId === 'number'
    ? chainId
    : CHAIN_IDS[chainId]

  // Convert human-readable amount to smallest unit (e.g. 1.50 USDC → 1500000)
  const amountInSmallestUnit = parseAmountToSmallestUnit(amount, decimals)

  let uri = `ethereum:${tokenAddress}`
  if (numericChainId) {
    uri += `@${numericChainId}`
  }
  uri += `/transfer?address=${to}&uint256=${amountInSmallestUnit}`

  return uri
}

/**
 * Convert a decimal string amount to its smallest-unit bigint representation.
 * e.g. "1.50" with 6 decimals → "1500000"
 */
function parseAmountToSmallestUnit(amount: string, decimals: number): string {
  const [whole = '0', frac = ''] = amount.split('.')
  const paddedFrac = frac.padEnd(decimals, '0').slice(0, decimals)
  const raw = whole + paddedFrac
  // Strip leading zeros but keep at least one digit
  return raw.replace(/^0+/, '') || '0'
}
