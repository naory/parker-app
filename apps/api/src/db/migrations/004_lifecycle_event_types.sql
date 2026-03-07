-- Migration: normalize lifecycle event types to canonical uppercase names

UPDATE policy_events SET event_type = 'POLICY_GRANT_ISSUED' WHERE event_type = 'entryGrantCreated';
UPDATE policy_events SET event_type = 'PAYMENT_DECISION_CREATED' WHERE event_type = 'paymentDecisionCreated';
UPDATE policy_events SET event_type = 'SETTLEMENT_VERIFIED' WHERE event_type = 'settlementVerified';
UPDATE policy_events SET event_type = 'SETTLEMENT_REJECTED' WHERE event_type = 'enforcementFailed';
UPDATE policy_events SET event_type = 'RISK_SIGNAL' WHERE event_type = 'riskSignal';
UPDATE policy_events SET event_type = 'SESSION_STATE_TRANSITION' WHERE event_type = 'sessionStateTransition';

DROP INDEX IF EXISTS idx_policy_events_settlement_tx;
DROP INDEX IF EXISTS idx_policy_events_settlement_decision_rail;

CREATE UNIQUE INDEX idx_policy_events_settlement_tx ON policy_events(tx_hash)
  WHERE event_type = 'SETTLEMENT_VERIFIED' AND tx_hash IS NOT NULL;
CREATE UNIQUE INDEX idx_policy_events_settlement_decision_rail ON policy_events(decision_id, (payload->>'rail'))
  WHERE event_type = 'SETTLEMENT_VERIFIED' AND decision_id IS NOT NULL AND payload ? 'rail';
