/**
 * GET /api/accountability/leaderboard?siteId=&period=7d|30d
 * Returns all GMs ranked by score for the period.
 * Access: head_office / super_admin / area_manager only.
 */

import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { isSuperAdmin } from "@/lib/admin/helpers";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { getPerformanceTier } from "@/services/accountability/score-calculator";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.VIEW_OWN_STORE, "GET /api/accountability/leaderboard");
  if (guard.error) return guard.error;
  const { ctx, supabase: _sb } = guard;
  const supabase = _sb as any;

  const isElevated = ["super_admin", "head_office", "executive", "area_manager"].includes(ctx.role ?? "");
  if (!isElevated) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const superAdmin = isSuperAdmin(ctx);

  try {
    const { searchParams } = new URL(req.url);
    const period = searchParams.get("period") ?? "7d";
    const days   = period === "30d" ? 30 : 7;

    const since = new Date();
    since.setDate(since.getDate() - (days - 1));
    const sinceStr = since.toISOString().split("T")[0];

    // Step 1: base set — all manager-level users from user_roles
    let managersQ = supabase
      .from("user_roles")
      .select("user_id, site_id, organisation_id")
      .in("role", ["gm", "supervisor", "area_manager", "head_office"])
      .eq("is_active", true)
      .is("revoked_at", null);

    if (!superAdmin && ctx.orgId) {
      managersQ = managersQ.eq("organisation_id", ctx.orgId);
    }

    const { data: managerRoleRows, error: managersErr } = await managersQ;
    if (managersErr) return NextResponse.json({ error: managersErr.message }, { status: 500 });
    const managerRoles = (managerRoleRows ?? []) as any[];

    // Step 2: resolve profiles
    const allUserIds = Array.from(new Set(managerRoles.map((r) => r.user_id as string)));
    const { data: profileRows } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", allUserIds.length > 0 ? allUserIds : ["00000000-0000-0000-0000-000000000000"]);

    const profileMap = new Map<string, { name: string; email: string }>();
    for (const p of (profileRows ?? []) as any[]) {
      profileMap.set(p.id, {
        name: p.full_name ?? (p.email ? p.email.split("@")[0] : null) ?? "Unknown",
        email: p.email ?? "",
      });
    }

    // Step 3: resolve site names
    const allSiteIds = Array.from(new Set(managerRoles.map((r) => r.site_id as string).filter(Boolean)));
    const { data: siteRows } = await supabase
      .from("sites")
      .select("id, name")
      .in("id", allSiteIds.length > 0 ? allSiteIds : ["00000000-0000-0000-0000-000000000000"]);

    const siteMap = new Map<string, string>();
    for (const s of (siteRows ?? []) as any[]) siteMap.set(s.id, s.name);

    // Step 4: fetch performance scores for the period
    let scoresQ = supabase
      .from("manager_performance_scores")
      .select("user_id, site_id, period_date, score, tasks_assigned, tasks_completed, tasks_blocked, tasks_escalated")
      .gte("period_date", sinceStr);

    if (allUserIds.length > 0) {
      scoresQ = scoresQ.in("user_id", allUserIds);
    }

    const { data: scoreData, error: scoresErr } = await scoresQ;
    if (scoresErr) return NextResponse.json({ error: scoresErr.message }, { status: 500 });

    // Step 5: group scores by user_id
    const scoreGroups = new Map<string, any[]>();
    for (const r of (scoreData ?? []) as any[]) {
      if (!scoreGroups.has(r.user_id)) scoreGroups.set(r.user_id, []);
      scoreGroups.get(r.user_id)!.push(r);
    }

    // Step 6: LEFT JOIN — every manager appears, scores default to 0
    const entries: any[] = [];
    const seen = new Set<string>();

    for (const mr of managerRoles) {
      if (seen.has(mr.user_id)) continue;
      seen.add(mr.user_id);

      const profile    = profileMap.get(mr.user_id) ?? { name: "Unknown", email: "" };
      const siteName   = siteMap.get(mr.site_id) ?? "—";
      const dayScores  = scoreGroups.get(mr.user_id) ?? [];

      let avgScore = 0, daysActive = 0, completionRate = 0, totalBlocked = 0, totalEscalated = 0;
      let totalAssigned = 0, totalCompleted = 0;

      if (dayScores.length > 0) {
        daysActive     = dayScores.length;
        totalAssigned  = dayScores.reduce((s: number, r: any) => s + (r.tasks_assigned  ?? 0), 0);
        totalCompleted = dayScores.reduce((s: number, r: any) => s + (r.tasks_completed ?? 0), 0);
        totalBlocked   = dayScores.reduce((s: number, r: any) => s + (r.tasks_blocked   ?? 0), 0);
        totalEscalated = dayScores.reduce((s: number, r: any) => s + (r.tasks_escalated ?? 0), 0);
        avgScore       = +(dayScores.reduce((s: number, r: any) => s + r.score, 0) / dayScores.length).toFixed(1);
        completionRate = totalAssigned > 0 ? +((totalCompleted / totalAssigned) * 100).toFixed(1) : 0;
      }

      entries.push({
        userId:         mr.user_id,
        siteId:         mr.site_id ?? "",
        siteName,
        name:           profile.name,
        email:          profile.email,
        avgScore,
        tier:           getPerformanceTier(Math.round(avgScore)),
        daysActive,
        totalAssigned,
        totalCompleted,
        completionRate,
        totalBlocked,
        totalEscalated,
      });
    }

    // Users with scores first (desc), then no-data users at bottom
    entries.sort((a, b) => {
      if (a.daysActive === 0 && b.daysActive > 0) return 1;
      if (b.daysActive === 0 && a.daysActive > 0) return -1;
      return b.avgScore - a.avgScore;
    });

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
