// ---- On-chain types (mirror Solidity structs) ----

export interface DriverProfile {
  wallet: string
  plateNumber: string
  countryCode: string
  carMake: string
  carModel: string
  active: boolean
  registeredAt: bigint
}

export interface ParkingSession {
  plateNumber: string
  lotId: string
  entryTime: bigint
  exitTime: bigint
  feePaid: bigint
  active: boolean
}

// ---- Off-chain types (API / DB) ----

export interface Lot {
  id: string
  name: string
  address?: string
  lat?: number
  lng?: number
  capacity?: number
  ratePerHour: number
  billingMinutes: number
  maxDailyFee?: number
  gracePeriodMinutes?: number
  /** ISO 4217 currency code (e.g. "USD", "EUR", "GBP") */
  currency: string
  /** Accepted payment methods for this lot */
  paymentMethods: string[]
  operatorWallet: string
}

export interface SessionRecord {
  id: string
  tokenId?: number
  plateNumber: string
  lotId: string
  entryTime: Date
  exitTime?: Date
  feeAmount?: number
  feeCurrency?: string
  stripePaymentId?: string
  txHash?: string
  status: 'active' | 'completed' | 'cancelled'
}

// ---- Payment types ----

export interface X402PaymentOption {
  /** Stablecoin amount after FX conversion */
  amount: string
  /** Token symbol (e.g. "USDC") */
  token: string
  /** Settlement network (e.g. "base-sepolia") */
  network: string
  /** Operator wallet to receive payment */
  receiver: string
}

export interface StripePaymentOption {
  /** Stripe-hosted checkout URL */
  checkoutUrl: string
}

export interface PaymentOptions {
  x402?: X402PaymentOption
  stripe?: StripePaymentOption
}

export interface DriverRecord {
  id: string
  wallet: string
  plateNumber: string
  countryCode: string
  carMake?: string
  carModel?: string
  active: boolean
  createdAt: Date
}

// ---- API Request/Response types ----

export interface RegisterDriverRequest {
  plateNumber: string
  countryCode: string
  carMake: string
  carModel: string
}

export interface GateEntryRequest {
  plateNumber?: string
  image?: string // base64 encoded image for ALPR
  lotId: string
}

export interface GateExitRequest {
  plateNumber?: string
  image?: string
  lotId: string
}

export interface LotStatus {
  lotId: string
  name: string
  address?: string
  currentOccupancy: number
  capacity?: number
  activeSessions: number
  ratePerHour: number
  billingMinutes: number
  maxDailyFee?: number
  gracePeriodMinutes?: number
  currency: string
  paymentMethods: string[]
  operatorWallet: string
}
