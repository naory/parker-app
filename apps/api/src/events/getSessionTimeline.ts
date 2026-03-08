import type { Pool } from 'pg'

export interface SessionTimelineRow {
  id: string
  session_id: string
  event_type: string
  created_at: Date
  metadata: unknown
}

export async function getSessionTimeline(
  db: Pool,
  sessionId: string,
  limit?: number,
): Promise<SessionTimelineRow[]> {
  const hasLimit = Number.isFinite(limit)
  const { rows } = await db.query(
    hasLimit
      ? `
      SELECT id, session_id, event_type, created_at, metadata
      FROM session_events
      WHERE session_id = $1
      ORDER BY created_at ASC, id ASC
      LIMIT $2
    `
      : `
      SELECT id, session_id, event_type, created_at, metadata
      FROM session_events
      WHERE session_id = $1
      ORDER BY created_at ASC, id ASC
    `,
    hasLimit ? [sessionId, limit] : [sessionId],
  )

  return rows as SessionTimelineRow[]
}
