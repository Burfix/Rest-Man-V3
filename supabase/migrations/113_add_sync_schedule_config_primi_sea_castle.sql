-- ============================================================================
-- Migration 113: Add Primi Camps Bay + Sea Castle Hotel to sync_schedule_config
-- ============================================================================
--
-- PROBLEM:
--   sync_schedule_config only contains entries for Si Cantina Sociale.
--   Primi Camps Bay (connection: 99c50859) and Sea Castle Hotel (74d653a8)
--   are completely absent, meaning get_due_intraday_syncs() never returns
--   them and their intraday sales / labour data is never refreshed.
--
-- ROOT CAUSE OF Sea Castle 275-min staleness: missing config row.
--
-- PATTERN:
--   Mirrors Si Cantina's 3-entry pattern (intraday_sales, labour, daily_sales)
--   using each site's actual micros_connections.id as the foreign key.
--   Connection IDs verified from live DB:
--     Primi Camps Bay : 99c50859-d110-417d-a6e8-ac2dc44fee64 (loc_ref 101003)
--     Sea Castle Hotel: 74d653a8-f875-4863-955e-e1f15713da02 (loc_ref 2001002)
--
-- SAFETY:
--   Uses INSERT ... ON CONFLICT DO NOTHING — idempotent and rollback-safe.
--   Does NOT modify existing Si Cantina rows.
--   Does NOT touch micros_connections or any credential column.
-- ============================================================================

-- ── Primi Camps Bay ────────────────────────────────────────────────────────

INSERT INTO public.sync_schedule_config
  (connection_id, sync_type, is_enabled, interval_minutes,
   run_window_start, run_window_end, timezone,
   consecutive_failures)
VALUES
  -- Intraday sales: 15-min cadence, 08:00–23:00 SAST
  ('99c50859-d110-417d-a6e8-ac2dc44fee64', 'intraday_sales', true, 15,
   '08:00:00', '23:00:00', 'Africa/Johannesburg', 0),

  -- Labour: 10-min cadence, 06:00–23:59 SAST
  ('99c50859-d110-417d-a6e8-ac2dc44fee64', 'labour', true, 10,
   '06:00:00', '23:59:00', 'Africa/Johannesburg', 0),

  -- Daily sales reconciliation: no interval (driven by daily cron), 04:00–04:30 SAST
  ('99c50859-d110-417d-a6e8-ac2dc44fee64', 'daily_sales', true, NULL,
   '04:00:00', '04:30:00', 'Africa/Johannesburg', 0)

ON CONFLICT (connection_id, sync_type) DO NOTHING;


-- ── Sea Castle Hotel ───────────────────────────────────────────────────────

INSERT INTO public.sync_schedule_config
  (connection_id, sync_type, is_enabled, interval_minutes,
   run_window_start, run_window_end, timezone,
   consecutive_failures)
VALUES
  -- Intraday sales: 15-min cadence, 08:00–23:00 SAST
  ('74d653a8-f875-4863-955e-e1f15713da02', 'intraday_sales', true, 15,
   '08:00:00', '23:00:00', 'Africa/Johannesburg', 0),

  -- Labour: 10-min cadence, 06:00–23:59 SAST
  ('74d653a8-f875-4863-955e-e1f15713da02', 'labour', true, 10,
   '06:00:00', '23:59:00', 'Africa/Johannesburg', 0),

  -- Daily sales reconciliation: no interval (driven by daily cron), 04:00–04:30 SAST
  ('74d653a8-f875-4863-955e-e1f15713da02', 'daily_sales', true, NULL,
   '04:00:00', '04:30:00', 'Africa/Johannesburg', 0)

ON CONFLICT (connection_id, sync_type) DO NOTHING;


-- ── Verify ─────────────────────────────────────────────────────────────────
-- After applying, confirm all 9 rows (3 per site) exist:
--
-- SELECT ssc.sync_type, ssc.interval_minutes, ssc.is_enabled, s.name
-- FROM sync_schedule_config ssc
-- JOIN micros_connections mc ON mc.id = ssc.connection_id
-- JOIN sites s ON s.id = mc.site_id
-- ORDER BY s.name, ssc.sync_type;
