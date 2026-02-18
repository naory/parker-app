export interface PaymentTransferResult {
  from: string
  to: string
  amount: bigint
  confirmed: boolean
  assetCode?: string
  assetIssuer?: string
}

export interface SettlementAdapter {
  verifyPayment: (paymentProof: string) => Promise<PaymentTransferResult>
}
