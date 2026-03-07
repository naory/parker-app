-- Migration: upgrade sessions.status to explicit state-machine states
-- Maps legacy values:
--   completed -> closed
--   cancelled -> denied

ALTER TABLE sessions DROP CONSTRAINT IF EXISTS chk_session_status;

UPDATE sessions SET status = 'closed' WHERE status = 'completed';
UPDATE sessions SET status = 'denied' WHERE status = 'cancelled';

ALTER TABLE sessions ADD CONSTRAINT chk_session_status
  CHECK (
    status IN (
      'pending_entry',
      'active',
      'payment_required',
      'approval_required',
      'payment_verified',
      'payment_failed',
      'closed',
      'denied'
    )
  );
