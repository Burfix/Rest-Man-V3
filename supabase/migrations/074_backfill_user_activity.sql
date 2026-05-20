-- ============================================================
-- Migration 074: Backfill profiles.last_seen_at
--
-- Populates last_seen_at for all users who have NULL using
-- the best available signal in priority order:
--
--   1. Latest audit log event  (access_audit_log)
--   2. updated_at timestamp    (profile row)
--   3. created_at timestamp    (final fallback — always non-null)
--
-- Safe to run multiple times: all three UPDATEs are guarded by
-- WHERE last_seen_at IS NULL so existing valid values are never
-- overwritten.
-- ============================================================

-- ── Step 1: Audit log (most accurate — real user activity) ────────────────────

UPDATE profiles p
SET    last_seen_at = sub.last_activity
FROM (
  SELECT
    actor_user_id          AS user_id,
    MAX(created_at)        AS last_activity
  FROM   access_audit_log
  WHERE  actor_user_id IS NOT NULL
  GROUP  BY actor_user_id
) sub
WHERE  p.id             = sub.user_id
  AND  p.last_seen_at  IS NULL;


-- ── Step 2: updated_at fallback ───────────────────────────────────────────────

UPDATE profiles
SET    last_seen_at = updated_at
WHERE  last_seen_at IS NULL
  AND  updated_at   IS NOT NULL;


-- ── Step 3: created_at final fallback ─────────────────────────────────────────

UPDATE profiles
SET    last_seen_at = created_at
WHERE  last_seen_at IS NULL;


-- ── Verification ──────────────────────────────────────────────────────────────
-- Run this query after applying to confirm zero NULL rows and realistic times.

SELECT
  full_name,
  email,
  last_seen_at,
  created_at
FROM   profiles
ORDER  BY last_seen_at DESC;
