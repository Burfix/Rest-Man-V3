/**
 * GET /api/actions/performance
 *
 * Returns performance metrics for the actions engine:
 *   - Today's completion rate
 *   - Average resolution time (last 7 days)
 *   - Actions created per day (last 7 days)
 *   - Last 7 days of daily stats
 */

import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/get-user-context";

function daysAgo(n: number): string {
  const d = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Africa/Johannesburg" })
  );
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function todayJHB(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
}

export async function GET() {
  try {
    const ctx = await getUserContext().catch(() => null);
    if (!ctx?.siteId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const siteId = ctx.siteId;

    const supabase  = createServerClient();
    const today     = todayJHB();
    const sevenDaysAgo = daysAgo(7);

    // ── Live today counts ─────────────────────────────────────────────────────
    const [
      { count: todayPending },
      { count: todayInProgress },
      { count: todayCompleted },
    ] = await Promise.all([
      supabase
        .from("actions")
        .select("id", { count: "exact", head: true })
        .is("archived_at", null)
        .eq("status", "pending"),
      supabase
        .from("actions")
        .select("id", { count: "exact", head: true })
        .is("archived_at", null)
        .eq("status", "in_progress"),
      supabase
        .from("actions")
        .select("id", { count: "exact", head: true })
        .is("archived_at", null)
        .eq("status", "completed"),
    ]);

    const totalActive  = (todayPending ?? 0) + (todayInProgress ?? 0) + (todayCompleted ?? 0);
    const completionRateToday =
      totalActive > 0 ? Math.round(((todayCompleted ?? 0) / totalActive) * 100) : 0;

    // ── Historical stats (last 7 full days) ───────────────────────────────────
    const { data: dailyStats } = await supabase
      .from("action_daily_stats")
      .select("*")
      .eq("site_id", siteId)
      .gte("stat_date", sevenDaysAgo)
      .lt("stat_date", today)
      .order("stat_date", { ascending: false });

    // ── Avg resolution time across last 7 days (from completed actions) ───────
    const { data: recentCompleted } = await supabase
      .from("actions")
      .select("created_at, completed_at")
      .not("completed_at", "is", null)
      .gte("completed_at", `${sevenDaysAgo}T00:00:00.000Z`)
      .limit(500);

    let avgResolutionMinutes: number | null = null;
    if (recentCompleted && recentCompleted.length > 0) {
      const totalMs = recentCompleted.reduce((sum, a) => {
        if (!a.completed_at || !a.created_at) return sum;
        return sum + (new Date(a.completed_at).getTime() - new Date(a.created_at).getTime());
      }, 0);
      avgResolutionMinutes = Math.round(totalMs / recentCompleted.length / 60_000);
    }

    // ── Actions per day (last 7 days from daily stats) ────────────────────────
    const actionsPerDay =
      dailyStats && dailyStats.length > 0
        ? Math.round(
            (dailyStats as { total_created: number }[]).reduce(
              (s, d) => s + (d.total_created ?? 0),
              0
            ) / dailyStats.length
          )
        : null;

    return NextResponse.json({
      today: {
        pending:            todayPending    ?? 0,
        in_progress:        todayInProgress ?? 0,
        completed:          todayCompleted  ?? 0,
        total:              totalActive,
        completion_rate_pct: completionRateToday,
      },
      last_7_days: {
        avg_resolution_minutes: avgResolutionMinutes,
        avg_actions_per_day:    actionsPerDay,
        daily_stats:            dailyStats ?? [],
      },
    });
  } catch (err) {
    console.error("[GET /api/actions/performance] unexpected:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
