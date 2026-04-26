-- ============================================================
-- Migration 068: commercial tracking
--
-- PURPOSE:
--   Internal commercial layer to track ForgeStack platform clients,
--   subscriptions, revenue events, and operating expenses.
--   Powers the Commercial dashboard for executives and head office.
--
-- TABLES:
--   commercial_clients         — client records, optionally linked to sites
--   commercial_subscriptions   — recurring plans per client
--   commercial_revenue_events  — payments, refunds, one-off income
--   commercial_expenses        — platform operating costs
--
-- ACCESS:
--   RLS is ENABLED. No anon/auth policies — deny by default.
--   All DML runs via the service_role key (bypasses RLS).
--   Route-level access gated to super_admin / executive / head_office.
-- ============================================================

-- ── clients ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS commercial_clients (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text        NOT NULL,
  contact_name  text,
  contact_email text,
  site_id       uuid        REFERENCES sites(id) ON DELETE SET NULL,
  status        text        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'trial', 'paused', 'churned')),
  onboarded_at  date,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ── subscriptions ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS commercial_subscriptions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid        NOT NULL REFERENCES commercial_clients(id) ON DELETE CASCADE,
  plan_name     text        NOT NULL,
  monthly_fee   numeric(12,2) NOT NULL DEFAULT 0,
  billing_cycle text        NOT NULL DEFAULT 'monthly'
                              CHECK (billing_cycle IN ('monthly', 'annual', 'once_off')),
  status        text        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'paused', 'cancelled')),
  started_at    date        NOT NULL DEFAULT CURRENT_DATE,
  ended_at      date,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ── revenue events ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS commercial_revenue_events (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid        NOT NULL REFERENCES commercial_clients(id) ON DELETE CASCADE,
  amount      numeric(12,2) NOT NULL,
  event_type  text        NOT NULL DEFAULT 'payment'
                CHECK (event_type IN ('payment', 'refund', 'credit', 'setup_fee', 'addon')),
  description text,
  event_date  date        NOT NULL DEFAULT CURRENT_DATE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── expenses ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS commercial_expenses (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  category     text        NOT NULL,
  description  text        NOT NULL,
  amount       numeric(12,2) NOT NULL,
  client_id    uuid        REFERENCES commercial_clients(id) ON DELETE SET NULL,
  expense_date date        NOT NULL DEFAULT CURRENT_DATE,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ── indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_comm_sub_client     ON commercial_subscriptions(client_id);
CREATE INDEX IF NOT EXISTS idx_comm_rev_client     ON commercial_revenue_events(client_id);
CREATE INDEX IF NOT EXISTS idx_comm_rev_date       ON commercial_revenue_events(event_date);
CREATE INDEX IF NOT EXISTS idx_comm_exp_date       ON commercial_expenses(expense_date);
CREATE INDEX IF NOT EXISTS idx_comm_exp_client     ON commercial_expenses(client_id);
CREATE INDEX IF NOT EXISTS idx_comm_clients_status ON commercial_clients(status);

-- ── RLS (service-role only — deny all direct client access) ───────────────────

ALTER TABLE commercial_clients          ENABLE ROW LEVEL SECURITY;
ALTER TABLE commercial_subscriptions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE commercial_revenue_events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE commercial_expenses         ENABLE ROW LEVEL SECURITY;

-- No POLICY statements → all non-service-role access denied by default.
-- Service role bypasses RLS entirely and is used by all API routes.
