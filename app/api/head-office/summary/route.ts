/**
 * GET /api/head-office/summary
 *
 * Single endpoint powering the Head Office Control Tower.
 * Scopes every query to the authenticated user's organisation(s)
 * via a direct user_roles lookup — NOT via user_accessible_sites RPC.
 *
 * Returns:
 *   stores[]        — per-store live snapshot (cards + leaderboard)
 *   accountability[] — 7-day rolling per-store scores
 *   actions[]        — live action counts per store
 *   opsTrend[]       — daily score trend for the OPS SCORE chart
 */

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserContext, authErrorResponse } from "@/lib/auth/get-user-context";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

// ── Service-role DB client ────────────────────────────────────────────────────

function serviceDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

// ── Grade helper ──────────────────────────────────────────────────────────────

function gradeFromScore(score: number | null): string {
  if (score === null) return "F";
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 65) return "C";
  if (score >= 50) return "D";
  return "F";
}

// ── Route handler ─────────────────────────────────────────────────────────────

const ELEVATED = ["head_office", "super_admin", "executive", "area_manager", "tenant_owner"];

export async function GET() {
  // ── 1. Auth ────────────────────────────────────────────────────────────────
  let ctx;
  try {
    ctx = await getUserContext();
  } catch (err: unknown) {
    return authErrorResponse(err);
  }

  if (!ELEVATED.includes(ctx.role ?? "")) {
    return NextResponse.json(
      { error: "Insufficient permissions" },
      { status: 403 },
    );
  }

  const db = serviceDb() as any; // eslint-disable-line @typescript-eslint/no-explicit-any

  try {
    // ── 2. Resolve org IDs from user_roles ──────────────────────────────────
    const { data: roleRows } = await db
      .from("user_roles")
      .select("organisation_id, site_id, role")
      .eq("user_id", ctx.userId)
      .eq("is_active", true)
      .in("role", ELEVATED);

    const isSuperAdmin = (roleRows ?? []).some(
      (r: any) => r.role === "super_admin",
    );
    const orgIds: string[] = Array.from(
      new Set(
        ((roleRows ?? []) as any[])
          .map((r: any) => r.organisation_id as string | null)
          .filter((id: string | null): id is string => !!id),
      ),
    );

    // If ANY active role row carries an explicit site_id, restrict to those sites only.
    // This ensures Portia (site_id = Primi Camps Bay) can't see other sites in the org.
    const explicitSiteIds: string[] = Array.from(
      new Set(
        ((roleRows ?? []) as any[])
          .map((r: any) => r.site_id as string | null)
          .filter((id: string | null): id is string => !!id),
      ),
    );

    // ── 3. Fetch sites scoped to user's orgs ────────────────────────────────
    let sitesQ = db
      .from("sites")
      .select("id, name, site_type, organisation_id")
      .eq("is_active", true)
      .neq("store_code", "TEST-01");

    if (!isSuperAdmin) {
      if (orgIds.length === 0 && explicitSiteIds.length === 0) {
        return NextResponse.json({
          stores: [],
          accountability: [],
          actions: [],
          opsTrend: [],
        });
      }
      // Explicit site_id grants take priority over org-level scoping.
      if (explicitSiteIds.length > 0) {
        sitesQ = sitesQ.in("id", explicitSiteIds);
      } else {
        sitesQ = sitesQ.in("organisation_id", orgIds);
      }
    }

    const { data: sitesData, error: sitesErr } = await sitesQ;
    if (sitesErr) throw sitesErr;

    const sites = (sitesData ?? []) as {
      id: string;
      name: string;
      site_type: string | null;
      organisation_id: string;
    }[];

    if (sites.length === 0) {
      return NextResponse.json({
        stores: [],
        accountability: [],
        actions: [],
        opsTrend: [],
      });
    }

    const siteIds = sites.map((s) => s.id);
    const siteNameMap = new Map(sites.map((s) => [s.id, s.name]));
    const siteTypeMap = new Map(sites.map((s) => [s.id, s.site_type ?? "restaurant"]));

    // ── 4. Parallel data queries ────────────────────────────────────────────
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const today     = new Date().toISOString().slice(0, 10);
    const sevenAgo  = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);

    const [mpsYestResult, mpsWeekResult, tasksResult, maintResult, actionsResult] =
      await Promise.allSettled([
        // Latest score per site (yesterday)
        db
          .from("manager_performance_scores")
          .select("site_id, score")
          .in("site_id", siteIds)
          .eq("period_date", yesterday),

        // 7-day accountability
        db
          .from("manager_performance_scores")
          .select(
            "site_id, period_date, score, tasks_assigned, tasks_completed, completion_rate, tasks_late",
          )
          .in("site_id", siteIds)
          .gte("period_date", sevenAgo),

        // Today's ops tasks
        db
          .from("daily_ops_tasks")
          .select("site_id, status")
          .in("site_id", siteIds)
          .eq("task_date", today),

        // Open maintenance
        db
          .from("maintenance_logs")
          .select("site_id, repair_status, priority")
          .in("site_id", siteIds)
          .eq("repair_status", "open"),

        // Live actions
        db
          .from("actions")
          .select("site_id, status, due_at")
          .in("site_id", siteIds)
          .is("archived_at", null),
      ]);

    // ── 5. Process: STORES ──────────────────────────────────────────────────

    // Latest score per site from yesterday
    const scoreMap = new Map<string, number>();
    if (mpsYestResult.status === "fulfilled") {
      for (const row of (mpsYestResult.value.data ?? []) as any[]) {
        if (!scoreMap.has(row.site_id)) scoreMap.set(row.site_id, row.score);
      }
    }

    // Tasks today
    const tasksTotalMap     = new Map<string, number>();
    const tasksCompletedMap = new Map<string, number>();
    if (tasksResult.status === "fulfilled") {
      for (const row of (tasksResult.value.data ?? []) as any[]) {
        const sid = row.site_id as string;
        tasksTotalMap.set(sid, (tasksTotalMap.get(sid) ?? 0) + 1);
        if (row.status === "completed") {
          tasksCompletedMap.set(sid, (tasksCompletedMap.get(sid) ?? 0) + 1);
        }
      }
    }

    // Maintenance counts
    const maintOpenMap     = new Map<string, number>();
    const maintCriticalMap = new Map<string, number>();
    if (maintResult.status === "fulfilled") {
      for (const row of (maintResult.value.data ?? []) as any[]) {
        const sid = row.site_id as string;
        maintOpenMap.set(sid, (maintOpenMap.get(sid) ?? 0) + 1);
        if (["urgent", "critical"].includes(row.priority ?? "")) {
          maintCriticalMap.set(sid, (maintCriticalMap.get(sid) ?? 0) + 1);
        }
      }
    }

    const stores = sites
      .map((site) => {
        const score = scoreMap.get(site.id) ?? null;
        return {
          id:                   site.id,
          name:                 site.name,
          site_type:            site.site_type ?? "restaurant",
          score:                score !== null ? Math.round(score) : null,
          grade:                gradeFromScore(score),
          tasks_today:          tasksTotalMap.get(site.id) ?? 0,
          completed_today:      tasksCompletedMap.get(site.id) ?? 0,
          open_maintenance:     maintOpenMap.get(site.id) ?? 0,
          critical_maintenance: maintCriticalMap.get(site.id) ?? 0,
        };
      })
      .sort((a, b) => {
        if (a.score === null && b.score === null) return 0;
        if (a.score === null) return 1;
        if (b.score === null) return -1;
        return b.score - a.score;
      });

    // ── 6. Process: ACCOUNTABILITY (7-day per-store) ──────────────────────

    const accMap = new Map<
      string,
      {
        scoreSum: number;
        scoreCount: number;
        totalActions: number;
        done: number;
        overdue: number;
      }
    >();

    if (mpsWeekResult.status === "fulfilled") {
      for (const row of (mpsWeekResult.value.data ?? []) as any[]) {
        const sid = row.site_id as string;
        if (!accMap.has(sid)) {
          accMap.set(sid, { scoreSum: 0, scoreCount: 0, totalActions: 0, done: 0, overdue: 0 });
        }
        const entry = accMap.get(sid)!;
        entry.scoreSum   += row.score;
        entry.scoreCount += 1;
        entry.totalActions += row.tasks_assigned  ?? 0;
        entry.done         += row.tasks_completed ?? 0;
        entry.overdue      += row.tasks_late       ?? 0;
      }
    }

    const accountability = sites
      .filter((s) => accMap.has(s.id))
      .map((site) => {
        const e = accMap.get(site.id)!;
        const avgScore = e.scoreCount > 0 ? Math.round(e.scoreSum / e.scoreCount) : null;
        return {
          id:             site.id,
          name:           site.name,
          avg_score:      avgScore,
          grade:          gradeFromScore(avgScore),
          total_actions:  e.totalActions,
          done:           e.done,
          completion_pct: e.totalActions > 0
            ? Math.round((e.done / e.totalActions) * 100)
            : null,
          overdue:        e.overdue,
        };
      })
      .sort((a, b) => {
        if (a.avg_score === null && b.avg_score === null) return 0;
        if (a.avg_score === null) return 1;
        if (b.avg_score === null) return -1;
        return b.avg_score - a.avg_score;
      });

    // ── 7. Process: ACTIONS ────────────────────────────────────────────────

    const actMap = new Map<
      string,
      { total: number; done: number; late: number }
    >();
    const now = Date.now();

    if (actionsResult.status === "fulfilled") {
      for (const row of (actionsResult.value.data ?? []) as any[]) {
        const sid = row.site_id as string;
        if (!sid) continue;
        if (!actMap.has(sid)) actMap.set(sid, { total: 0, done: 0, late: 0 });
        const e = actMap.get(sid)!;
        e.total++;
        if (row.status === "completed") {
          e.done++;
        } else if (
          ["pending", "in_progress"].includes(row.status) &&
          row.due_at &&
          new Date(row.due_at).getTime() < now
        ) {
          e.late++;
        }
      }
    }

    const actions = sites.map((site) => {
      const e = actMap.get(site.id) ?? { total: 0, done: 0, late: 0 };
      return {
        id:             site.id,
        name:           site.name,
        total:          e.total,
        done:           e.done,
        late:           e.late,
        completion_pct: e.total > 0 ? Math.round((e.done / e.total) * 100) : null,
      };
    }).sort((a, b) => a.name.localeCompare(b.name));

    // ── 8. Process: OPS SCORE TREND ────────────────────────────────────────

    const trendMap = new Map<
      string,
      { date: string; site: string; avg_score: number }[]
    >();

    if (mpsWeekResult.status === "fulfilled") {
      // Group by period_date + site
      const byDateSite = new Map<string, { sum: number; count: number; siteName: string }>();

      for (const row of (mpsWeekResult.value.data ?? []) as any[]) {
        const key = `${row.period_date}||${row.site_id}`;
        const existing = byDateSite.get(key);
        if (!existing) {
          byDateSite.set(key, {
            sum:      row.score,
            count:    1,
            siteName: siteNameMap.get(row.site_id) ?? row.site_id,
          });
        } else {
          existing.sum   += row.score;
          existing.count += 1;
        }
      }

      byDateSite.forEach((val, key) => {
        const parts = key.split("||");
        const date = parts[0];
        const entry = {
          date,
          site:      val.siteName,
          avg_score: Math.round(val.sum / val.count),
        };
        const siteName = val.siteName;
        if (!trendMap.has(siteName)) trendMap.set(siteName, []);
        trendMap.get(siteName)!.push(entry);
      });
    }

    const opsTrendRows: { date: string; site: string; avg_score: number }[] = [];
    trendMap.forEach((rows) => rows.forEach((r) => opsTrendRows.push(r)));
    const opsTrend = opsTrendRows.sort((a, b) => a.date.localeCompare(b.date));

    // ── 9. Return ──────────────────────────────────────────────────────────
    return NextResponse.json({ stores, accountability, actions, opsTrend });
  } catch (err: any) {
    logger.error("Head Office summary error", { err: err?.message ?? err });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
