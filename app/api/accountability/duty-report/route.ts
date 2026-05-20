/**
 * GET /api/accountability/duty-report?userId=&siteId=&days=30
 * Returns per-duty avg completion times and late-start log for a GM.
 * Access: own profile for GMs, elevated roles see any manager.
 */

import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/rbac/roles";

export const dynamic = "force-dynamic";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert an ISO timestamptz to minutes-since-midnight in Africa/Johannesburg */
function toSASTMinutes(isoStr: string): number {
  const d = new Date(isoStr);
  const f = new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = f.formatToParts(d);
  const h = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const m = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  return h * 60 + m;
}

/** Format a timestamptz to "HH:MM" in SAST */
function toSASTTime(isoStr: string): string {
  const d = new Date(isoStr);
  return d.toLocaleTimeString("en-ZA", {
    timeZone: "Africa/Johannesburg",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** "10:30" → minutes since midnight */
function dueTimeMinutes(dueTime: string): number {
  const [h, m] = dueTime.split(":").map(Number);
  return h * 60 + m;
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.VIEW_OWN_STORE, "GET /api/accountability/duty-report");
  if (guard.error) return guard.error;
  const { ctx, supabase: _sb } = guard;
  const supabase = _sb as any;

  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId");
  const siteId = searchParams.get("siteId");
  const days   = Math.min(Math.max(parseInt(searchParams.get("days") ?? "30", 10), 1), 90);

  if (!userId || !siteId) {
    return NextResponse.json({ error: "userId and siteId are required" }, { status: 400 });
  }

  // GMs can only view their own data
  const isSelf     = ctx.userId === userId;
  const isElevated = ["super_admin", "head_office", "executive", "area_manager"].includes(ctx.role ?? "");
  if (!isSelf && !isElevated) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const since = new Date();
  since.setDate(since.getDate() - (days - 1));
  const sinceStr = since.toISOString().split("T")[0];

  try {
    // Fetch completed tasks for this GM at this site in the period
    const { data: rows, error } = await supabase
      .from("daily_ops_tasks")
      .select("action_name, department, priority, due_time, started_at, completed_at, time_to_complete_minutes, task_date, site_id")
      .eq("started_by", userId)
      .eq("site_id", siteId)
      .gte("task_date", sinceStr)
      .not("completed_at", "is", null)
      .gt("time_to_complete_minutes", 0);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const taskList = (rows ?? []) as any[];

    // Fetch site name
    const { data: siteRow } = await supabase
      .from("sites")
      .select("name")
      .eq("id", siteId)
      .single();
    const siteName = (siteRow as any)?.name ?? "—";

    // ── avgByDuty aggregation ─────────────────────────────────────────────────

    type DutyAgg = {
      action_name: string;
      department: string;
      priority: string;
      totalMinutes: number;
      minMinutes: number;
      maxMinutes: number;
      count: number;
      lateStartCount: number;
      totalLateMinutes: number;
    };

    const dutyMap = new Map<string, DutyAgg>();

    for (const t of taskList) {
      const key = `${t.action_name}::${t.department}::${t.priority}`;
      if (!dutyMap.has(key)) {
        dutyMap.set(key, {
          action_name: t.action_name,
          department: t.department,
          priority: t.priority,
          totalMinutes: 0,
          minMinutes: Infinity,
          maxMinutes: -Infinity,
          count: 0,
          lateStartCount: 0,
          totalLateMinutes: 0,
        });
      }
      const agg = dutyMap.get(key)!;
      const ttc = t.time_to_complete_minutes as number;
      agg.totalMinutes += ttc;
      if (ttc < agg.minMinutes) agg.minMinutes = ttc;
      if (ttc > agg.maxMinutes) agg.maxMinutes = ttc;
      agg.count += 1;

      // late start check
      if (t.started_at) {
        const startedMins = toSASTMinutes(t.started_at as string);
        const dueMins     = dueTimeMinutes(t.due_time as string);
        if (startedMins > dueMins) {
          agg.lateStartCount += 1;
          agg.totalLateMinutes += startedMins - dueMins;
        }
      }
    }

    const avgByDuty = Array.from(dutyMap.values())
      .map((agg) => ({
        action_name:       agg.action_name,
        department:        agg.department,
        priority:          agg.priority,
        avg_minutes:       Math.round(agg.totalMinutes / agg.count),
        min_minutes:       agg.minMinutes === Infinity ? 0 : agg.minMinutes,
        max_minutes:       agg.maxMinutes === -Infinity ? 0 : agg.maxMinutes,
        total_completions: agg.count,
        late_start_count:  agg.lateStartCount,
        avg_minutes_late:  agg.lateStartCount > 0
          ? Math.round(agg.totalLateMinutes / agg.lateStartCount)
          : 0,
      }))
      .sort((a, b) => b.late_start_count - a.late_start_count || b.avg_minutes - a.avg_minutes);

    // ── lateDuties ────────────────────────────────────────────────────────────

    const lateDuties: any[] = [];

    for (const t of taskList) {
      if (!t.started_at) continue;
      const startedMins = toSASTMinutes(t.started_at as string);
      const dueMins     = dueTimeMinutes(t.due_time as string);
      const minsLate    = startedMins - dueMins;
      if (minsLate <= 0) continue;

      lateDuties.push({
        task_date:        t.task_date,
        action_name:      t.action_name,
        department:       t.department,
        due_time:         t.due_time,
        started_at:       toSASTTime(t.started_at as string),
        minutes_late:     minsLate,
        time_to_complete: t.time_to_complete_minutes as number,
        site_name:        siteName,
      });
    }

    lateDuties.sort((a, b) => {
      if (b.task_date !== a.task_date) return b.task_date.localeCompare(a.task_date);
      return b.minutes_late - a.minutes_late;
    });

    return NextResponse.json({ avgByDuty, lateDuties });
  } catch (err) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
