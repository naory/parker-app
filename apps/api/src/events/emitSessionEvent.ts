import crypto from 'node:crypto'
import type { Pool } from 'pg'
import type { SessionEventType } from './types'

export async function emitSessionEvent(
  db: Pool,
  params: {
    sessionId: string
    eventType: SessionEventType
    metadata?: Record<string, unknown>
  },
): Promise<void> {
  await db.query(
    `
      INSERT INTO session_events (id, session_id, event_type, metadata)
      VALUES ($1, $2, $3, $4::jsonb)
    `,
    [
      crypto.randomUUID(),
      params.sessionId,
      params.eventType,
      JSON.stringify(params.metadata ?? {}),
    ],
  )
}
