-- ============================================================================
-- Migration 114: DB-Level Zombie Sync Run Cleanup Function
-- ============================================================================
--
-- CONTEXT:
--   MicrosSyncService.ts has a 5-min zombie threshold but it only fires when
--   the NEXT sync is triggered for that connection. If a nightly sync hangs
--   (e.g. Vercel function timeout), it stays in status='running' until the
--   following day's nightly cron starts the cleanup — a 12-24h window.
--
-- FIX:
--   Introduce cleanup_zombie_sync_runs(p_timeout_minutes int) — a DB function
--   that can be called from a dedicated hourly cron endpoint. This provides
--   a safety net independent of the per-connection application-level cleanup.
--
-- DOES NOT:
--   - Touch micros_connections (credentials, tokens, config) ✗
--   - Modify the MicrosSyncService zombie logic ✗
--   - Change any sync architecture ✗
--   Only marks stuck micros_sync_runs records as 'error'.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cleanup_zombie_sync_runs(
  p_timeout_minutes integer DEFAULT 60
)
RETURNS TABLE (
  cleaned_count   integer,
  connection_ids  uuid[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_cutoff       timestamptz;
  v_count        integer;
  v_connections  uuid[];
BEGIN
  v_cutoff := now() - (p_timeout_minutes || ' minutes')::interval;

  -- Collect affected connection IDs for logging
  SELECT ARRAY_AGG(DISTINCT msr.connection_id)
  INTO   v_connections
  FROM   public.micros_sync_runs msr
  WHERE  msr.status      = 'running'
    AND  msr.started_at  < v_cutoff;

  -- Mark zombie runs as error
  UPDATE public.micros_sync_runs
  SET
    status        = 'error',
    completed_at  = now(),
    error_message = format(
      'Sync run timed out after %s minutes (DB zombie cleanup)',
      p_timeout_minutes
    )
  WHERE status     = 'running'
    AND started_at < v_cutoff;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN QUERY SELECT v_count, COALESCE(v_connections, ARRAY[]::uuid[]);
END;
$$;

-- Only service_role should call this (cron routes use service key)
REVOKE ALL ON FUNCTION public.cleanup_zombie_sync_runs(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_zombie_sync_runs(integer) TO service_role;

COMMENT ON FUNCTION public.cleanup_zombie_sync_runs IS
  'Marks micros_sync_runs stuck in running status past p_timeout_minutes as error. '
  'Called by /api/cron/zombie-sync-cleanup hourly. Does not touch micros_connections.';
