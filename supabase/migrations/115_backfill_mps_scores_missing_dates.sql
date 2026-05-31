-- ============================================================================
-- Migration 115: Backfill Missing MPS Scores (F-03)
-- ============================================================================
--
-- ROOT CAUSE:
--   score-calculator.ts assigns credit only when assigned_to = user_id OR
--   (assigned_to IS NULL AND started_by = user_id). Tasks where assigned_to
--   IS NULL and started_by IS NULL but completed_by IS SET are silently
--   skipped — userIds set is populated via completed_by, but tasksAssigned = 0
--   for that user, causing computeScore() to return SCORE_NO_DATA and no row
--   is written.
--
-- FIX APPLIED IN THIS MIGRATION:
--   For the backfill window, use completed_by as the effective owner when
--   assigned_to IS NULL. This matches the spirit of the scoring intent:
--   if someone completed the task, they own the score for it.
--
-- BACKFILL WINDOW: 2026-03-31 to yesterday (inclusive)
-- CONFLICT POLICY: DO NOTHING — never overwrite an already-computed score.
--
-- DOES NOT:
--   - Touch micros_connections, sync tables, MICROS credentials
--   - Overwrite existing score rows
--   - Change the TypeScript scoring logic (that's a separate improvement)
-- ============================================================================

WITH

-- ── Step 1: Build per-(user_id, site_id, task_date) task metrics ─────────────
task_metrics AS (
  SELECT
    COALESCE(t.assigned_to, t.completed_by)                     AS effective_user_id,
    t.site_id,
    t.task_date,

    -- tasks_assigned: formal assignment, or completion credit when unassigned
    COUNT(*)                                                      AS tasks_assigned,

    -- tasks_completed: user completed the task
    COUNT(*) FILTER (WHERE t.status = 'completed'
      AND t.completed_by = COALESCE(t.assigned_to, t.completed_by)) AS tasks_completed,

    -- tasks_on_time: completed before or at due_time
    COUNT(*) FILTER (
      WHERE t.status       = 'completed'
        AND t.completed_by = COALESCE(t.assigned_to, t.completed_by)
        AND t.completed_at IS NOT NULL
        AND t.due_time     IS NOT NULL
        AND (t.completed_at AT TIME ZONE 'Africa/Johannesburg')::time <= t.due_time
    )                                                             AS tasks_on_time,

    -- tasks_blocked
    COUNT(*) FILTER (WHERE t.blocked_by = COALESCE(t.assigned_to, t.completed_by))
                                                                  AS tasks_blocked,

    -- tasks_escalated
    COUNT(*) FILTER (WHERE t.escalated_by = COALESCE(t.assigned_to, t.completed_by))
                                                                  AS tasks_escalated,

    -- avg_completion_minutes
    AVG(t.time_to_complete_minutes) FILTER (
      WHERE t.status = 'completed'
        AND t.time_to_complete_minutes > 0
    )                                                             AS avg_completion_minutes

  FROM public.daily_ops_tasks t
  WHERE
    -- Only rows where we can attribute a user
    COALESCE(t.assigned_to, t.completed_by) IS NOT NULL
    -- Backfill window
    AND t.task_date >= '2026-03-31'
    AND t.task_date <  CURRENT_DATE
  GROUP BY COALESCE(t.assigned_to, t.completed_by), t.site_id, t.task_date
),

-- ── Step 2: Compute score per row ────────────────────────────────────────────
scored AS (
  SELECT
    m.effective_user_id                               AS user_id,
    m.site_id,
    s.organisation_id,
    m.task_date                                       AS period_date,
    m.tasks_assigned::integer,
    m.tasks_completed::integer,
    m.tasks_on_time::integer,
    (m.tasks_completed - m.tasks_on_time)::integer    AS tasks_late,
    m.tasks_blocked::integer,
    m.tasks_escalated::integer,
    ROUND(
      CASE WHEN m.tasks_assigned > 0
        THEN (m.tasks_completed::numeric / m.tasks_assigned) * 100
        ELSE 0 END, 2
    )                                                 AS completion_rate,
    ROUND(
      CASE WHEN m.tasks_completed > 0
        THEN (m.tasks_on_time::numeric / m.tasks_completed) * 100
        ELSE 0 END, 2
    )                                                 AS on_time_rate,
    ROUND(m.avg_completion_minutes::numeric, 2)       AS avg_completion_minutes,
    -- score = clamp(0, 100, completion_rate*0.6 + on_time_rate*0.3 - escalations*5)
    GREATEST(0, LEAST(100, ROUND(
      CASE WHEN m.tasks_assigned > 0 THEN
        ((m.tasks_completed::numeric / m.tasks_assigned) * 60)
        + (CASE WHEN m.tasks_completed > 0
           THEN (m.tasks_on_time::numeric / m.tasks_completed) * 30
           ELSE 0 END)
        - (m.tasks_escalated * 5)
      ELSE -1 END
    )))                                               AS score,
    now()                                             AS updated_at
  FROM task_metrics m
  JOIN public.sites s ON s.id = m.site_id
  -- Only include rows where tasks_assigned > 0 (mirrors SCORE_NO_DATA guard)
  WHERE m.tasks_assigned > 0
),

-- ── Step 3: Exclude rows that already have a score ───────────────────────────
missing AS (
  SELECT sc.*
  FROM scored sc
  LEFT JOIN public.manager_performance_scores mps
    ON  mps.user_id     = sc.user_id
    AND mps.site_id     = sc.site_id
    AND mps.period_date = sc.period_date
  WHERE mps.id IS NULL   -- only insert genuinely missing rows
)

-- ── Step 4: Insert missing scores ────────────────────────────────────────────
INSERT INTO public.manager_performance_scores (
  user_id, site_id, organisation_id, period_date,
  tasks_assigned, tasks_completed, tasks_on_time, tasks_late,
  tasks_blocked, tasks_escalated,
  completion_rate, on_time_rate, avg_completion_minutes,
  score, updated_at
)
SELECT
  user_id, site_id, organisation_id, period_date,
  tasks_assigned, tasks_completed, tasks_on_time, tasks_late,
  tasks_blocked, tasks_escalated,
  completion_rate, on_time_rate, avg_completion_minutes,
  score, updated_at
FROM missing
ON CONFLICT (user_id, site_id, period_date) DO NOTHING;


-- ── Verify: show what was (or would be) written ────────────────────────────
-- SELECT s.name, mps.period_date, mps.score, mps.tasks_assigned, mps.tasks_completed
-- FROM manager_performance_scores mps
-- JOIN sites s ON s.id = mps.site_id
-- WHERE mps.period_date >= '2026-05-01'
-- ORDER BY s.name, mps.period_date;
