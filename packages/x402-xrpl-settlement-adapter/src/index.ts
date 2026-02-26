import { Client } from 'xrpl'
import type { SettlementAdapter, PaymentTransferResult } from '@parker/x402'

export interface XrplSettlementAdapterOptions {
  serverUrl: string
}

function isIssuedCurrency(
  value: unknown,
): value is { currency: string; issuer?: string; value: string } {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.currency === 'string' && typeof record.value === 'string'
}

function decimalToScaledBigInt(value: string, decimals: number): bigint {
  const [wholeRaw, fractionRaw = ''] = value.split('.')
  const whole = wholeRaw || '0'
  const fraction = (fractionRaw + '0'.repeat(decimals)).slice(0, decimals)
  return BigInt(`${whole}${fraction}`)
}

function decodeHexMemoField(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined
  const hex = value.startsWith('0x') ? value.slice(2) : value
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) return undefined
  try {
    return Buffer.from(hex, 'hex').toString('utf8')
  } catch {
    return undefined
  }
}

/**
 * Extract paymentId from XRPL tx JSON memo (MemoType: x402:xrpl:v1).
 * Exported for unit tests and for use by Parker API when binding paymentId to settlement.
 */
export function extractPaymentIdFromTxJson(tx: Record<string, unknown>): string | undefined {
  const memos = tx.Memos
  if (!Array.isArray(memos)) return undefined

  for (const entry of memos) {
    if (!entry || typeof entry !== 'object') continue
    const memoWrapper = (entry as Record<string, unknown>).Memo
    if (!memoWrapper || typeof memoWrapper !== 'object') continue
    const memo = memoWrapper as Record<string, unknown>
    const memoType = decodeHexMemoField(memo.MemoType)
    const memoDataRaw = decodeHexMemoField(memo.MemoData)
    if (memoType !== 'x402:xrpl:v1' || !memoDataRaw) continue
    try {
      const parsed = JSON.parse(memoDataRaw) as Record<string, unknown>
      const paymentId = parsed.paymentId
      if (typeof paymentId === 'string' && paymentId.trim().length > 0) {
        return paymentId.trim()
      }
    } catch {
      // Ignore malformed memo payload and continue scanning.
    }
  }
  return undefined
}

function extractPaymentReference(tx: Record<string, unknown>): string | undefined {
  return extractPaymentIdFromTxJson(tx)
}

const TF_PARTIAL_PAYMENT = 0x00020000

/**
 * XRPL settlement adapter for x402.
 *
 * Notes:
 * - XRP amounts are returned in drops (1 XRP = 1_000_000 drops), which aligns with 6-decimal scaling.
 * - Issued currency values are scaled to 6 decimals.
 */
export function createXrplSettlementAdapter(
  options: XrplSettlementAdapterOptions,
): SettlementAdapter {
  if (!options.serverUrl) {
    throw new Error('XRPL server URL is required')
  }

  return {
    async verifyPayment(paymentProof: string): Promise<PaymentTransferResult> {
      if (!/^[A-Fa-f0-9]{64}$/.test(paymentProof)) {
        throw new Error('Invalid XRPL transaction hash format')
      }

      const client = new Client(options.serverUrl)
      await client.connect()

      try {
        const txResponse = await client.request({
          command: 'tx',
          transaction: paymentProof,
        })

        const payload = txResponse.result as unknown as Record<string, unknown>
        const validated = payload.validated === true
        if (!validated) {
          throw new Error('XRPL transaction is not yet validated')
        }

        const tx = payload.tx_json as Record<string, unknown> | undefined
        if (!tx || tx.TransactionType !== 'Payment') {
          throw new Error('XRPL transaction is not a Payment')
        }
        const flags = typeof tx.Flags === 'number' ? tx.Flags : 0
        const destinationTag = typeof tx.DestinationTag === 'number' ? tx.DestinationTag : undefined
        const isPartialPayment = (flags & TF_PARTIAL_PAYMENT) !== 0
        const hasPaths = Array.isArray(tx.Paths) && tx.Paths.length > 0
        const hasSendMax = tx.SendMax != null
        const hasDeliverMin = tx.DeliverMin != null
        const paymentReference = extractPaymentReference(tx)

        const meta = payload.meta as Record<string, unknown> | undefined
        const txResult = meta?.TransactionResult
        if (txResult !== 'tesSUCCESS') {
          throw new Error(`XRPL payment failed with status ${String(txResult ?? 'unknown')}`)
        }

        const delivered = meta?.delivered_amount
        if (typeof delivered === 'string') {
          return {
            from: String(tx.Account ?? ''),
            to: String(tx.Destination ?? ''),
            amount: BigInt(delivered),
            confirmed: true,
            assetCode: 'XRP',
            txHash: paymentProof,
            paymentReference,
            destinationTag,
            isPartialPayment,
            hasPaths,
            hasSendMax,
            hasDeliverMin,
          }
        }

        if (isIssuedCurrency(delivered)) {
          return {
            from: String(tx.Account ?? ''),
            to: String(tx.Destination ?? ''),
            amount: decimalToScaledBigInt(delivered.value, 6),
            confirmed: true,
            assetCode: delivered.currency,
            assetIssuer: delivered.issuer,
            txHash: paymentProof,
            paymentReference,
            destinationTag,
            isPartialPayment,
            hasPaths,
            hasSendMax,
            hasDeliverMin,
          }
        }

        throw new Error('Unable to determine delivered amount from XRPL transaction')
      } finally {
        await client.disconnect()
      }
    },
  }
}
