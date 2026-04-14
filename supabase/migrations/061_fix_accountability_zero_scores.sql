-- Remove incorrect zero-score rows for managers where tasks were owned by
-- someone else (assigned_to mismatch with started_by), produced by the old
-- scoring logic that used started_by as ownership signal.
--
-- Specifically clears Mike's Apr 3–9 zero rows that were written before the
-- assigned_to ownership fix. The nightly cron will recalculate correct scores
-- on the next run, or trigger POST /api/accountability/calculate manually.

DELETE FROM manager_performance_scores
WHERE user_id = (SELECT id FROM profiles WHERE full_name ILIKE '%mike%' LIMIT 1)
  AND period_date IN (
    '2026-04-03',
    '2026-04-04',
    '2026-04-05',
    '2026-04-07',
    '2026-04-09'
  )
  AND score = 0;
