import type { Pool } from 'pg'

export async function getSessionTimeline(db: Pool, sessionId: string) {
  const { rows } = await db.query(
    `
      SELECT id, event_type, created_at, metadata
      FROM session_events
      WHERE session_id = $1
      ORDER BY created_at ASC, id ASC
    `,
    [sessionId],
  )

  return rows
}
