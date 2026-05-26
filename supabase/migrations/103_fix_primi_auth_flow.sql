-- =============================================================================
-- Migration 103: Fix Primi Camps Bay auth_flow and connection row
-- =============================================================================
--
-- Problem: Migration 101 seeded Primi as auth_flow='pkce', but Primi uses
-- OAuth2 client_credentials grant (not PKCE username+password). When the
-- generic buildConfigFromRow() looks for {prefix}PASSWORD and finds nothing
-- (only CLIENT_SECRET is set in Vercel), configured=false, and the code
-- falls back to the global Si Cantina PKCE token. Sending SCS token to
-- org=PRI causes Oracle error 33102: "Organization identifier does not match
-- with the identity provided".
--
-- Fix:
--   1. Update micros_location_configs: auth_flow → client_credentials
--   2. Repair micros_connections row for Primi with correct metadata
-- =============================================================================

-- ── 1. Fix auth_flow in location registry (upsert — idempotent) ─────────────
-- INSERT so the row exists even if migration 101 seed never landed;
-- ON CONFLICT updates auth_flow and location_ref in-place.

INSERT INTO public.micros_location_configs
  (location_key, display_name, auth_flow, env_prefix, location_ref, enabled)
VALUES
  ('primi-camps-bay', 'Primi Camps Bay', 'client_credentials', 'MICROS_PRIMI_CAMPS_BAY_', '101003', true)
ON CONFLICT (location_key) DO UPDATE
  SET auth_flow    = 'client_credentials',
      location_ref = COALESCE(NULLIF(public.micros_location_configs.location_ref, ''), '101003'),
      updated_at   = now();

-- ── 2. Repair Primi micros_connections row (upsert — idempotent) ────────────
-- Conflict target mirrors migration 081: (site_id) WHERE site_id IS NOT NULL.
-- Only update fields that are empty so we never overwrite valid live data.

INSERT INTO public.micros_connections (
  location_name,
  location_key,
  site_id,
  loc_ref,
  auth_server_url,
  app_server_url,
  client_id,
  org_identifier,
  status,
  username,
  encrypted_password
)
VALUES (
  'Primi Camps Bay',
  'primi-camps-bay',
  '00000000-0000-0000-0000-000000000003',
  '101003',
  'https://ors-idm.msaf.oraclerestaurants.com',
  'https://simphony-home.msaf.oraclerestaurants.com',
  'UFJJLmQ1Zjg3YjNlLWM4MmItNDM0ZC05OTZlLWM5NzVlZjVjN2VhYQ',  -- public client_id
  'PRI',
  'pending',
  '',   -- no username: client_credentials flow
  ''    -- no password: client_credentials flow
)
ON CONFLICT (site_id) WHERE site_id IS NOT NULL
DO UPDATE
  SET location_key    = 'primi-camps-bay',
      org_identifier  = 'PRI',
      -- COALESCE keeps existing non-empty values; fills blanks with defaults.
      loc_ref         = COALESCE(
                          NULLIF(public.micros_connections.loc_ref, ''),
                          '101003'
                        ),
      app_server_url  = COALESCE(
                          NULLIF(public.micros_connections.app_server_url, ''),
                          'https://simphony-home.msaf.oraclerestaurants.com'
                        ),
      auth_server_url = COALESCE(
                          NULLIF(public.micros_connections.auth_server_url, ''),
                          'https://ors-idm.msaf.oraclerestaurants.com'
                        );
