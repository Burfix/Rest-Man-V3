/**
 * Accountability Layer — Score Calculator
 *
 * Computes daily manager performance scores from daily_ops_tasks.
 *
 * For each (user_id, site_id, date):
 *   tasks_assigned  = tasks where started_by OR completed_by = user_id on date
 *   tasks_completed = completed_by = user_id AND status = 'completed'
 *   tasks_on_time   = completed AND completed_at::time <= due_time
 *   tasks_late      = tasks_completed − tasks_on_time
 *   tasks_blocked   = blocked_by = user_id
 *   tasks_escalated = escalated_by = user_id
 *   completion_rate = tasks_completed / tasks_assigned
 *   on_time_rate    = tasks_on_time / tasks_completed
 *   avg_completion_minutes = AVG(time_to_complete_minutes) for completed
 *
 *   score (0–100):
 *     base    = completion_rate × 60
 *     time    = on_time_rate × 30
 *     penalty = tasks_escalated × 5
 *     score   = clamp(0, 100, base + time − penalty)
 *
 * Run via: POST /api/accountability/calculate
 * Daily cron at 01:00 UTC (03:00 SAST)
 */

import { createServerClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── Types ─────────────────────────────────────────────────────────────────────

export type ScoreInputMetrics = {
  tasksAssigned: number;
  tasksCompleted: number;
  tasksOnTime: number;
  tasksBlocked: number;
  tasksEscalated: number;
};

export type PerformanceTier = "Elite" | "Strong" | "Average" | "At Risk";

// ── Pure score computation ────────────────────────────────────────────────────

/** Sentinel returned by computeScore when no tasks were assigned (day off / unassigned). */
export const SCORE_NO_DATA = -1;

/**
 * Score 0–100:
 *   completion_rate × 60  (60 pts max)
 *   on_time_rate   × 30  (30 pts max)
 *   −5 per escalation
 *
 * Returns SCORE_NO_DATA (-1) when tasksAssigned === 0 so callers can
 * distinguish "no tasks today" from a genuine zero score.
 */
export function computeScore(m: ScoreInputMetrics): number {
  // No tasks assigned = no data for this day (day off or unassigned).
  // Return sentinel so the caller can skip writing a misleading 0 row.
  if (m.tasksAssigned === 0) return SCORE_NO_DATA;

  const completionRate = m.tasksCompleted / m.tasksAssigned;
  const onTimeRate     = m.tasksCompleted > 0 ? m.tasksOnTime / m.tasksCompleted : 0;

  const base    = completionRate * 60;
  const time    = onTimeRate * 30;
  const penalty = m.tasksEscalated * 5;

  return Math.min(100, Math.max(0, Math.round(base + time - penalty)));
}

export function getPerformanceTier(score: number): PerformanceTier {
  if (score >= 90) return "Elite";
  if (score >= 75) return "Strong";
  if (score >= 60) return "Average";
  return "At Risk";
}

// ── SLA helper ────────────────────────────────────────────────────────────────

export function computeSla(
  taskDate: string,
  dueTime: string,
  completedAt: string,
): { sla_met: boolean; minutes_from_sla: number } {
  const [h, m] = dueTime.split(":").map(Number);
  const deadline = new Date(taskDate + "T00:00:00");
  deadline.setHours(h, m, 0, 0);
  const completed = new Date(completedAt);
  const diffMinutes = Math.round((completed.getTime() - deadline.getTime()) / 60_000);
  return { sla_met: diffMinutes <= 0, minutes_from_sla: diffMinutes };
}

// ── Per-site daily score computation ──────────────────────────────────────────

/**
 * Computes and upserts daily scores for every user active at `siteId` on `date`.
 * Returns the number of score rows written.
 */
export async function calculateDailyScores(
  siteId: string,
  date: string,
): Promise<number> {
  const supabase = createServerClient() as any;

  // 1. Fetch all tasks for this site+date
  const { data: tasks, error: taskErr } = await supabase
    .from("daily_ops_tasks")
    .select(
      "id, site_id, started_by, completed_by, blocked_by, escalated_by, " +
      "status, completed_at, due_time, task_date, time_to_complete_minutes",
    )
    .eq("site_id", siteId)
    .eq("task_date", date);

  if (taskErr) throw new Error(`Tasks query failed: ${taskErr.message}`);

  const taskList = (tasks ?? []) as any[];
  if (taskList.length === 0) return 0;

  // 2. Discover all user IDs that touched tasks this day
  const userIds = new Set<string>();
  for (const t of taskList) {
    if (t.started_by)   userIds.add(t.started_by);
    if (t.completed_by) userIds.add(t.completed_by);
    if (t.blocked_by)   userIds.add(t.blocked_by);
    if (t.escalated_by) userIds.add(t.escalated_by);
  }
  if (userIds.size === 0) return 0;

  // 3. Get organisation_id for this site
  const { data: siteRow } = await supabase
    .from("sites")
    .select("organisation_id")
    .eq("id", siteId)
    .single();
  const orgId = siteRow?.organisation_id ?? null;

  // 4. Compute per-user metrics
  const upserts: any[] = [];
  const userIdArray = Array.from(userIds);

  for (const userId of userIdArray) {
    // tasks_assigned: tasks where started_by OR completed_by = userId
    const assigned = taskList.filter(
      (t: any) => t.started_by === userId || t.completed_by === userId,
    );
    const tasksAssigned = assigned.length;

    // tasks_completed: completed_by = userId AND status = 'completed'
    const completed = taskList.filter(
      (t: any) => t.completed_by === userId && t.status === "completed",
    );
    const tasksCompleted = completed.length;

    // tasks_on_time: completed AND completed_at::time <= due_time
    let tasksOnTime = 0;
    const completionMinutes: number[] = [];

    for (const t of completed) {
      if (t.due_time && t.completed_at) {
        const { sla_met } = computeSla(t.task_date, t.due_time, t.completed_at);
        if (sla_met) tasksOnTime++;
      }
      if (t.time_to_complete_minutes != null && t.time_to_complete_minutes > 0) {
        completionMinutes.push(t.time_to_complete_minutes);
      }
    }

    const tasksLate = tasksCompleted - tasksOnTime;

    // tasks_blocked: blocked_by = userId
    const tasksBlocked = taskList.filter(
      (t: any) => t.blocked_by === userId,
    ).length;

    // tasks_escalated: escalated_by = userId
    const tasksEscalated = taskList.filter(
      (t: any) => t.escalated_by === userId,
    ).length;

    const completionRate = tasksAssigned > 0
      ? +((tasksCompleted / tasksAssigned) * 100).toFixed(2)
      : 0;
    const onTimeRate = tasksCompleted > 0
      ? +((tasksOnTime / tasksCompleted) * 100).toFixed(2)
      : 0;
    const avgMinutes = completionMinutes.length > 0
      ? +(completionMinutes.reduce((a, b) => a + b, 0) / completionMinutes.length).toFixed(2)
      : null;

    const score = computeScore({
      tasksAssigned,
      tasksCompleted,
      tasksOnTime,
      tasksBlocked,
      tasksEscalated,
    });

    // No tasks assigned today — manager had a day off or was unassigned.
    // Skip this user entirely; do not write a 0 score row.
    if (score === SCORE_NO_DATA) continue;

    upserts.push({
      user_id:                userId,
      site_id:                siteId,
      organisation_id:        orgId,
      period_date:            date,
      tasks_assigned:         tasksAssigned,
      tasks_completed:        tasksCompleted,
      tasks_on_time:          tasksOnTime,
      tasks_late:             tasksLate,
      tasks_blocked:          tasksBlocked,
      tasks_escalated:        tasksEscalated,
      completion_rate:        completionRate,
      on_time_rate:           onTimeRate,
      avg_completion_minutes: avgMinutes,
      score,
      updated_at:             new Date().toISOString(),
    });
  }

  if (upserts.length > 0) {
    const { error: upsertErr } = await supabase
      .from("manager_performance_scores")
      .upsert(upserts, { onConflict: "user_id,site_id,period_date" });
    if (upsertErr) throw new Error(`Upsert failed: ${upsertErr.message}`);
  }

  return upserts.length;
}

// ── All-sites daily scores ────────────────────────────────────────────────────

/**
 * Runs calculateDailyScores for every active site.
 * `date` defaults to yesterday (SAST).
 * Never throws — collects errors per site.
 */
export async function calculateAllSitesScores(date?: string): Promise<{
  sitesProcessed: number;
  scoresWritten: number;
  errors: string[];
}> {
  const resolvedDate = date ?? yesterdaySAST();
  const supabase = createServerClient() as any;

  const { data: sites, error: siteErr } = await supabase
    .from("sites")
    .select("id")
    .eq("is_active", true);

  if (siteErr) {
    return { sitesProcessed: 0, scoresWritten: 0, errors: [siteErr.message] };
  }

  const siteList = (sites ?? []) as { id: string }[];
  let sitesProcessed = 0;
  let scoresWritten = 0;
  const errors: string[] = [];

  for (const site of siteList) {
    try {
      const written = await calculateDailyScores(site.id, resolvedDate);
      scoresWritten += written;
      sitesProcessed++;
    } catch (err: any) {
      const msg = `Site ${site.id}: ${err.message ?? String(err)}`;
      logger.error(msg);
      errors.push(msg);
    }
  }

  return { sitesProcessed, scoresWritten, errors };
}

// ── Legacy wrapper (used by /api/accountability/compute-scores) ───────────────

export async function computeAndStoreDailyScores(date: string): Promise<{
  processed: number;
  errors: string[];
}> {
  const result = await calculateAllSitesScores(date);
  return { processed: result.scoresWritten, errors: result.errors };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function yesterdaySAST(): string {
  const now = new Date();
  // SAST = UTC+2
  const sast = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  sast.setDate(sast.getDate() - 1);
  return sast.toISOString().slice(0, 10);
}
