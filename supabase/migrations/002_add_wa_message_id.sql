-- ============================================================
-- Migration: 002_add_wa_message_id.sql
-- Adds wa_message_id to conversation_logs for idempotent
-- webhook processing. WhatsApp retries can deliver the same
-- message more than once; this column allows us to detect and
-- skip already-processed messages without duplicate bookings.
-- ============================================================

alter table conversation_logs
  add column if not exists wa_message_id text;

-- Index for fast dedup lookups
create index if not exists idx_conv_logs_wa_message_id
  on conversation_logs (wa_message_id)
  where wa_message_id is not null;
