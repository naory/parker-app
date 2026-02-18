import { pool } from '../db'
import { isStripeEnabled } from './stripe'
import { checkHederaConnectivity, checkMirrorNodeConnectivity, isHederaEnabled } from './hedera'

export async function checkDatabaseConnectivity(): Promise<boolean> {
  try {
    await pool.query('SELECT 1')
    return true
  } catch {
    return false
  }
}

export function checkPaymentRailConfig(): {
  x402Configured: boolean
  stripeConfigured: boolean
  atLeastOneRail: boolean
} {
  const x402Network = process.env.X402_NETWORK || ''
  const isXrplRail = x402Network.startsWith('xrpl:')
  const x402Configured = Boolean(
    x402Network &&
    process.env.X402_STABLECOIN &&
    process.env.LOT_OPERATOR_WALLET &&
    (!isXrplRail || process.env.XRPL_RPC_URL),
  )
  const stripeConfigured = isStripeEnabled()
  return {
    x402Configured,
    stripeConfigured,
    atLeastOneRail: x402Configured || stripeConfigured,
  }
}

export async function getReadinessReport() {
  const db = await checkDatabaseConnectivity()
  const hederaConfigured = isHederaEnabled()
  const hedera = hederaConfigured ? await checkHederaConnectivity() : false
  const mirror = hederaConfigured ? await checkMirrorNodeConnectivity() : false
  const rails = checkPaymentRailConfig()

  return {
    db,
    hederaConfigured,
    hedera,
    mirror,
    paymentRails: rails,
    ready: db && hedera && mirror && rails.atLeastOneRail,
  }
}
