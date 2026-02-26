/**
 * Build policy assets from what settlement can verify (no DB).
 * Used by exit policy evaluation.
 */

import type { Rail, Asset } from '@parker/policy-core'
import { USDC_ADDRESSES } from '@parker/core'
import { X402_NETWORK } from '../pricing'

const CHAIN_ID_BY_NETWORK: Record<string, number> = {
  'base-sepolia': 84532,
  base: 8453,
}

/**
 * Build assets offered for policy from actual settlement options only.
 * XRPL: XRP (optional) + IOU only when XRPL_ISSUER is set (fail closed). EVM: ERC20.
 * Stripe is a rail only; no asset is offered for it.
 */
export function buildAssetsOffered(railsOffered: Rail[]): Asset[] {
  const assets: Asset[] = []
  if (railsOffered.includes('xrpl')) {
    if (process.env.XRPL_ALLOW_XRP === 'true') {
      assets.push({ kind: 'XRP' })
    }
    const issuer = process.env.XRPL_ISSUER
    if (issuer && issuer.trim().length > 0) {
      const iouCurrency = process.env.XRPL_IOU_CURRENCY ?? 'RLUSD'
      assets.push({ kind: 'IOU', currency: iouCurrency, issuer: issuer.trim() })
    }
  }
  if (railsOffered.includes('evm')) {
    const network = X402_NETWORK
    const chainId = CHAIN_ID_BY_NETWORK[network] ?? 0
    const token = USDC_ADDRESSES[network]
    if (chainId && token) {
      assets.push({ kind: 'ERC20', chainId, token })
    }
  }
  return assets
}
