-- ============================================================
-- Si Cantina Sociale — Initial Schema
-- Migration: 001_initial_schema.sql
-- ============================================================

-- Enable pgcrypto for gen_random_uuid()
create extension if not exists "pgcrypto";

-- ============================================================
-- TABLE: reservations
-- ============================================================
create table if not exists reservations (
  id                    uuid primary key default gen_random_uuid(),
  customer_name         text not null,
  phone_number          text not null,
  booking_date          date not null,
  booking_time          text not null,
  guest_count           integer not null,
  event_name            text,
  special_notes         text,
  status                text not null default 'pending',   -- pending | confirmed | cancelled
  service_charge_applies boolean not null default false,
  escalation_required   boolean not null default false,
  source_channel        text not null default 'whatsapp',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Useful indexes on reservations
create index if not exists idx_reservations_phone      on reservations (phone_number);
create index if not exists idx_reservations_date       on reservations (booking_date);
create index if not exists idx_reservations_status     on reservations (status);
create index if not exists idx_reservations_escalation on reservations (escalation_required) where escalation_required = true;

-- Auto-update updated_at
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace trigger trg_reservations_updated_at
  before update on reservations
  for each row execute procedure set_updated_at();

-- ============================================================
-- TABLE: events
-- ============================================================
create table if not exists events (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  event_date        date not null,
  start_time        text,
  end_time          text,
  description       text,
  is_special_event  boolean not null default false,
  booking_enabled   boolean not null default true,
  cancelled         boolean not null default false,   -- manual override to cancel a recurring instance
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_events_date        on events (event_date);
create index if not exists idx_events_name        on events (name);
create unique index if not exists idx_events_name_date on events (name, event_date);

create or replace trigger trg_events_updated_at
  before update on events
  for each row execute procedure set_updated_at();

-- ============================================================
-- TABLE: venue_settings
-- ============================================================
create table if not exists venue_settings (
  id                        uuid primary key default gen_random_uuid(),
  venue_name                text not null,
  max_capacity              integer not null,
  max_table_size            integer not null,
  opening_hours_json        jsonb not null,
  service_charge_threshold  integer not null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create or replace trigger trg_venue_settings_updated_at
  before update on venue_settings
  for each row execute procedure set_updated_at();

-- ============================================================
-- TABLE: conversation_logs
-- ============================================================
create table if not exists conversation_logs (
  id                        uuid primary key default gen_random_uuid(),
  phone_number              text not null,
  user_message              text not null,
  assistant_message         text,
  extracted_intent          text,
  extracted_booking_data_json jsonb,
  escalation_required       boolean not null default false,
  created_at                timestamptz not null default now()
);

create index if not exists idx_conv_logs_phone   on conversation_logs (phone_number);
create index if not exists idx_conv_logs_created on conversation_logs (created_at desc);
create index if not exists idx_conv_logs_escalation on conversation_logs (escalation_required) where escalation_required = true;
