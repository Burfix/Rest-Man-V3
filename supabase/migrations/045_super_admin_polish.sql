-- ============================================================
-- Migration 045: Super Admin Polish
-- Updates seed data and adds impersonation audit support.
-- ============================================================

-- Fix profile full_name
UPDATE profiles
SET full_name = 'Thami Gumpo', updated_at = now()
WHERE id = '5fa15569-8415-4118-9d83-1fd7d8408963';

-- Ensure super_admin role has org set
UPDATE user_roles
SET organisation_id = '00000000-0000-0000-0000-000000000001'
WHERE user_id = '5fa15569-8415-4118-9d83-1fd7d8408963'
  AND organisation_id IS NULL;
