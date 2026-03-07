-- Migration: dedicated append-only session timeline events

CREATE TABLE IF NOT EXISTS session_events (
    id           BIGSERIAL PRIMARY KEY,
    session_id   VARCHAR(64) NOT NULL,
    event_type   VARCHAR(64) NOT NULL,
    decision_id  VARCHAR(64),
    tx_hash      VARCHAR(128),
    policy_hash  VARCHAR(64),
    vehicle_id   VARCHAR(20),
    lot_id       VARCHAR(50),
    payment_id   UUID,
    metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_events_session_id ON session_events(session_id);
CREATE INDEX IF NOT EXISTS idx_session_events_created_at ON session_events(created_at);
CREATE INDEX IF NOT EXISTS idx_session_events_event_type ON session_events(event_type);
