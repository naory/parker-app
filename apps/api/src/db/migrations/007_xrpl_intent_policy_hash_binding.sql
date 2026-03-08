-- Migration: enforce xrpl intent decision/policy hash integrity

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
