-- =============================================================================
-- Migration 105: MICROS location config invariants and documentation lock
-- =============================================================================
--
-- This migration records the definitive, verified configuration for all three
-- MICROS locations as of 28 May 2026. It does NOT change data — it adds
-- column and table comments so the constraints are visible in the DB schema
-- and in any schema introspection tool (pg_dump, Supabase Studio, etc.).
--
-- BACKGROUND (do not remove this comment):
--   Migrations 102 and 103 incorrectly set auth_flow='client_credentials'
--   for Primi Camps Bay, causing Oracle UNSUPPORTED_CLIENT errors.
--   Migration 104 corrected this to 'pkce'.
--
--   The Oracle API Account Details letter for org PRI (PRIMI) confirms:
--     - Account type: PKCE API account
--     - Username: PRI_THAMSANQA_BIAPI
--     - No client_credentials service account was provisioned by Oracle
--
--   All three production locations use auth_flow='pkce':
--     si-cantina           → MICROS_ prefix,               SCS org
--     sea-castle-camps-bay → MICROS_ prefix,               SCS org
--     primi-camps-bay      → MICROS_PRIMI_CAMPS_BAY_ prefix, PRI org
--
-- INVARIANTS (enforced by doctor script + regression tests):
--   1. auth_flow for primi-camps-bay MUST be 'pkce'
--      Reason: Oracle provisioned a PKCE account (PRI_THAMSANQA_BIAPI),
--              not a client_credentials service account.
--   2. MICROS_PRIMI_CAMPS_BAY_USERNAME must be set to PRI_THAMSANQA_BIAPI
--   3. MICROS_PRIMI_CAMPS_BAY_PASSWORD must be set (rotated every 60 days)
--   4. PRI org must NEVER fall through to the global SCS token
--      (hard-blocked in SimphonyClient + LabourClient)
--
-- PASSWORD ROTATION:
--   Oracle PKCE passwords expire every 60 days.
--   Rotate MICROS_PRIMI_CAMPS_BAY_PASSWORD and MICROS_PASSWORD (SCS) in Vercel.
--   See docs/runbook.md → "Password Rotation Procedure" for step-by-step.
-- =============================================================================

-- Add table-level documentation
COMMENT ON TABLE public.micros_location_configs IS
  'Registry of Oracle MICROS Simphony BI API locations. '
  'All three locations use auth_flow=pkce (verified 2026-05-28). '
  'Credentials live exclusively in Vercel env vars — never in this table. '
  'See docs/runbook.md for env var names, password rotation procedure, '
  'and migration history. DO NOT change primi-camps-bay auth_flow without '
  'verifying the Oracle provisioning type first.';

-- Add column-level documentation
COMMENT ON COLUMN public.micros_location_configs.auth_flow IS
  'OAuth flow: pkce or client_credentials. '
  'All current locations (si-cantina, sea-castle-camps-bay, primi-camps-bay) '
  'use pkce. Changing to client_credentials requires Oracle to provision a '
  'separate confidential client app — the PKCE client_id cannot be reused.';

COMMENT ON COLUMN public.micros_location_configs.env_prefix IS
  'Env var prefix for this location. '
  'si-cantina + sea-castle share MICROS_ (same Oracle org SCS). '
  'primi-camps-bay uses MICROS_PRIMI_CAMPS_BAY_ (separate Oracle org PRI). '
  'Required vars: {prefix}AUTH_URL, BI_SERVER, CLIENT_ID, ORG_IDENTIFIER, '
  'USERNAME, PASSWORD. Secrets are never stored in this table.';

COMMENT ON COLUMN public.micros_location_configs.location_ref IS
  'Oracle MICROS location reference used in BIAPI calls. '
  'si-cantina: read from MICROS_LOCATION_REF env var. '
  'sea-castle-camps-bay: 2001002 (stored here since migration 082). '
  'primi-camps-bay: 101003 (stored here since migration 102).';
