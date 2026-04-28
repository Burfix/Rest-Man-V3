-- ============================================================
-- Migration 069: Compliance Engine
--
-- Merges the ForgeStack Compliance Engine data layer into the
-- Ops Engine database. Adds a full tenant-scoped compliance
-- module: enums, tables, views, and seed admin.
--
-- RULES:
--   - Does NOT drop or alter any existing tables
--   - All new objects are namespaced (compliance_* / tenants / certificate_*)
--   - UUIDs throughout
--   - RLS ENABLED on all new tables — deny by default
--   - Service role bypasses RLS
-- ============================================================

-- ── Enums ─────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE compliance_role AS ENUM (
    'SUPER_ADMIN',
    'EXECUTIVE',
    'OFFICER',
    'TENANT'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE certificate_status AS ENUM (
    'APPROVED',
    'AWAITING_REVIEW',
    'REJECTED',
    'EXPIRED',
    'MISSING'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Tenants ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tenants (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL,
  precinct   TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenants_precinct
  ON tenants (precinct)
  WHERE precinct IS NOT NULL;

-- ── Compliance Users ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS compliance_users (
  id         UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
  username   TEXT             UNIQUE NOT NULL,
  email      TEXT,
  role       compliance_role  NOT NULL DEFAULT 'TENANT',
  tenant_id  UUID             REFERENCES tenants(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ      NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ      NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_compliance_users_role
  ON compliance_users (role);

CREATE INDEX IF NOT EXISTS idx_compliance_users_tenant
  ON compliance_users (tenant_id)
  WHERE tenant_id IS NOT NULL;

-- ── Certificate Types ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS certificate_types (
  id       UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  name     TEXT    NOT NULL,
  required BOOLEAN NOT NULL DEFAULT true
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_certificate_types_name
  ON certificate_types (name);

-- ── Certificates ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS certificates (
  id                  UUID               PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID               NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  certificate_type_id UUID               REFERENCES certificate_types(id) ON DELETE SET NULL,
  file_url            TEXT,
  status              certificate_status NOT NULL DEFAULT 'MISSING',
  expiry_date         DATE,
  uploaded_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ        NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ        NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_certificates_tenant
  ON certificates (tenant_id);

CREATE INDEX IF NOT EXISTS idx_certificates_status
  ON certificates (status);

CREATE INDEX IF NOT EXISTS idx_certificates_expiry
  ON certificates (expiry_date)
  WHERE expiry_date IS NOT NULL;

-- ── Certificate Reviews ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS certificate_reviews (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  certificate_id UUID        NOT NULL REFERENCES certificates(id) ON DELETE CASCADE,
  reviewer_id    UUID        REFERENCES compliance_users(id) ON DELETE SET NULL,
  action         TEXT,
  comment        TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_certificate_reviews_certificate
  ON certificate_reviews (certificate_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_certificate_reviews_reviewer
  ON certificate_reviews (reviewer_id)
  WHERE reviewer_id IS NOT NULL;

-- ── Compliance Audit Log ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS compliance_audit_log (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        REFERENCES compliance_users(id) ON DELETE SET NULL,
  tenant_id  UUID        REFERENCES tenants(id) ON DELETE SET NULL,
  action     TEXT        NOT NULL,
  metadata   JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_compliance_audit_log_tenant
  ON compliance_audit_log (tenant_id, created_at DESC)
  WHERE tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_compliance_audit_log_user
  ON compliance_audit_log (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_compliance_audit_log_created
  ON compliance_audit_log (created_at DESC);

-- ── Auto-update updated_at triggers ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION compliance_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_compliance_users_updated_at ON compliance_users;
CREATE TRIGGER trg_compliance_users_updated_at
  BEFORE UPDATE ON compliance_users
  FOR EACH ROW EXECUTE FUNCTION compliance_set_updated_at();

DROP TRIGGER IF EXISTS trg_certificates_updated_at ON certificates;
CREATE TRIGGER trg_certificates_updated_at
  BEFORE UPDATE ON certificates
  FOR EACH ROW EXECUTE FUNCTION compliance_set_updated_at();

-- ── Risk View ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW v_compliance_risk AS
SELECT
  t.id                AS tenant_id,
  t.name              AS tenant,
  t.precinct,
  ct.name             AS certificate_type,
  c.id                AS certificate_id,
  c.status,
  c.expiry_date,
  CASE
    WHEN c.status = 'EXPIRED'  THEN 'CRITICAL'
    WHEN c.status = 'MISSING'  THEN 'CRITICAL'
    WHEN c.status = 'REJECTED' THEN 'WARNING'
    WHEN c.expiry_date IS NOT NULL
         AND c.expiry_date < (now() + INTERVAL '30 days') THEN 'WARNING'
    ELSE 'INFO'
  END                 AS risk_level
FROM certificates c
JOIN tenants t        ON t.id = c.tenant_id
LEFT JOIN certificate_types ct ON ct.id = c.certificate_type_id;

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE tenants               ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_users      ENABLE ROW LEVEL SECURITY;
ALTER TABLE certificate_types     ENABLE ROW LEVEL SECURITY;
ALTER TABLE certificates          ENABLE ROW LEVEL SECURITY;
ALTER TABLE certificate_reviews   ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_audit_log  ENABLE ROW LEVEL SECURITY;

-- Deny all by default — service role bypasses RLS.
-- Application-level policies should be added per-role as needed.

-- ── Seed: admin user ──────────────────────────────────────────────────────────

INSERT INTO compliance_users (username, email, role)
VALUES ('burfix@gmail.com', 'burfix@gmail.com', 'SUPER_ADMIN')
ON CONFLICT (username)
DO UPDATE SET role = 'SUPER_ADMIN';

-- ── Seed: standard certificate types ─────────────────────────────────────────

INSERT INTO certificate_types (name, required) VALUES
  ('Health & Safety Certificate',       true),
  ('Fire Safety Certificate',           true),
  ('Liquor Licence',                    true),
  ('Food Handler Certificate',          true),
  ('Pest Control Certificate',          true),
  ('Municipal Trading Licence',         true),
  ('Equipment Service Certificate',     false),
  ('Public Liability Insurance',        true)
ON CONFLICT (name) DO NOTHING;
