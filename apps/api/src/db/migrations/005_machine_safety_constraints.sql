-- Migration: machine safety constraints
-- - one open session per vehicle+lot
-- - decision/session-grant FK
-- - one consumed settlement event per decision

DROP INDEX IF EXISTS idx_sessions_one_active_per_plate;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_one_open_per_plate_lot
  ON sessions(plate_number, lot_id)
  WHERE status IN ('active', 'payment_required', 'approval_required', 'payment_failed');

ALTER TABLE policy_decisions DROP CONSTRAINT IF EXISTS fk_policy_decisions_session_grant;
ALTER TABLE policy_decisions ADD CONSTRAINT fk_policy_decisions_session_grant
  FOREIGN KEY (session_grant_id) REFERENCES policy_grants(grant_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_policy_events_settlement_decision_once ON policy_events(decision_id)
  WHERE event_type = 'SETTLEMENT_VERIFIED' AND decision_id IS NOT NULL;
