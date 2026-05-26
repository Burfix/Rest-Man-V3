-- ============================================================
-- Migration 101: Micros Location Registry Table
-- ============================================================
--
-- Replaces the hardcoded TypeScript union type (LocationKey) with a
-- database-driven registry. Adding a new client integration now requires:
--   1. INSERT a row into this table (or use the admin UI)
--   2. Add env vars to Vercel using the location's env_prefix
--   No code changes. No recompile. No deployment.
--
-- Field semantics:
--   location_key          — stable string identifier (was TypeScript union)
--   display_name          — human-readable name for UIs and logs
--   auth_flow             — 'pkce' | 'client_credentials'
--   env_prefix            — prefix for environment variable names
--                           e.g. "MICROS_" → reads MICROS_USERNAME, MICROS_PASSWORD
--                           e.g. "MICROS_PRIMI_CAMPS_BAY_" → reads MICROS_PRIMI_CAMPS_BAY_USERNAME
--   location_ref          — Oracle MICROS locRef for the store.
--                           Stored here when multiple locations share an env_prefix
--                           (e.g. Si Cantina + Sea Castle both use MICROS_* credentials).
--                           NULL = read from env var {prefix}LOCATION_REF.
--   site_id               — links to the ForgeStack site record (nullable during migration)
--   enabled               — master kill-switch for sync operations
--
-- Credential resolution (code-side):
--   username    = env[{prefix}USERNAME]      or env[{prefix}API_ACCOUNT_NAME]
--   password    = env[{prefix}PASSWORD]      or env[{prefix}API_ACCOUNT_PASSWORD]
--   clientSecret= env[{prefix}CLIENT_SECRET] (client_credentials flow only)
--   authUrl     = env[{prefix}AUTH_URL]      or env[{prefix}AUTH_SERVER]
--   baseUrl     = env[{prefix}BI_SERVER]     or env[{prefix}APP_SERVER]
--   clientId    = env[{prefix}CLIENT_ID]
--   enterprise  = env[{prefix}ORG_SHORT_NAME]or env[{prefix}ORG_IDENTIFIER]
--   locRef      = location_ref (DB)          or env[{prefix}LOCATION_REF]
-- ============================================================

CREATE TABLE IF NOT EXISTS micros_location_configs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  location_key  text        NOT NULL UNIQUE,
  display_name  text        NOT NULL,
  auth_flow     text        NOT NULL CHECK (auth_flow IN ('pkce', 'client_credentials')),
  env_prefix    text        NOT NULL,
  location_ref  text,       -- NULL = read from env var {prefix}LOCATION_REF
  site_id       uuid        REFERENCES sites(id) ON DELETE SET NULL,
  enabled       boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_micros_loc_configs_key
  ON micros_location_configs (location_key);

CREATE INDEX IF NOT EXISTS idx_micros_loc_configs_site
  ON micros_location_configs (site_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- Non-secret config: backend needs full access, authenticated users can read
-- (location_key, display_name, auth_flow are not sensitive).

ALTER TABLE micros_location_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "srole_micros_loc_configs" ON micros_location_configs;
CREATE POLICY "srole_micros_loc_configs" ON micros_location_configs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth_read_micros_loc_configs" ON micros_location_configs;
CREATE POLICY "auth_read_micros_loc_configs" ON micros_location_configs
  FOR SELECT TO authenticated USING (true);

-- Only super_admin / head_office can mutate the registry.
DROP POLICY IF EXISTS "admin_write_micros_loc_configs" ON micros_location_configs;
CREATE POLICY "admin_write_micros_loc_configs" ON micros_location_configs
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid()
        AND role IN ('super_admin', 'head_office')
        AND is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid()
        AND role IN ('super_admin', 'head_office')
        AND is_active = true
    )
  );

-- ── Seed: existing three locations ────────────────────────────────────────────
-- Credentials live in env vars — NEVER stored here.
-- location_ref for Sea Castle is stored in DB because it shares Si Cantina's
-- env_prefix (MICROS_*) and must be distinguished from the Si Cantina locRef.
-- Si Cantina and Primi read their locRef from the env var {prefix}LOCATION_REF.

INSERT INTO micros_location_configs (location_key, display_name, auth_flow, env_prefix, location_ref, enabled)
VALUES
  (
    'si-cantina',
    'Si Cantina Sociale',
    'pkce',
    'MICROS_',
    NULL,   -- read from env: MICROS_LOCATION_REF
    true
  ),
  (
    'primi-camps-bay',
    'Primi Camps Bay',
    'pkce',
    'MICROS_PRIMI_CAMPS_BAY_',
    NULL,   -- read from env: MICROS_PRIMI_CAMPS_BAY_LOCATION_REF
    true
  ),
  (
    'sea-castle-camps-bay',
    'Sea Castle Hotel Camps Bay',
    'pkce',
    'MICROS_',   -- shares Si Cantina credentials
    '2001002',   -- location_ref stored here — cannot use MICROS_LOCATION_REF (that is Si Cantina's)
    true
  )
ON CONFLICT (location_key) DO NOTHING;

-- ── Link to sites table (best-effort; update site_id values post-deploy) ──────
-- The site UUIDs are environment-specific. Update via:
--   UPDATE micros_location_configs
--   SET site_id = (SELECT id FROM sites WHERE name = 'Si Cantina Sociale' LIMIT 1)
--   WHERE location_key = 'si-cantina';
