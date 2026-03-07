-- Migration: explicit decision state machine with single-consumption guard

ALTER TABLE policy_decisions
  ADD COLUMN IF NOT EXISTS decision_state VARCHAR(16) NOT NULL DEFAULT 'created';

ALTER TABLE policy_decisions
  DROP CONSTRAINT IF EXISTS chk_policy_decision_state;

ALTER TABLE policy_decisions
  ADD CONSTRAINT chk_policy_decision_state
  CHECK (decision_state IN ('created', 'approved', 'consumed', 'expired', 'rejected'));

-- Backfill already-settled decisions as consumed.
UPDATE policy_decisions d
SET decision_state = 'consumed'
WHERE EXISTS (
  SELECT 1
  FROM policy_events e
  WHERE e.event_type IN ('settlementVerified', 'SETTLEMENT_VERIFIED')
    AND e.decision_id = d.decision_id
);
