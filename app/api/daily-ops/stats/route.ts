/**
 * GET /api/daily-ops/stats — dashboard stats for daily ops
 */

import { NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await apiGuard(PERMISSIONS.VIEW_OWN_STORE, "GET /api/daily-ops/stats");
  if (guard.error) return guard.error;
  const { ctx, supabase: _sb } = guard;
  const supabase = _sb as any;

  try {
    const today = new Date().toLocaleDateString("en-CA");
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toLocaleDateString("en-CA");

    // Today's breakdown
    const { data: todayTasks } = await supabase
      .from("daily_ops_tasks")
      .select("*")
      .eq("site_id", ctx.siteId)
      .eq("task_date", today);

    const tasks = (todayTasks ?? []) as any[];
    const now = new Date();
    const todayStats = {
      total: tasks.length,
      not_started: tasks.filter((t) => t.status === "not_started").length,
      started: tasks.filter((t) => ["started", "in_progress"].includes(t.status)).length,
      completed: tasks.filter((t) => t.status === "completed").length,
      blocked: tasks.filter((t) => ["blocked", "delayed"].includes(t.status)).length,
      escalated: tasks.filter((t) => t.status === "escalated").length,
      missed: tasks.filter((t) => t.status === "missed").length,
      overdue: tasks.filter((t) => {
        if (t.status === "completed") return false;
        const [h, m] = (t.due_time as string).split(":").map(Number);
        const due = new Date(now);
        due.setHours(h, m, 0, 0);
        return now > due;
      }).length,
    };

    // Avg completion time per task type (last 30 days)
    const { data: histTasks } = await supabase
      .from("daily_ops_tasks")
      .select("action_name, duration_minutes")
      .eq("site_id", ctx.siteId)
      .eq("status", "completed")
      .gte("task_date", thirtyDaysAgo)
      .not("duration_minutes", "is", null);

    const avgByTask: Record<string, { total: number; count: number }> = {};
    for (const t of (histTasks ?? []) as any[]) {
      if (!avgByTask[t.action_name]) avgByTask[t.action_name] = { total: 0, count: 0 };
      avgByTask[t.action_name].total += t.duration_minutes;
      avgByTask[t.action_name].count += 1;
    }
    const avgCompletionTimes = Object.entries(avgByTask).map(([name, v]) => ({
      action_name: name,
      avg_minutes: Math.round(v.total / v.count),
      sample_size: v.count,
    }));

    // Recurring blockers (last 30 days)
    const { data: blockedTasks } = await supabase
      .from("daily_ops_tasks")
      .select("action_name, blocker_reason")
      .eq("site_id", ctx.siteId)
      .in("status", ["blocked", "delayed", "escalated"])
      .gte("task_date", thirtyDaysAgo)
      .not("blocker_reason", "is", null);

    const blockerCounts: Record<string, number> = {};
    for (const t of (blockedTasks ?? []) as any[]) {
      const key = `${t.action_name}: ${t.blocker_reason}`;
      blockerCounts[key] = (blockerCounts[key] ?? 0) + 1;
    }
    const recurringBlockers = Object.entries(blockerCounts)
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .map(([reason, count]) => ({ reason, count }));

    // Team completion rates (last 30 days)
    const { data: teamTasks } = await supabase
      .from("daily_ops_tasks")
      .select("assigned_to, status")
      .eq("site_id", ctx.siteId)
      .gte("task_date", thirtyDaysAgo)
      .not("assigned_to", "is", null);

    const teamMap: Record<string, { total: number; completed: number }> = {};
    for (const t of (teamTasks ?? []) as any[]) {
      if (!teamMap[t.assigned_to]) teamMap[t.assigned_to] = { total: 0, completed: 0 };
      teamMap[t.assigned_to].total += 1;
      if (t.status === "completed") teamMap[t.assigned_to].completed += 1;
    }

    // Resolve names
    const userIds = Object.keys(teamMap);
    let nameMap: Record<string, string> = {};
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", userIds);
      for (const p of (profiles ?? []) as any[]) {
        nameMap[p.id] = p.full_name || p.email;
      }
    }

    const teamRates = Object.entries(teamMap).map(([userId, v]) => ({
      user_id: userId,
      name: nameMap[userId] ?? "Unknown",
      total: v.total,
      completed: v.completed,
      rate: Math.round((v.completed / v.total) * 100),
    }));

    return NextResponse.json({
      today: todayStats,
      avgCompletionTimes,
      recurringBlockers,
      teamRates,
    });
  } catch (err) {
    logger.error("Daily ops stats GET failed", { err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
