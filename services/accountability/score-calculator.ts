/**
 * Accountability Layer — Score Calculator
 *
 * Computes daily manager performance scores from daily_ops_tasks
 * and task_accountability_log.
 *
 * Formula (0–100):
 *   Completion rate  × 40 pts
 *   On-time rate     × 35 pts
 *   No blocks        × 15 pts  (−5 per block caused,  min 0)
 *   No escalations   × 10 pts  (−3 per escalation,    min 0)
 *
 * Run via: POST /api/accountability/compute-scores?date=YYYY-MM-DD
 * Or daily cron at 23:55 SAST
 */

import { createServerClient } from "@/lib/supabase/server";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ScoreInputMetrics = {
  tasksAssigned: number;
  tasksCompleted: number;
  tasksOnTime: number;
  tasksBlocked: number;
  tasksEscalated: number;
};

export type PerformanceTier = "Elite" | "Strong" | "Average" | "At Risk";

export type DailyScoreResult = {
  userId: string;
  siteId: string;
  periodDate: string;
  tasksAssigned: number;
  tasksCompleted: number;
  tasksOnTime: number;
  tasksLate: number;
  tasksBlocked: number;
  tasksEscalated: number;
  completionRate: number;
  onTimeRate: number;
  avgCompletionMinutes: number | null;
  score: number;
  tier: PerformanceTier;
};

// ── Pure score computation ────────────────────────────────────────────────────

export function computeScore(m: ScoreInputMetrics): number {
  const completionRate = m.tasksAssigned > 0 ? m.tasksCompleted / m.tasksAssigned : 0;
  const onTimeRate     = m.tasksCompleted > 0 ? m.tasksOnTime    / m.tasksCompleted : 0;

  const completionPts  = completionRate * 40;
  const onTimePts      = onTimeRate     * 35;
  const blockPts       = Math.max(0, 15 - m.tasksBlocked    * 5);
  const escalationPts  = Math.max(0, 10 - m.tasksEscalated  * 3);

  return Math.min(100, Math.round(completionPts + onTimePts + blockPts + escalationPts));
}

export function getPerformanceTier(score: number): PerformanceTier {
  if (score >= 90) return "Elite";
  if (score >= 75) return "Strong";
  if (score >= 60) return "Average";
  return "At Risk";
}

// ── SLA helper ────────────────────────────────────────────────────────────────

/**
 * Returns { sla_met, minutes_from_sla } for a completed task.
 * minutes_from_sla: negative = completed early, positive = completed late.
 */
export function computeSla(
  taskDate: string,    // "YYYY-MM-DD"
  dueTime: string,     // "HH:MM"
  completedAt: string, // ISO timestamptz
): { sla_met: boolean; minutes_from_sla: number } {
  const [h, m] = dueTime.split(":").map(Number);
  const deadline = new Date(taskDate + "T00:00:00");
  deadline.setHours(h, m, 0, 0);
  const completed = new Date(completedAt);
  const diffMinutes = Math.round((completed.getTime() - deadline.getTime()) / 60_000);
  return { sla_met: diffMinutes <= 0, minutes_from_sla: diffMinutes };
}

// ── Daily score batch computation ─────────────────────────────────────────────

/**
 * Computes and stores daily scores for all managers who had tasks on `date`.
 * Called by the 23:55 cron job.
 */
export async function computeAndStoreDailyScores(date: string): Promise<{
  processed: number;
  errors: string[];
}> {
  const supabase = createServerClient() as any;

  // Fetch all tasks for the day
  const { data: tasks, error: taskErr } = await supabase
    .from("daily_ops_tasks")
    .select("id, site_id, assigned_to, status, started_at, completed_at, due_time, task_date, duration_minutes, time_to_complete_minutes")
    .eq("task_date", date)
    .not("assigned_to", "is", null);

  if (taskErr) return { processed: 0, errors: [taskErr.message] };

  const taskList = (tasks ?? []) as any[];
  if (taskList.length === 0) return { processed: 0, errors: [] };

  // Fetch accountability log events for today (blocks + escalations per actor)
  const taskIds = taskList.map((t: any) => t.id);
  const { data: logEntries } = await supabase
    .from("task_accountability_log")
    .select("actor_id, site_id, action, sla_met, minutes_from_sla, task_id")
    .in("task_id", taskIds)
    .in("action", ["blocked", "escalated", "completed"]);

  const logList = (logEntries ?? []) as any[];

  // Group tasks by (user_id, site_id)
  const groups = new Map<string, any[]>();
  for (const t of taskList) {
    const key = `${t.assigned_to}::${t.site_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }

  // Get org_id per site
  const siteIds = Array.from(new Set(taskList.map((t: any) => t.site_id)));
  const { data: siteRows } = await supabase
    .from("sites")
    .select("id, organisation_id")
    .in("id", siteIds);
  const orgBySite = new Map((siteRows ?? []).map((s: any) => [s.id, s.organisation_id]));

  const errors: string[] = [];
  const upserts: any[] = [];

  for (const [key, userTasks] of Array.from(groups.entries())) {
    const [userId, siteId] = key.split("::");
    const orgId = orgBySite.get(siteId) ?? null;

    const tasksAssigned  = userTasks.length;
    const completedTasks = userTasks.filter((t: any) => t.status === "completed");
    const tasksCompleted = completedTasks.length;

    // On-time: use accountability_log completed entries with sla_met
    // or fall back to computing from due_time + completed_at
    const userTaskIds = new Set(userTasks.map((t: any) => t.id));

    let tasksOnTime = 0;
    let tasksLate   = 0;
    const completionMinutes: number[] = [];

    for (const t of completedTasks) {
      const logEntry = logList.find(
        (l: any) => l.task_id === t.id && l.action === "completed" && l.actor_id === userId
      );
      let slaMet: boolean | null = logEntry?.sla_met ?? null;

      // If log doesn't have it, compute inline
      if (slaMet === null && t.due_time && t.completed_at) {
        const computed = computeSla(t.task_date, t.due_time, t.completed_at);
        slaMet = computed.sla_met;
      }

      if (slaMet === true)  tasksOnTime++;
      if (slaMet === false) tasksLate++;

      const mins = t.time_to_complete_minutes ?? t.duration_minutes;
      if (mins != null && mins > 0) completionMinutes.push(mins);
    }

    // Blocks caused by this user across all their tasks
    const tasksBlocked = logList.filter(
      (l: any) => l.action === "blocked" && l.actor_id === userId && userTaskIds.has(l.task_id)
    ).length;

    // Escalations caused by this user
    const tasksEscalated = logList.filter(
      (l: any) => l.action === "escalated" && l.actor_id === userId && userTaskIds.has(l.task_id)
    ).length;

    const completionRate = tasksAssigned > 0 ? +((tasksCompleted / tasksAssigned) * 100).toFixed(2) : 0;
    const onTimeRate     = tasksCompleted > 0 ? +((tasksOnTime / tasksCompleted) * 100).toFixed(2)  : 0;
    const avgMinutes     = completionMinutes.length > 0
      ? +(completionMinutes.reduce((a, b) => a + b, 0) / completionMinutes.length).toFixed(2)
      : null;

    const score = computeScore({ tasksAssigned, tasksCompleted, tasksOnTime, tasksBlocked, tasksEscalated });

    upserts.push({
      user_id:               userId,
      site_id:               siteId,
      organisation_id:       orgId,
      period_date:           date,
      tasks_assigned:        tasksAssigned,
      tasks_completed:       tasksCompleted,
      tasks_on_time:         tasksOnTime,
      tasks_late:            tasksLate,
      tasks_blocked:         tasksBlocked,
      tasks_escalated:       tasksEscalated,
      completion_rate:       completionRate,
      on_time_rate:          onTimeRate,
      avg_completion_minutes: avgMinutes,
      score,
      updated_at:            new Date().toISOString(),
    });
  }

  if (upserts.length > 0) {
    const { error: upsertErr } = await supabase
      .from("manager_performance_scores")
      .upsert(upserts, { onConflict: "user_id,site_id,period_date" });
    if (upsertErr) errors.push(upsertErr.message);
  }

  return { processed: upserts.length, errors };
}
