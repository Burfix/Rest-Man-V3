/**
 * GET /api/accountability/leaderboard?siteId=&period=7d|30d
 * Returns all GMs ranked by score for the period.
 * Access: head_office / super_admin / area_manager only.
 */

import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { getPerformanceTier } from "@/services/accountability/score-calculator";

export async function GET(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.VIEW_OWN_STORE, "GET /api/accountability/leaderboard");
  if (guard.error) return guard.error;
  const { ctx, supabase: _sb } = guard;
  const supabase = _sb as any;

  const isElevated = ["super_admin", "head_office", "executive", "area_manager"].includes(ctx.role ?? "");
  if (!isElevated) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const period   = searchParams.get("period") ?? "7d";
    const siteId   = searchParams.get("siteId") ?? null;
    const days     = period === "30d" ? 30 : 7;

    const since = new Date();
    since.setDate(since.getDate() - (days - 1));
    const sinceStr = since.toISOString().split("T")[0];

    let query = supabase
      .from("manager_performance_scores")
      .select("user_id,site_id,period_date,score,completion_rate,on_time_rate,tasks_assigned,tasks_completed,tasks_blocked,tasks_escalated")
      .gte("period_date", sinceStr);

    if (siteId) {
      query = query.eq("site_id", siteId);
    }

    const { data: rows, error: rowsErr } = await query;
    if (rowsErr) return NextResponse.json({ error: rowsErr.message }, { status: 500 });

    const scoreRows = (rows ?? []) as any[];

    // Group by user_id + site_id
    const groups = new Map<string, any[]>();
    for (const r of scoreRows) {
      const key = `${r.user_id}::${r.site_id}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }

    // Resolve user names from profiles / user_roles
    const userIds = Array.from(new Set(scoreRows.map((r) => r.user_id)));
    const { data: profileRows } = await supabase
      .from("user_roles")
      .select("user_id, full_name, role, site_id")
      .in("user_id", userIds)
      .eq("is_active", true);

    const profileMap = new Map<string, { name: string; role: string }>();
    for (const p of (profileRows ?? []) as any[]) {
      profileMap.set(p.user_id, { name: p.full_name ?? "Unknown", role: p.role ?? "" });
    }

    // Build leaderboard entries
    const entries: any[] = [];

    for (const [key, dayScores] of Array.from(groups.entries())) {
      const [userId, userSiteId] = key.split("::");
      const avgScore    = +(dayScores.reduce((s: number, r: any) => s + r.score, 0) / dayScores.length).toFixed(1);
      const daysActive  = dayScores.length;
      const totalAssigned  = dayScores.reduce((s: number, r: any) => s + (r.tasks_assigned  ?? 0), 0);
      const totalCompleted = dayScores.reduce((s: number, r: any) => s + (r.tasks_completed ?? 0), 0);
      const totalBlocked   = dayScores.reduce((s: number, r: any) => s + (r.tasks_blocked   ?? 0), 0);
      const totalEscalated = dayScores.reduce((s: number, r: any) => s + (r.tasks_escalated ?? 0), 0);
      const completionRate = totalAssigned > 0 ? +((totalCompleted / totalAssigned) * 100).toFixed(1) : 0;
      const profile     = profileMap.get(userId) ?? { name: "Unknown", role: "" };

      entries.push({
        userId,
        siteId: userSiteId,
        name: profile.name,
        role: profile.role,
        avgScore,
        tier: getPerformanceTier(Math.round(avgScore)),
        daysActive,
        totalAssigned,
        totalCompleted,
        completionRate,
        totalBlocked,
        totalEscalated,
      });
    }

    // Sort by avgScore descending
    entries.sort((a, b) => b.avgScore - a.avgScore);

    return NextResponse.json({
      period,
      since: sinceStr,
      entries,
      atRisk: entries.filter((e) => e.avgScore < 60).length,
    });
  } catch (err) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
