/**
 * GET /api/accountability/manager/[userId]
 * Returns last 30 days of daily scores + aggregate stats for a single manager.
 * Access: own profile for GMs, all profiles for head_office/super_admin/area_manager.
 */

import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { getPerformanceTier } from "@/services/accountability/score-calculator";

export async function GET(
  _req: NextRequest,
  { params }: { params: { userId: string } },
) {
  const guard = await apiGuard(PERMISSIONS.VIEW_OWN_STORE, "GET /api/accountability/manager/[userId]");
  if (guard.error) return guard.error;
  const { ctx, supabase: _sb } = guard;
  const supabase = _sb as any;

  // GMs can only view their own data
  const isSelf = ctx.userId === params.userId;
  const isElevated = ["super_admin", "head_office", "executive", "area_manager"].includes(ctx.role ?? "");
  if (!isSelf && !isElevated) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const today = new Date();
    const since = new Date(today);
    since.setDate(since.getDate() - 29);
    const sinceStr = since.toISOString().split("T")[0];

    // Fetch last 30 days scores
    const { data: scores, error: scoresErr } = await supabase
      .from("manager_performance_scores")
      .select("period_date,score,completion_rate,on_time_rate,tasks_assigned,tasks_completed,tasks_on_time,tasks_late,tasks_blocked,tasks_escalated,avg_completion_minutes,site_id")
      .eq("user_id", params.userId)
      .gte("period_date", sinceStr)
      .order("period_date", { ascending: false });

    if (scoresErr) {
      return NextResponse.json({ error: scoresErr.message }, { status: 500 });
    }

    const scoreList = (scores ?? []) as any[];

    if (scoreList.length === 0) {
      return NextResponse.json({
        userId: params.userId,
        scores: [],
        aggregate: null,
      });
    }

    // Aggregate over the period
    const totalAssigned  = scoreList.reduce((s, r) => s + (r.tasks_assigned  ?? 0), 0);
    const totalCompleted = scoreList.reduce((s, r) => s + (r.tasks_completed ?? 0), 0);
    const totalOnTime    = scoreList.reduce((s, r) => s + (r.tasks_on_time   ?? 0), 0);
    const totalBlocked   = scoreList.reduce((s, r) => s + (r.tasks_blocked   ?? 0), 0);
    const totalEscalated = scoreList.reduce((s, r) => s + (r.tasks_escalated ?? 0), 0);
    const totalLate      = scoreList.reduce((s, r) => s + (r.tasks_late      ?? 0), 0);
    const avgScore       = +(scoreList.reduce((s, r) => s + r.score, 0) / scoreList.length).toFixed(1);
    const bestDay        = scoreList.reduce((a, b) => (a.score >= b.score ? a : b));
    const worstDay       = scoreList.reduce((a, b) => (a.score <= b.score ? a : b));

    const completionRate = totalAssigned > 0 ? +((totalCompleted / totalAssigned) * 100).toFixed(1) : 0;
    const onTimeRate     = totalCompleted > 0 ? +((totalOnTime / totalCompleted) * 100).toFixed(1) : 0;
    const tier           = getPerformanceTier(Math.round(avgScore));

    // Detect repeat offenders: same task type blocked/escalated 3+ times
    const { data: recentTasks } = await supabase
      .from("task_accountability_log")
      .select("action, task_id")
      .eq("actor_id", params.userId)
      .in("action", ["blocked", "escalated"])
      .gte("timestamp", sinceStr + "T00:00:00Z");

    const logList = (recentTasks ?? []) as any[];

    // Group by action count — simple flag if >3 total blocks or escalations
    const blockCount     = logList.filter((l) => l.action === "blocked").length;
    const escalateCount  = logList.filter((l) => l.action === "escalated").length;
    const repeatOffender = blockCount >= 3 || escalateCount >= 3;

    return NextResponse.json({
      userId: params.userId,
      scores: scoreList,
      aggregate: {
        avgScore,
        tier,
        totalAssigned,
        totalCompleted,
        totalOnTime,
        totalLate,
        totalBlocked,
        totalEscalated,
        completionRate,
        onTimeRate,
        bestDay: { date: bestDay.period_date, score: bestDay.score },
        worstDay: { date: worstDay.period_date, score: worstDay.score },
        repeatOffender,
        blockCount,
        escalateCount,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
