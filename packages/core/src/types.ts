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
  ratePerHour: number // USDC
  billingMinutes: number
  maxDailyFee?: number
  operatorWallet: string
}

export interface SessionRecord {
  id: string
  tokenId?: number
  plateNumber: string
  lotId: string
  entryTime: Date
  exitTime?: Date
  feeUsdc?: number
  txHash?: string
  status: 'active' | 'completed' | 'disputed'
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
  currentOccupancy: number
  capacity: number
  activeSessions: number
}
