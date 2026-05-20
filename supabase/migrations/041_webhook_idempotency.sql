-- ============================================================
-- MIGRATION 041: Webhook Idempotency Table
-- Prevents duplicate booking creation when Meta retries webhooks
-- ============================================================

CREATE TABLE IF NOT EXISTS public.processed_webhook_ids (
  message_id  TEXT PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Service role only — internal deduplication table, no user access needed
ALTER TABLE public.processed_webhook_ids ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only" ON public.processed_webhook_ids
  FOR ALL TO service_role USING (true);

-- Auto-cleanup: delete entries older than 10 minutes on every INSERT.
-- Meta's retry window is 5 minutes, so 10 minutes is a safe TTL.
-- (pg_cron is not enabled on this project; trigger is used instead)
CREATE OR REPLACE FUNCTION cleanup_old_webhook_ids()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM public.processed_webhook_ids
  WHERE created_at < now() - interval '10 minutes';
  RETURN NEW;
END;
$$;

CREATE TRIGGER auto_cleanup_webhook_ids
  AFTER INSERT ON public.processed_webhook_ids
  FOR EACH STATEMENT EXECUTE FUNCTION cleanup_old_webhook_ids();
