-- 040_micros_sync_resilience.sql
-- Add refresh_token column for cold-start token refresh (avoids slow PKCE flow)
-- Add index on sync_runs for zombie cleanup queries

ALTER TABLE micros_connections
  ADD COLUMN IF NOT EXISTS refresh_token text;

-- Index to efficiently find stale "running" sync runs for zombie cleanup
CREATE INDEX IF NOT EXISTS idx_micros_sync_runs_status_started
  ON micros_sync_runs (status, started_at)
  WHERE status = 'running';
