-- Migration: simplify session_events to append-only minimal shape
-- Target shape:
--   id UUID PK
--   session_id UUID FK sessions(id)
--   event_type TEXT
--   created_at TIMESTAMPTZ
--   metadata JSONB
-- NOTE:
--   Legacy rows with non-UUID session_id values are intentionally discarded
--   during normalization because the new schema enforces UUID session_id.

DO $$
DECLARE
  discarded_legacy_rows BIGINT := 0;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'session_events'
      AND column_name = 'decision_id'
  ) THEN
    CREATE TABLE session_events_new (
      id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      metadata   JSONB NOT NULL DEFAULT '{}'::jsonb
    );

    SELECT COUNT(*)
      INTO discarded_legacy_rows
    FROM session_events se
    WHERE NOT (
      se.session_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    );

    IF discarded_legacy_rows > 0 THEN
      RAISE NOTICE
        'session_events normalization: discarding % legacy rows with non-UUID session_id',
        discarded_legacy_rows;
    END IF;

    WITH normalized AS (
      SELECT
        CASE
          WHEN se.session_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            THEN se.session_id::uuid
          ELSE NULL
        END AS session_uuid,
        se.event_type,
        se.created_at,
        se.metadata,
        se.decision_id,
        se.tx_hash,
        se.policy_hash,
        se.vehicle_id,
        se.lot_id,
        se.payment_id
      FROM session_events se
    )
    INSERT INTO session_events_new (id, session_id, event_type, created_at, metadata)
    SELECT
      uuid_generate_v4(),
      n.session_uuid,
      n.event_type::text,
      COALESCE(n.created_at, NOW()),
      COALESCE(n.metadata, '{}'::jsonb) ||
      jsonb_strip_nulls(
        jsonb_build_object(
          'decisionId', n.decision_id,
          'txHash', n.tx_hash,
          'policyHash', n.policy_hash,
          'vehicleId', n.vehicle_id,
          'lotId', n.lot_id,
          'paymentId', n.payment_id
        )
      )
    FROM normalized n
    WHERE n.session_uuid IS NOT NULL;

    DROP TABLE session_events;
    ALTER TABLE session_events_new RENAME TO session_events;
  END IF;
END
$$;

DROP INDEX IF EXISTS idx_session_events_session_id;
DROP INDEX IF EXISTS idx_session_events_created_at;
DROP INDEX IF EXISTS idx_session_events_event_type;
DROP INDEX IF EXISTS idx_session_events_session_timeline;

CREATE INDEX IF NOT EXISTS idx_session_events_session_created_at
  ON session_events(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_session_events_type_created_at
  ON session_events(event_type, created_at);
