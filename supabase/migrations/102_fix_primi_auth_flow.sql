-- ============================================================
-- Migration 102: Fix Primi Camps Bay auth_flow + location_ref
-- ============================================================
--
-- Root cause fix for production incident:
--   Migration 101 seeded primi-camps-bay with auth_flow='pkce'.
--   Primi Camps Bay uses OAuth2 client_credentials (not PKCE).
--   With auth_flow='pkce', the registry requires USERNAME + PASSWORD
--   for configured=true. Since those are not set (Primi uses
--   CLIENT_SECRET), configured=false → SimphonyClient falls to the
--   NON_GLOBAL_ORGS hard-block → throws "Auth failed".
--
-- Fix:
--   1. Set auth_flow = 'client_credentials'
--      Registry now expects MICROS_PRIMI_CAMPS_BAY_CLIENT_SECRET
--      and sets configured=true when it is present.
--   2. Set location_ref = '101003'
--      Previously NULL (read from MICROS_PRIMI_CAMPS_BAY_LOCATION_REF
--      env var). Storing it in DB is more reliable and explicit.
--
-- After this migration, the only env var needed to unblock auth is:
--   MICROS_PRIMI_CAMPS_BAY_CLIENT_SECRET
--
-- All other required vars (already set in Vercel):
--   MICROS_PRIMI_CAMPS_BAY_AUTH_URL
--   MICROS_PRIMI_CAMPS_BAY_BI_SERVER
--   MICROS_PRIMI_CAMPS_BAY_CLIENT_ID
--   MICROS_PRIMI_CAMPS_BAY_ORG_IDENTIFIER (or ORG_SHORT_NAME)
-- ============================================================

UPDATE micros_location_configs
SET
  auth_flow    = 'client_credentials',
  location_ref = '101003',
  updated_at   = now()
WHERE location_key = 'primi-camps-bay';

-- Verify the update landed correctly (advisory check — not a hard constraint).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM micros_location_configs
    WHERE location_key  = 'primi-camps-bay'
      AND auth_flow     = 'client_credentials'
      AND location_ref  = '101003'
  ) THEN
    RAISE EXCEPTION
      'Migration 102 assertion failed: primi-camps-bay row not updated correctly.';
  END IF;
END $$;
