/**
 * Enforce that an exit decision stays within the entry grant (rail/asset ⊆ grant, caps at least as strict).
 */

import type { PaymentPolicyDecision, PolicyReasonCode, Asset, Rail } from '@parker/policy-core'
import type { PolicyGrantRecord } from '../../db/queries'

function assetInList(asset: Asset, list: unknown[]): boolean {
  return list.some((item) => {
    if (!item || typeof item !== 'object') return false
    const x = item as Record<string, unknown>
    if (x.kind === 'XRP') return asset.kind === 'XRP'
    if (x.kind === 'IOU' && asset.kind === 'IOU')
      return x.currency === asset.currency && x.issuer === asset.issuer
    if (x.kind === 'ERC20' && asset.kind === 'ERC20')
      return x.chainId === asset.chainId && x.token === asset.token
    return false
  })
}

/**
 * Check that the exit decision is within the entry grant:
 * - decision.rail is in grant.allowedRails
 * - if decision.asset is set, it is in grant.allowedAssets
 * - decision caps are at least as strict as grant caps (decision cap <= grant cap)
 */
export function validateDecisionAgainstGrant(
  grant: PolicyGrantRecord,
  decision: PaymentPolicyDecision,
): { valid: true } | { valid: false; reason: PolicyReasonCode } {
  if (decision.action !== 'ALLOW' && decision.action !== 'REQUIRE_APPROVAL') {
    return { valid: true }
  }

  const rail = decision.rail as Rail | undefined
  if (rail !== undefined && !grant.allowedRails.includes(rail)) {
    return { valid: false, reason: 'RAIL_NOT_ALLOWED' }
  }

  if (decision.asset !== undefined && !assetInList(decision.asset, grant.allowedAssets)) {
    return { valid: false, reason: 'ASSET_NOT_ALLOWED' }
  }

  const g = grant.maxSpend
  const d = decision.maxSpend
  if (g?.perTxMinor !== undefined && d?.perTxMinor !== undefined) {
    if (BigInt(d.perTxMinor) > BigInt(g.perTxMinor)) {
      return { valid: false, reason: 'CAP_EXCEEDED_TX' }
    }
  }
  if (g?.perSessionMinor !== undefined && d?.perSessionMinor !== undefined) {
    if (BigInt(d.perSessionMinor) > BigInt(g.perSessionMinor)) {
      return { valid: false, reason: 'CAP_EXCEEDED_SESSION' }
    }
  }
  if (g?.perDayMinor !== undefined && d?.perDayMinor !== undefined) {
    if (BigInt(d.perDayMinor) > BigInt(g.perDayMinor)) {
      return { valid: false, reason: 'CAP_EXCEEDED_DAY' }
    }
  }

  return { valid: true }
}
