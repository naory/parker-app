-- Migration: optimize session timeline queries by session+time

CREATE INDEX IF NOT EXISTS idx_session_events_session_created_at
  ON session_events(session_id, created_at);
