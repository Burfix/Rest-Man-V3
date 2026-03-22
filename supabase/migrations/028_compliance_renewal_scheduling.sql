-- ============================================================
-- Compliance Renewal Scheduling
-- Migration: 028_compliance_renewal_scheduling.sql
--
-- Adds columns to compliance_items for tracking proactive
-- renewal bookings (service date, vendor, notes).
-- Updates the CHECK constraint to allow 'scheduled' status.
-- ============================================================

-- ── Drop old check constraint and add updated one ─────────────────────────────
-- The original constraint only allowed: compliant, due_soon, expired, unknown.
-- We need to add: scheduled (plus in_progress, blocked for future use).

alter table compliance_items
  drop constraint if exists compliance_items_status_check;

alter table compliance_items
  add constraint compliance_items_status_check
    check (status in (
      'compliant',
      'scheduled',
      'due_soon',
      'in_progress',
      'expired',
      'blocked',
      'unknown'
    ));

-- ── Add renewal scheduling columns ───────────────────────────────────────────

alter table compliance_items
  add column if not exists scheduled_service_date date,
  add column if not exists scheduled_with         text,
  add column if not exists scheduled_by           text,
  add column if not exists scheduled_at           timestamptz,
  add column if not exists schedule_note          text;

-- ── Index for quick "what's scheduled" lookups ───────────────────────────────

create index if not exists idx_compliance_scheduled
  on compliance_items (scheduled_service_date)
  where scheduled_service_date is not null;
