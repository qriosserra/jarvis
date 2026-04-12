-- 005-latency-two-phase.sql: Allow two-phase latency persistence
-- Parent rows are inserted at operation start (status='running', duration_ms NULL)
-- and finalized on completion. This ensures the parent FK target exists
-- before child operations try to reference it.

-- Allow in-progress rows without a duration
ALTER TABLE operation_latencies ALTER COLUMN duration_ms DROP NOT NULL;

-- Expand status check to include 'running'
ALTER TABLE operation_latencies DROP CONSTRAINT IF EXISTS operation_latencies_status_check;
ALTER TABLE operation_latencies ADD CONSTRAINT operation_latencies_status_check
  CHECK (status IN ('running', 'completed', 'failed'));
