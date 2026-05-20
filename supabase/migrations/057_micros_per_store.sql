-- 057 — Per-store MICROS connections
-- Adds site_id FK to micros_connections so each store can have its own credentials.
-- Also adds username/password columns (encrypted via Supabase Vault in app layer).

-- 1. Add site_id column (nullable for backward compat with existing env-var row)
ALTER TABLE micros_connections
  ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES sites(id);

-- 2. Add username column for per-store auth (PKCE flow needs username + password)
ALTER TABLE micros_connections
  ADD COLUMN IF NOT EXISTS username TEXT NOT NULL DEFAULT '';

-- 3. Add encrypted_password column (app encrypts before writing)
ALTER TABLE micros_connections
  ADD COLUMN IF NOT EXISTS encrypted_password TEXT NOT NULL DEFAULT '';

-- 4. Unique constraint: one connection per site
CREATE UNIQUE INDEX IF NOT EXISTS micros_connections_site_id_unique
  ON micros_connections (site_id)
  WHERE site_id IS NOT NULL;

-- 5. Index for site_id lookups
CREATE INDEX IF NOT EXISTS idx_micros_connections_site_id
  ON micros_connections (site_id)
  WHERE site_id IS NOT NULL;
