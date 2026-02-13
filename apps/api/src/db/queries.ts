import { pool } from './index'
import type { DriverRecord, SessionRecord, Lot } from '@parker/core'

// ---- Driver Queries ----

interface CreateDriverInput {
  wallet: string
  plateNumber: string
  countryCode: string
  carMake?: string
  carModel?: string
}

async function createDriver(input: CreateDriverInput): Promise<DriverRecord> {
  const { rows } = await pool.query(
    `INSERT INTO drivers (wallet, plate_number, country_code, car_make, car_model)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [input.wallet, input.plateNumber, input.countryCode, input.carMake, input.carModel],
  )
  return mapDriver(rows[0])
}

async function getDriverByPlate(plate: string): Promise<DriverRecord | null> {
  const { rows } = await pool.query(
    `SELECT * FROM drivers WHERE plate_number = $1 AND active = true`,
    [plate],
  )
  return rows[0] ? mapDriver(rows[0]) : null
}

async function updateDriver(
  plate: string,
  updates: Partial<{ carMake: string; carModel: string }>,
): Promise<DriverRecord | null> {
  const { rows } = await pool.query(
    `UPDATE drivers SET car_make = COALESCE($2, car_make), car_model = COALESCE($3, car_model)
     WHERE plate_number = $1 AND active = true
     RETURNING *`,
    [plate, updates.carMake, updates.carModel],
  )
  return rows[0] ? mapDriver(rows[0]) : null
}

async function deactivateDriver(plate: string): Promise<void> {
  await pool.query(`UPDATE drivers SET active = false WHERE plate_number = $1`, [plate])
}

// ---- Session Queries ----

interface CreateSessionInput {
  plateNumber: string
  lotId: string
  tokenId?: number
}

async function createSession(input: CreateSessionInput): Promise<SessionRecord> {
  const { rows } = await pool.query(
    `INSERT INTO sessions (plate_number, lot_id, token_id, entry_time, status)
     VALUES ($1, $2, $3, NOW(), 'active')
     RETURNING *`,
    [input.plateNumber, input.lotId, input.tokenId],
  )
  return mapSession(rows[0])
}

async function getActiveSession(plate: string): Promise<SessionRecord | null> {
  const { rows } = await pool.query(
    `SELECT * FROM sessions WHERE plate_number = $1 AND status = 'active'`,
    [plate],
  )
  return rows[0] ? mapSession(rows[0]) : null
}

async function getActiveSessionsByLot(lotId: string): Promise<SessionRecord[]> {
  const { rows } = await pool.query(
    `SELECT * FROM sessions WHERE lot_id = $1 AND status = 'active' ORDER BY entry_time DESC`,
    [lotId],
  )
  return rows.map(mapSession)
}

async function endSession(plate: string, feeUsdc: number): Promise<SessionRecord | null> {
  const { rows } = await pool.query(
    `UPDATE sessions SET exit_time = NOW(), fee_usdc = $2, status = 'completed'
     WHERE plate_number = $1 AND status = 'active'
     RETURNING *`,
    [plate, feeUsdc],
  )
  return rows[0] ? mapSession(rows[0]) : null
}

async function getSessionHistory(
  plate: string,
  limit: number,
  offset: number,
): Promise<SessionRecord[]> {
  const { rows } = await pool.query(
    `SELECT * FROM sessions WHERE plate_number = $1 ORDER BY entry_time DESC LIMIT $2 OFFSET $3`,
    [plate, limit, offset],
  )
  return rows.map(mapSession)
}

// ---- Lot Queries ----

async function getLot(lotId: string): Promise<Lot | null> {
  const { rows } = await pool.query(`SELECT * FROM lots WHERE id = $1`, [lotId])
  return rows[0] ? mapLot(rows[0]) : null
}

// ---- Row Mappers ----

function mapDriver(row: any): DriverRecord {
  return {
    id: row.id,
    wallet: row.wallet,
    plateNumber: row.plate_number,
    countryCode: row.country_code,
    carMake: row.car_make,
    carModel: row.car_model,
    active: row.active,
    createdAt: row.created_at,
  }
}

function mapSession(row: any): SessionRecord {
  return {
    id: row.id,
    tokenId: row.token_id,
    plateNumber: row.plate_number,
    lotId: row.lot_id,
    entryTime: row.entry_time,
    exitTime: row.exit_time,
    feeUsdc: row.fee_usdc ? parseFloat(row.fee_usdc) : undefined,
    txHash: row.tx_hash,
    status: row.status,
  }
}

function mapLot(row: any): Lot {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    lat: row.lat ? parseFloat(row.lat) : undefined,
    lng: row.lng ? parseFloat(row.lng) : undefined,
    capacity: row.capacity,
    ratePerHour: parseFloat(row.rate_per_hour),
    billingMinutes: row.billing_minutes,
    maxDailyFee: row.max_daily_fee ? parseFloat(row.max_daily_fee) : undefined,
    operatorWallet: row.operator_wallet,
  }
}

export const db = {
  createDriver,
  getDriverByPlate,
  updateDriver,
  deactivateDriver,
  createSession,
  getActiveSession,
  getActiveSessionsByLot,
  endSession,
  getSessionHistory,
  getLot,
}
