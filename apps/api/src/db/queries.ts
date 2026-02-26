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

async function getDriverByWallet(wallet: string): Promise<DriverRecord | null> {
  const { rows } = await pool.query(
    `SELECT * FROM drivers WHERE LOWER(wallet) = LOWER($1) AND active = true`,
    [wallet],
  )
  return rows[0] ? mapDriver(rows[0]) : null
}

async function deactivateDriver(plate: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE drivers SET active = false WHERE plate_number = $1 AND active = true`,
    [plate],
  )
  return (rowCount ?? 0) > 0
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

interface EndSessionInput {
  feeAmount: number
  feeCurrency: string
  stripePaymentId?: string
}

async function endSession(plate: string, input: EndSessionInput): Promise<SessionRecord | null> {
  const { rows } = await pool.query(
    `UPDATE sessions SET exit_time = NOW(), fee_amount = $2, fee_currency = $3, stripe_payment_id = $4, status = 'completed'
     WHERE plate_number = $1 AND status = 'active'
     RETURNING *`,
    [plate, input.feeAmount, input.feeCurrency, input.stripePaymentId ?? null],
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

// ---- Policy grant (entry-time) ----

interface InsertPolicyGrantInput {
  sessionId: string
  policyHash: string
  allowedRails: unknown
  allowedAssets: unknown
  maxSpend: unknown
  requireApproval: boolean
  reasons: unknown
  expiresAt: Date
}

async function insertPolicyGrant(input: InsertPolicyGrantInput): Promise<{ grantId: string }> {
  const { rows } = await pool.query(
    `INSERT INTO policy_grants (session_id, policy_hash, allowed_rails, allowed_assets, max_spend, require_approval, reasons, expires_at)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6, $7::jsonb, $8)
     RETURNING grant_id`,
    [
      input.sessionId,
      input.policyHash,
      JSON.stringify(input.allowedRails),
      JSON.stringify(input.allowedAssets),
      input.maxSpend != null ? JSON.stringify(input.maxSpend) : null,
      input.requireApproval,
      JSON.stringify(input.reasons),
      input.expiresAt,
    ],
  )
  return { grantId: rows[0].grant_id }
}

async function updateSessionPolicyGrant(
  sessionId: string,
  policyGrantId: string,
  policyHash: string,
  approvalRequiredBeforePayment = false,
): Promise<void> {
  await pool.query(
    `UPDATE sessions SET policy_grant_id = $2, policy_hash = $3, approval_required_before_payment = $4 WHERE id = $1`,
    [sessionId, policyGrantId, policyHash, approvalRequiredBeforePayment],
  )
}

async function getPolicyGrantExpiresAt(grantId: string): Promise<Date | null> {
  const { rows } = await pool.query(
    `SELECT expires_at FROM policy_grants WHERE grant_id = $1`,
    [grantId],
  )
  return rows[0]?.expires_at ?? null
}

/** Full grant record (canonical shape persisted at entry). */
export interface PolicyGrantRecord {
  grantId: string
  policyHash: string
  allowedRails: string[]
  allowedAssets: unknown[]
  maxSpend: { perTxMinor?: string; perSessionMinor?: string; perDayMinor?: string } | null
  expiresAt: Date
  requireApproval: boolean
  reasons: string[]
}

async function getPolicyGrantByGrantId(grantId: string): Promise<PolicyGrantRecord | null> {
  const { rows } = await pool.query(
    `SELECT grant_id, policy_hash, allowed_rails, allowed_assets, max_spend, require_approval, reasons, expires_at
     FROM policy_grants WHERE grant_id = $1`,
    [grantId],
  )
  if (!rows[0]) return null
  const r = rows[0]
  return {
    grantId: r.grant_id,
    policyHash: r.policy_hash,
    allowedRails: Array.isArray(r.allowed_rails) ? r.allowed_rails : JSON.parse(r.allowed_rails || '[]'),
    allowedAssets: Array.isArray(r.allowed_assets) ? r.allowed_assets : JSON.parse(r.allowed_assets || '[]'),
    maxSpend: r.max_spend == null ? null : (typeof r.max_spend === 'object' ? r.max_spend : JSON.parse(r.max_spend)),
    expiresAt: r.expires_at,
    requireApproval: r.require_approval === true,
    reasons: Array.isArray(r.reasons) ? r.reasons : JSON.parse(r.reasons || '[]'),
  }
}

/**
 * Spend totals in fiat (lot currency) for cap comparison.
 * Returns decimal amounts; caller converts to fiat minor for policy (same unit as capPerTxMinor etc).
 * Matches cap units: caps are fiat minor in lot currency; we compare apples-to-apples.
 * sessionTotalFiat: 0 for now (no partial payments).
 */
async function getFiatSpendTotalsByCurrency(
  plate: string,
  currency: string,
): Promise<{ dayTotalFiat: number; sessionTotalFiat: number }> {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(fee_amount), 0) AS day_total
     FROM sessions
     WHERE plate_number = $1 AND status = 'completed' AND fee_currency = $2
       AND exit_time >= date_trunc('day', NOW())`,
    [plate, currency],
  )
  const dayTotalFiat = Number(rows[0]?.day_total ?? 0)
  return { dayTotalFiat, sessionTotalFiat: 0 }
}

/** @deprecated Prefer getFiatSpendTotalsByCurrency; kept for compatibility. */
const getSpendTotalsFiat = getFiatSpendTotalsByCurrency

// ---- Policy events (audit + decision lookup for enforcement) ----

export interface InsertPolicyEventInput {
  eventType: string
  payload: unknown
  paymentId?: string
  sessionId?: string
  decisionId?: string
  txHash?: string
}

async function insertPolicyEvent(input: InsertPolicyEventInput): Promise<void> {
  await pool.query(
    `INSERT INTO policy_events (event_type, payload, payment_id, session_id, decision_id, tx_hash)
     VALUES ($1, $2::jsonb, $3::uuid, $4, $5, $6)`,
    [
      input.eventType,
      JSON.stringify(input.payload),
      input.paymentId ?? null,
      input.sessionId ?? null,
      input.decisionId ?? null,
      input.txHash ?? null,
    ],
  )
}

/** Insert first-class decision record (exit-time policy outcome). */
export interface InsertPolicyDecisionInput {
  decisionId: string
  policyHash: string
  sessionGrantId: string | null
  chosenRail: string | null
  chosenAsset: unknown
  quoteMinor: string
  quoteCurrency: string
  expiresAt: Date
  action: string
  reasons: unknown
  requireApproval: boolean
  payload: unknown
}

/** Insert decision; JSONB columns receive serialized JSON and ::jsonb cast stores native JSONB (not text). */
async function insertPolicyDecision(input: InsertPolicyDecisionInput): Promise<void> {
  const chosenAssetJson =
    input.chosenAsset != null ? JSON.stringify(input.chosenAsset) : null
  const reasonsJson = JSON.stringify(input.reasons)
  const payloadJson = JSON.stringify(input.payload)
  await pool.query(
    `INSERT INTO policy_decisions (decision_id, policy_hash, session_grant_id, chosen_rail, chosen_asset, quote_minor, quote_currency, expires_at, action, reasons, require_approval, payload)
     VALUES ($1, $2, $3::uuid, $4, $5::jsonb, $6, $7, $8, $9, $10::jsonb, $11, $12::jsonb)`,
    [
      input.decisionId,
      input.policyHash,
      input.sessionGrantId,
      input.chosenRail,
      chosenAssetJson,
      input.quoteMinor,
      input.quoteCurrency,
      input.expiresAt,
      input.action,
      reasonsJson,
      input.requireApproval,
      payloadJson,
    ],
  )
}

/** Get payment decision payload by decision_id (policy_decisions first, then events fallback). */
async function getDecisionPayloadByDecisionId(
  decisionId: string,
): Promise<unknown | null> {
  const { rows: decisionRows } = await pool.query(
    `SELECT payload FROM policy_decisions WHERE decision_id = $1`,
    [decisionId],
  )
  if (decisionRows[0]?.payload) return decisionRows[0].payload
  const { rows: eventRows } = await pool.query(
    `SELECT payload FROM policy_events
     WHERE event_type = 'paymentDecisionCreated' AND decision_id = $1
     ORDER BY created_at DESC LIMIT 1`,
    [decisionId],
  )
  return eventRows[0]?.payload ?? null
}

/** Replay protection: already settled with this tx_hash? */
async function hasSettlementForTxHash(txHash: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM policy_events
     WHERE event_type = 'settlementVerified' AND tx_hash = $1 LIMIT 1`,
    [txHash],
  )
  return rows.length > 0
}

/** One-time settlement guard: decision_id + rail must be unique for settlementVerified. */
async function hasSettlementForDecisionRail(decisionId: string, rail: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM policy_events
     WHERE event_type = 'settlementVerified'
       AND decision_id = $1
       AND payload->>'rail' = $2
     LIMIT 1`,
    [decisionId, rail],
  )
  return rows.length > 0
}

/** Median fee (completed sessions) for a lot — for amount-anomaly risk signal. */
async function getMedianFeeForLot(lotId: string): Promise<number | null> {
  const { rows } = await pool.query<{ median: string | number | null }>(
    `SELECT (PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY fee_amount))::float AS median
     FROM sessions WHERE lot_id = $1 AND status = 'completed' AND fee_amount IS NOT NULL`,
    [lotId],
  )
  const val = rows[0]?.median
  if (val == null) return null
  const n = typeof val === 'number' ? val : parseFloat(String(val))
  return Number.isFinite(n) ? n : null
}

// ---- Lot Queries ----

async function getLot(lotId: string): Promise<Lot | null> {
  const { rows } = await pool.query(`SELECT * FROM lots WHERE id = $1`, [lotId])
  return rows[0] ? mapLot(rows[0]) : null
}

interface UpdateLotInput {
  name?: string
  address?: string
  capacity?: number
  ratePerHour?: number
  billingMinutes?: number
  maxDailyFee?: number | null
  gracePeriodMinutes?: number
  currency?: string
  paymentMethods?: string[]
}

async function updateLot(lotId: string, updates: UpdateLotInput): Promise<Lot | null> {
  const { rows } = await pool.query(
    `UPDATE lots SET
      name = COALESCE($2, name),
      address = COALESCE($3, address),
      capacity = COALESCE($4, capacity),
      rate_per_hour = COALESCE($5, rate_per_hour),
      billing_minutes = COALESCE($6, billing_minutes),
      max_daily_fee = COALESCE($7, max_daily_fee),
      grace_period_minutes = COALESCE($8, grace_period_minutes),
      currency = COALESCE($9, currency),
      payment_methods = COALESCE($10, payment_methods)
     WHERE id = $1
     RETURNING *`,
    [
      lotId,
      updates.name,
      updates.address,
      updates.capacity,
      updates.ratePerHour,
      updates.billingMinutes,
      updates.maxDailyFee,
      updates.gracePeriodMinutes,
      updates.currency,
      updates.paymentMethods,
    ],
  )
  return rows[0] ? mapLot(rows[0]) : null
}

// ---- Idempotency Queries ----

interface BeginIdempotencyInput {
  endpoint: string
  idempotencyKey: string
  requestHash: string
}

type BeginIdempotencyResult =
  | { status: 'started' }
  | { status: 'replay'; responseCode: number; responseBody: unknown }
  | { status: 'in_progress' }
  | { status: 'conflict' }

async function beginIdempotency(input: BeginIdempotencyInput): Promise<BeginIdempotencyResult> {
  const insert = await pool.query(
    `INSERT INTO idempotency_keys (endpoint, idempotency_key, request_hash, status)
     VALUES ($1, $2, $3, 'pending')
     ON CONFLICT DO NOTHING
     RETURNING endpoint`,
    [input.endpoint, input.idempotencyKey, input.requestHash],
  )

  if (insert.rowCount && insert.rowCount > 0) {
    return { status: 'started' }
  }

  const { rows } = await pool.query(
    `SELECT request_hash, status, response_code, response_body
     FROM idempotency_keys
     WHERE endpoint = $1 AND idempotency_key = $2`,
    [input.endpoint, input.idempotencyKey],
  )

  const row = rows[0]
  if (!row) {
    // Very unlikely race (deleted between insert/select) — allow processing.
    return { status: 'started' }
  }

  if (row.request_hash !== input.requestHash) {
    return { status: 'conflict' }
  }

  if (row.status === 'completed') {
    return {
      status: 'replay',
      responseCode: row.response_code ?? 200,
      responseBody: row.response_body ?? {},
    }
  }

  return { status: 'in_progress' }
}

interface CompleteIdempotencyInput {
  endpoint: string
  idempotencyKey: string
  responseCode: number
  responseBody: unknown
}

async function completeIdempotency(input: CompleteIdempotencyInput): Promise<void> {
  await pool.query(
    `UPDATE idempotency_keys
     SET status = 'completed',
         response_code = $3,
         response_body = $4::jsonb,
         completed_at = NOW()
     WHERE endpoint = $1 AND idempotency_key = $2`,
    [
      input.endpoint,
      input.idempotencyKey,
      input.responseCode,
      JSON.stringify(input.responseBody ?? {}),
    ],
  )
}

// ---- XRPL Intent Queries ----

export interface XrplPaymentIntentRecord {
  paymentId: string
  plateNumber: string
  lotId: string
  sessionId: string
  amount: string
  destination: string
  token: string
  network: string
  status: 'pending' | 'resolved' | 'expired' | 'cancelled'
  expiresAt: Date
  decisionId?: string
  policyHash?: string
  rail?: string
  asset?: unknown
  xamanPayloadUuid?: string
  xamanDeepLink?: string
  xamanQrPng?: string
  txHash?: string
}

interface UpsertXrplPendingIntentInput {
  plateNumber: string
  lotId: string
  sessionId: string
  amount: string
  destination: string
  token: string
  network: string
  expiresAt: Date
  decisionId?: string
  policyHash?: string
  rail?: string
  asset?: unknown
}

async function upsertXrplPendingIntent(
  input: UpsertXrplPendingIntentInput,
): Promise<XrplPaymentIntentRecord> {
  const { rows } = await pool.query(
    `INSERT INTO xrpl_payment_intents (
        plate_number, lot_id, session_id, amount, destination, token, network,
        decision_id, policy_hash, rail, asset, status, expires_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending', $12, NOW())
      ON CONFLICT (plate_number, lot_id) WHERE status = 'pending'
      DO UPDATE SET
        session_id = EXCLUDED.session_id,
        amount = EXCLUDED.amount,
        destination = EXCLUDED.destination,
        token = EXCLUDED.token,
        network = EXCLUDED.network,
        decision_id = EXCLUDED.decision_id,
        policy_hash = EXCLUDED.policy_hash,
        rail = EXCLUDED.rail,
        asset = EXCLUDED.asset,
        expires_at = EXCLUDED.expires_at,
        xaman_payload_uuid = NULL,
        xaman_deep_link = NULL,
        xaman_qr_png = NULL,
        tx_hash = NULL,
        updated_at = NOW()
      RETURNING *`,
    [
      input.plateNumber,
      input.lotId,
      input.sessionId,
      input.amount,
      input.destination,
      input.token,
      input.network,
      input.decisionId ?? null,
      input.policyHash ?? null,
      input.rail ?? null,
      input.asset != null ? JSON.stringify(input.asset) : null,
      input.expiresAt,
    ],
  )

  return mapXrplIntent(rows[0])
}

async function getActiveXrplPendingIntent(
  plateNumber: string,
  lotId: string,
): Promise<XrplPaymentIntentRecord | null> {
  const { rows } = await pool.query(
    `SELECT *
     FROM xrpl_payment_intents
     WHERE plate_number = $1
       AND lot_id = $2
       AND status = 'pending'
       AND expires_at > NOW()
     ORDER BY updated_at DESC
     LIMIT 1`,
    [plateNumber, lotId],
  )

  return rows[0] ? mapXrplIntent(rows[0]) : null
}

async function attachXamanPayloadToIntent(input: {
  paymentId: string
  payloadUuid: string
  deepLink?: string
  qrPng?: string
}): Promise<void> {
  await pool.query(
    `UPDATE xrpl_payment_intents
     SET xaman_payload_uuid = $2::uuid,
         xaman_deep_link = $3,
         xaman_qr_png = $4,
         updated_at = NOW()
     WHERE payment_id = $1::uuid`,
    [input.paymentId, input.payloadUuid, input.deepLink ?? null, input.qrPng ?? null],
  )
}

async function resolveXrplIntentByPayloadUuid(input: {
  payloadUuid: string
  txHash?: string
}): Promise<void> {
  await pool.query(
    `UPDATE xrpl_payment_intents
     SET status = 'resolved',
         tx_hash = COALESCE($2, tx_hash),
         updated_at = NOW()
     WHERE xaman_payload_uuid = $1::uuid
       AND status = 'pending'`,
    [input.payloadUuid, input.txHash ?? null],
  )
}

async function cancelXrplIntentByPayloadUuid(payloadUuid: string): Promise<void> {
  await pool.query(
    `UPDATE xrpl_payment_intents
     SET status = 'cancelled',
         updated_at = NOW()
     WHERE xaman_payload_uuid = $1::uuid
       AND status = 'pending'`,
    [payloadUuid],
  )
}

async function resolveActiveXrplIntentByPlateLot(input: {
  plateNumber: string
  lotId: string
  txHash?: string
}): Promise<void> {
  await pool.query(
    `UPDATE xrpl_payment_intents
     SET status = 'resolved',
         tx_hash = COALESCE($3, tx_hash),
         updated_at = NOW()
     WHERE plate_number = $1
       AND lot_id = $2
       AND status = 'pending'`,
    [input.plateNumber, input.lotId, input.txHash ?? null],
  )
}

async function resolveXrplIntentByPaymentId(input: {
  paymentId: string
  txHash?: string
}): Promise<boolean> {
  const result = await pool.query(
    `UPDATE xrpl_payment_intents
     SET status = 'resolved',
         tx_hash = COALESCE($2, tx_hash),
         updated_at = NOW()
     WHERE payment_id = $1::uuid
       AND status = 'pending'`,
    [input.paymentId, input.txHash ?? null],
  )
  return (result.rowCount ?? 0) > 0
}

async function getXrplIntentByTxHash(txHash: string): Promise<XrplPaymentIntentRecord | null> {
  const { rows } = await pool.query(
    `SELECT *
     FROM xrpl_payment_intents
     WHERE tx_hash = $1
     ORDER BY updated_at DESC
     LIMIT 1`,
    [txHash],
  )
  return rows[0] ? mapXrplIntent(rows[0]) : null
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
    feeAmount: row.fee_amount ? parseFloat(row.fee_amount) : undefined,
    feeCurrency: row.fee_currency ?? undefined,
    stripePaymentId: row.stripe_payment_id ?? undefined,
    txHash: row.tx_hash,
    status: row.status,
    policyGrantId: row.policy_grant_id ?? undefined,
    policyHash: row.policy_hash ?? undefined,
    approvalRequiredBeforePayment: row.approval_required_before_payment === true,
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
    gracePeriodMinutes: row.grace_period_minutes != null ? parseFloat(row.grace_period_minutes) : 0,
    currency: row.currency,
    paymentMethods: row.payment_methods ?? ['stripe', 'x402'],
    operatorWallet: row.operator_wallet,
  }
}

function mapXrplIntent(row: any): XrplPaymentIntentRecord {
  return {
    paymentId: row.payment_id,
    plateNumber: row.plate_number,
    lotId: row.lot_id,
    sessionId: row.session_id,
    amount: typeof row.amount === 'string' ? row.amount : String(row.amount),
    destination: row.destination,
    token: row.token,
    network: row.network,
    status: row.status,
    expiresAt: row.expires_at,
    decisionId: row.decision_id ?? undefined,
    policyHash: row.policy_hash ?? undefined,
    rail: row.rail ?? undefined,
    asset: row.asset ?? undefined,
    xamanPayloadUuid: row.xaman_payload_uuid ?? undefined,
    xamanDeepLink: row.xaman_deep_link ?? undefined,
    xamanQrPng: row.xaman_qr_png ?? undefined,
    txHash: row.tx_hash ?? undefined,
  }
}

export const db = {
  createDriver,
  getDriverByPlate,
  getDriverByWallet,
  updateDriver,
  deactivateDriver,
  createSession,
  getActiveSession,
  getActiveSessionsByLot,
  endSession,
  getSessionHistory,
  insertPolicyGrant,
  updateSessionPolicyGrant,
  getPolicyGrantExpiresAt,
  getPolicyGrantByGrantId,
  getFiatSpendTotalsByCurrency,
  getSpendTotalsFiat,
  insertPolicyEvent,
  insertPolicyDecision,
  getDecisionPayloadByDecisionId,
  hasSettlementForTxHash,
  hasSettlementForDecisionRail,
  getMedianFeeForLot,
  getLot,
  updateLot,
  beginIdempotency,
  completeIdempotency,
  upsertXrplPendingIntent,
  getActiveXrplPendingIntent,
  attachXamanPayloadToIntent,
  resolveXrplIntentByPayloadUuid,
  cancelXrplIntentByPayloadUuid,
  resolveActiveXrplIntentByPlateLot,
  resolveXrplIntentByPaymentId,
  getXrplIntentByTxHash,
}
