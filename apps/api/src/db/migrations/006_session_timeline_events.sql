-- Migration: dedicated append-only session timeline events

CREATE TABLE IF NOT EXISTS session_events (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id   UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    event_type   TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata     JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_session_events_session_created_at ON session_events(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_session_events_type_created_at ON session_events(event_type, created_at);
