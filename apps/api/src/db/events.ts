import { pool } from './index'

export interface SessionEventCorrelation {
  paymentId?: string
  decisionId?: string
  txHash?: string
  policyHash?: string
  vehicleId?: string
  lotId?: string
}

export async function emitSessionEvent(
  sessionId: string,
  eventType: string,
  metadata: Record<string, unknown> = {},
  correlation: SessionEventCorrelation = {},
): Promise<void> {
  await pool.query(
    `INSERT INTO session_events
      (session_id, event_type, decision_id, tx_hash, policy_hash, vehicle_id, lot_id, payment_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::uuid, $9::jsonb)`,
    [
      sessionId,
      eventType,
      correlation.decisionId ?? null,
      correlation.txHash ?? null,
      correlation.policyHash ?? null,
      correlation.vehicleId ?? null,
      correlation.lotId ?? null,
      correlation.paymentId ?? null,
      JSON.stringify(metadata ?? {}),
    ],
  )
}
