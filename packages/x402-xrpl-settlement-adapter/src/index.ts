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
          }
        }

        throw new Error('Unable to determine delivered amount from XRPL transaction')
      } finally {
        await client.disconnect()
      }
    },
  }
}
