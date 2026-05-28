-- =============================================================================
-- Migration 104: Correct Primi Camps Bay to PKCE auth flow
-- =============================================================================
--
-- Root cause correction:
--   Migrations 102 and 103 incorrectly set auth_flow='client_credentials'
--   for Primi Camps Bay based on the presence of a CLIENT_SECRET env var.
--
-- The Oracle API Account Details letter for org PRI (PRIMI) confirms:
--   - Account type: BIAPI PKCE API account
--   - API account name (username): PRI_THAMSANQA_BIAPI
--   - No client_secret was provisioned by Oracle
--   - Oracle only provisions client_credentials for a separate server-app
--     type, which was never requested for Primi
--
-- The CLIENT_SECRET stored in Vercel is the API account password stored
-- under the wrong env var name. It must be re-added as PASSWORD.
--
-- Fix:
--   1. Revert auth_flow → 'pkce'  (preserve location_ref = '101003')
--
-- Required Vercel env var changes after this migration:
--   ADD:    MICROS_PRIMI_CAMPS_BAY_USERNAME  = PRI_THAMSANQA_BIAPI
--   ADD:    MICROS_PRIMI_CAMPS_BAY_PASSWORD  = <current CLIENT_SECRET value>
--   UPDATE: MICROS_PRIMI_CAMPS_BAY_CLIENT_ID = UFJJLmQ1Zjg3YjNlLWM4MmItNDM0ZC05OTZlLWM5NzVlZjVjN2VhYQ
--   KEEP:   MICROS_PRIMI_CAMPS_BAY_AUTH_URL, BI_SERVER, ORG_IDENTIFIER (unchanged)
--   NOTE:   MICROS_PRIMI_CAMPS_BAY_CLIENT_SECRET is now unused — can stay as
--           dead var or be removed after confirming PASSWORD is correct.
-- =============================================================================

UPDATE public.micros_location_configs
SET
  auth_flow  = 'pkce',
  updated_at = now()
WHERE location_key = 'primi-camps-bay';

-- Assertion: verify the update landed
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.micros_location_configs
    WHERE location_key = 'primi-camps-bay'
      AND auth_flow    = 'pkce'
      AND location_ref = '101003'
  ) THEN
    RAISE EXCEPTION
      'Migration 104 assertion failed: primi-camps-bay must have auth_flow=pkce and location_ref=101003.';
  END IF;
END $$;
