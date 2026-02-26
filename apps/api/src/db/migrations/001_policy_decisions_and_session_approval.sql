-- Migration: policy_decisions table + sessions.approval_required_before_payment
-- Run after schema.sql for existing databases.
-- Strategy: fresh install uses schema.sql only (policy_decisions created there).
--           existing DB uses this migration (CREATE TABLE IF NOT EXISTS).
-- Keep this table definition in sync with schema.sql.

-- Add approval flag to sessions (if not exists)
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS approval_required_before_payment BOOLEAN NOT NULL DEFAULT false;

-- First-class decision records (skip if table exists; definition must match schema.sql)
CREATE TABLE IF NOT EXISTS policy_decisions (
    decision_id       VARCHAR(64) PRIMARY KEY,
    policy_hash       VARCHAR(64) NOT NULL,
    session_grant_id  UUID,
    chosen_rail       VARCHAR(20),
    chosen_asset      JSONB,
    quote_minor       VARCHAR(32) NOT NULL,
    quote_currency    VARCHAR(10) NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at        TIMESTAMPTZ NOT NULL,
    action            VARCHAR(32) NOT NULL,
    reasons           JSONB NOT NULL,
    require_approval  BOOLEAN NOT NULL DEFAULT false,
    payload           JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_policy_decisions_session_grant ON policy_decisions(session_grant_id);
CREATE INDEX IF NOT EXISTS idx_policy_decisions_expires_at ON policy_decisions(expires_at);
