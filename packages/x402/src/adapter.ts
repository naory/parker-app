export interface PaymentTransferResult {
  from: string
  to: string
  amount: bigint
  confirmed: boolean
  assetCode?: string
  assetIssuer?: string
  txHash?: string
  paymentReference?: string
  /** XRPL-specific details used for strict settlement hardening. */
  destinationTag?: number
  isPartialPayment?: boolean
  hasPaths?: boolean
  hasSendMax?: boolean
  hasDeliverMin?: boolean
}

export interface SettlementAdapter {
  verifyPayment: (paymentProof: string) => Promise<PaymentTransferResult>
}
