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

-- ── 1. Fix auth_flow in location registry ────────────────────────────────────

UPDATE public.micros_location_configs
   SET auth_flow    = 'client_credentials',
       location_ref = COALESCE(NULLIF(location_ref, ''), '101003'),
       updated_at   = now()
 WHERE location_key = 'primi-camps-bay';

-- ── 2. Repair Primi micros_connections row ───────────────────────────────────
-- Only update Primi — never touch Si Cantina or Sea Castle.

UPDATE public.micros_connections
   SET location_key   = 'primi-camps-bay',
       org_identifier = COALESCE(NULLIF(org_identifier, ''), 'PRI'),
       loc_ref        = COALESCE(NULLIF(loc_ref, ''),        '101003'),
       app_server_url = COALESCE(
                          NULLIF(app_server_url, ''),
                          'https://simphony-home.msaf.oraclerestaurants.com'
                        ),
       auth_server_url = COALESCE(
                          NULLIF(auth_server_url, ''),
                          'https://ors-idm.msaf.oraclerestaurants.com'
                        )
 WHERE location_name ILIKE '%primi%'
    OR location_key  = 'primi-camps-bay'
    OR org_identifier = 'PRI';
