/**
 * Backfill accountability scores directly via Supabase Management API.
 * Usage: node scripts/backfill-scores.mjs
 */

const TOKEN = 'sbp_edd323015533760a00102e7ce82fb46e955096dd';
const PROJECT = 'bdzcydhrdjprdzywjbeu';

async function query(sql) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json();
}

async function backfill() {
  // Generate date range from 2026-03-31 to yesterday
  const start = new Date('2026-03-31');
  const now = new Date();
  const yesterday = new Date(now.getTime() + 2 * 60 * 60 * 1000); // SAST
  yesterday.setDate(yesterday.getDate() - 1);

  const dates = [];
  const d = new Date(start);
  while (d <= yesterday) {
    dates.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }

  console.log(`Backfilling ${dates.length} dates: ${dates[0]} → ${dates[dates.length - 1]}`);

  let totalScores = 0;
  let totalErrors = 0;

  for (const date of dates) {
    try {
      // SQL that computes and upserts scores for a single date
      const sql = `
        WITH task_users AS (
          -- Enumerate all distinct (user_id, site_id) from any actor column
          SELECT DISTINCT u.uid AS user_id, t.site_id
          FROM daily_ops_tasks t
          CROSS JOIN LATERAL (
            VALUES (t.started_by), (t.completed_by), (t.blocked_by), (t.escalated_by)
          ) AS u(uid)
          WHERE t.task_date = '${date}'
            AND u.uid IS NOT NULL
        ),
        metrics AS (
          SELECT
            tu.user_id,
            tu.site_id,
            s.organisation_id,
            -- tasks_assigned: started_by OR completed_by = user
            (SELECT COUNT(*) FROM daily_ops_tasks t2
             WHERE t2.task_date = '${date}' AND t2.site_id = tu.site_id
               AND (t2.started_by = tu.user_id OR t2.completed_by = tu.user_id)
            ) AS tasks_assigned,
            -- tasks_completed: completed_by = user AND status = completed
            (SELECT COUNT(*) FROM daily_ops_tasks t2
             WHERE t2.task_date = '${date}' AND t2.site_id = tu.site_id
               AND t2.completed_by = tu.user_id AND t2.status = 'completed'
            ) AS tasks_completed,
            -- tasks_on_time: completed, on time
            (SELECT COUNT(*) FROM daily_ops_tasks t2
             WHERE t2.task_date = '${date}' AND t2.site_id = tu.site_id
               AND t2.completed_by = tu.user_id AND t2.status = 'completed'
               AND t2.completed_at::time <= t2.due_time
            ) AS tasks_on_time,
            -- tasks_blocked
            (SELECT COUNT(*) FROM daily_ops_tasks t2
             WHERE t2.task_date = '${date}' AND t2.site_id = tu.site_id
               AND t2.blocked_by = tu.user_id
            ) AS tasks_blocked,
            -- tasks_escalated
            (SELECT COUNT(*) FROM daily_ops_tasks t2
             WHERE t2.task_date = '${date}' AND t2.site_id = tu.site_id
               AND t2.escalated_by = tu.user_id
            ) AS tasks_escalated,
            -- avg completion minutes
            (SELECT AVG(t2.time_to_complete_minutes) FROM daily_ops_tasks t2
             WHERE t2.task_date = '${date}' AND t2.site_id = tu.site_id
               AND t2.completed_by = tu.user_id AND t2.status = 'completed'
               AND t2.time_to_complete_minutes > 0
            ) AS avg_minutes
          FROM task_users tu
          JOIN sites s ON s.id = tu.site_id
        ),
        scored AS (
          SELECT *,
            m.tasks_completed - m.tasks_on_time AS tasks_late,
            CASE WHEN m.tasks_assigned > 0
              THEN ROUND((m.tasks_completed::numeric / m.tasks_assigned) * 100, 2)
              ELSE 0 END AS completion_rate,
            CASE WHEN m.tasks_completed > 0
              THEN ROUND((m.tasks_on_time::numeric / m.tasks_completed) * 100, 2)
              ELSE 0 END AS on_time_rate,
            ROUND(m.avg_minutes::numeric, 2) AS avg_completion_minutes,
            LEAST(100, GREATEST(0, ROUND(
              (CASE WHEN m.tasks_assigned > 0
                THEN (m.tasks_completed::numeric / m.tasks_assigned) ELSE 0 END) * 60
              + (CASE WHEN m.tasks_completed > 0
                THEN (m.tasks_on_time::numeric / m.tasks_completed) ELSE 0 END) * 30
              - m.tasks_escalated * 5
            )))::integer AS score
          FROM metrics m
        )
        INSERT INTO manager_performance_scores (
          user_id, site_id, organisation_id, period_date,
          tasks_assigned, tasks_completed, tasks_on_time, tasks_late,
          tasks_blocked, tasks_escalated, completion_rate, on_time_rate,
          avg_completion_minutes, score, updated_at
        )
        SELECT
          user_id, site_id, organisation_id, '${date}'::date,
          tasks_assigned, tasks_completed, tasks_on_time, tasks_late,
          tasks_blocked, tasks_escalated, completion_rate, on_time_rate,
          avg_completion_minutes, score, NOW()
        FROM scored
        ON CONFLICT (user_id, site_id, period_date)
        DO UPDATE SET
          organisation_id        = EXCLUDED.organisation_id,
          tasks_assigned         = EXCLUDED.tasks_assigned,
          tasks_completed        = EXCLUDED.tasks_completed,
          tasks_on_time          = EXCLUDED.tasks_on_time,
          tasks_late             = EXCLUDED.tasks_late,
          tasks_blocked          = EXCLUDED.tasks_blocked,
          tasks_escalated        = EXCLUDED.tasks_escalated,
          completion_rate        = EXCLUDED.completion_rate,
          on_time_rate           = EXCLUDED.on_time_rate,
          avg_completion_minutes = EXCLUDED.avg_completion_minutes,
          score                  = EXCLUDED.score,
          updated_at             = NOW()
      `;

      const result = await query(sql);
      // Supabase management API returns [] for DDL/DML success
      console.log(`  ${date}: OK`);
      totalScores++;
    } catch (err) {
      console.error(`  ${date}: ERROR — ${err.message}`);
      totalErrors++;
    }
  }

  // Check final count
  const countResult = await query(
    "SELECT COUNT(*) AS total FROM manager_performance_scores"
  );
  console.log(`\nDone. ${totalScores} dates processed, ${totalErrors} errors.`);
  console.log(`Total rows in manager_performance_scores: ${countResult[0]?.total}`);
}

backfill().catch(console.error);
