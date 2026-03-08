-- Migration: enforce xrpl intent decision/policy hash integrity
-- Preflight for non-dev environments:
--   Ensure legacy rows are clean before applying FK/check/trigger:
--   1) orphaned decision_id:
--      SELECT payment_id, decision_id
--      FROM xrpl_payment_intents x
--      WHERE decision_id IS NOT NULL
--        AND NOT EXISTS (
--          SELECT 1 FROM policy_decisions d WHERE d.decision_id = x.decision_id
--        );
--   2) one-sided null pair:
--      SELECT payment_id, decision_id, policy_hash
--      FROM xrpl_payment_intents
--      WHERE (decision_id IS NULL) <> (policy_hash IS NULL);
--   3) mismatched decision/policy hash:
--      SELECT x.payment_id, x.decision_id, x.policy_hash, d.policy_hash AS expected_policy_hash
--      FROM xrpl_payment_intents x
--      JOIN policy_decisions d ON d.decision_id = x.decision_id
--      WHERE x.decision_id IS NOT NULL
--        AND x.policy_hash IS DISTINCT FROM d.policy_hash;

ALTER TABLE xrpl_payment_intents DROP CONSTRAINT IF EXISTS fk_xrpl_intents_decision;
ALTER TABLE xrpl_payment_intents ADD CONSTRAINT fk_xrpl_intents_decision
  FOREIGN KEY (decision_id) REFERENCES policy_decisions(decision_id);

ALTER TABLE xrpl_payment_intents DROP CONSTRAINT IF EXISTS chk_xrpl_intent_decision_policy_pair;
ALTER TABLE xrpl_payment_intents ADD CONSTRAINT chk_xrpl_intent_decision_policy_pair
  CHECK (
    (decision_id IS NULL AND policy_hash IS NULL)
    OR
    (decision_id IS NOT NULL AND policy_hash IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION validate_xrpl_intent_policy_hash()
RETURNS TRIGGER AS $$
DECLARE
  expected_hash VARCHAR(64);
BEGIN
  IF NEW.decision_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT policy_hash INTO expected_hash
  FROM policy_decisions
  WHERE decision_id = NEW.decision_id;

  -- NOTE: Exception message text is matched by app-side normalizer
  -- (apps/api/src/db/queries.ts::normalizeXrplIntentBindingError).
  IF expected_hash IS NULL THEN
    RAISE EXCEPTION 'xrpl intent references unknown decision_id=%', NEW.decision_id;
  END IF;

  IF NEW.policy_hash IS DISTINCT FROM expected_hash THEN
    RAISE EXCEPTION
      'xrpl intent policy_hash mismatch for decision_id=% expected=% actual=%',
      NEW.decision_id, expected_hash, NEW.policy_hash;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_xrpl_intent_policy_hash ON xrpl_payment_intents;
CREATE TRIGGER trg_validate_xrpl_intent_policy_hash
  BEFORE INSERT OR UPDATE ON xrpl_payment_intents
  FOR EACH ROW
  EXECUTE FUNCTION validate_xrpl_intent_policy_hash();
