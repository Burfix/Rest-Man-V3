/**
 * POST /api/actions/daily-reset
 *
 * Daily reset logic — runs once per day (can be called by a cron job or manually).
 *
 * Algorithm:
 *   1. Archive all completed actions from yesterday or earlier.
 *   2. Compute & persist daily stats for yesterday.
 *   3. Pending / in_progress actions are automatically carried forward
 *      (they stay in the active board — no action required).
 *
 * Returns a summary of what was archived and the stats written.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { getOperatingScore } from "@/services/ops/operatingScore";

const DEFAULT_SITE_ID = "00000000-0000-0000-0000-000000000001";

function yesterdayJHB(): string {
  const d = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Africa/Johannesburg" })
  );
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function todayJHB(): string {
  return new Date()
    .toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
}

export async function POST(req: NextRequest) {
  // Protect with a shared secret when called from a cron job
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createServerClient();
    const yesterday = yesterdayJHB();
    const today     = todayJHB();

    // ── 1. Fetch completed actions for yesterday's stats ──────────────────────
    const { data: completedYesterday, error: fetchErr } = await supabase
      .from("actions")
      .select("id, impact_weight, created_at, completed_at, started_at")
      .eq("status", "completed")
      .is("archived_at", null)
      // completed before today
      .lt("completed_at", `${today}T00:00:00.000Z`);

    if (fetchErr) {
      console.error("[daily-reset] fetch completed:", fetchErr);
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    }

    const completed = completedYesterday ?? [];

    // ── 2. Count carried-forward actions (pending/in_progress, not archived) ──
    const { count: carriedForward } = await supabase
      .from("actions")
      .select("id", { count: "exact", head: true })
      .is("archived_at", null)
      .in("status", ["pending", "in_progress"]);

    // ── 3. Count actions created yesterday ───────────────────────────────────
    const { count: createdYesterday } = await supabase
      .from("actions")
      .select("id", { count: "exact", head: true })
      .gte("created_at", `${yesterday}T00:00:00.000Z`)
      .lt("created_at", `${today}T00:00:00.000Z`);

    // ── 4. Compute avg resolution time in minutes ─────────────────────────────
    let avgResolutionMinutes: number | null = null;
    if (completed.length > 0) {
      const totalMs = completed.reduce((sum, a) => {
        if (!a.completed_at || !a.created_at) return sum;
        return sum + (new Date(a.completed_at).getTime() - new Date(a.created_at).getTime());
      }, 0);
      avgResolutionMinutes = Math.round(totalMs / completed.length / 60_000);
    }

    const completionRate =
      (createdYesterday ?? 0) > 0
        ? Math.round((completed.length / (createdYesterday ?? 1)) * 100 * 100) / 100
        : 0;

    const impactCount = (level: string) =>
      completed.filter((a) => a.impact_weight === level).length;

    // ── 5a. Snapshot live operating score ────────────────────────────────────
    let opsScoreValue: number | null = null;
    try {
      const scoreResult = await getOperatingScore(DEFAULT_SITE_ID);
      opsScoreValue = scoreResult.total;
    } catch {
      // Non-fatal — log but continue
      console.warn("[daily-reset] could not compute ops score");
    }

    // ── 5. Upsert daily stats for yesterday ───────────────────────────────────
    const { error: statsErr } = await supabase
      .from("action_daily_stats")
      .upsert({
        site_id:                DEFAULT_SITE_ID,
        stat_date:              yesterday,
        total_created:          createdYesterday ?? 0,
        total_completed:        completed.length,
        total_carried_forward:  carriedForward   ?? 0,
        completion_rate_pct:    completionRate,
        avg_resolution_minutes: avgResolutionMinutes,
        critical_completed:     impactCount("critical"),
        high_completed:         impactCount("high"),
        medium_completed:       impactCount("medium"),
        low_completed:          impactCount("low"),
        ops_score:              opsScoreValue,
        missed_actions:         carriedForward ?? 0,
      }, { onConflict: "site_id,stat_date" });

    if (statsErr) {
      console.error("[daily-reset] upsert stats:", statsErr);
      return NextResponse.json({ error: statsErr.message }, { status: 500 });
    }

    // ── 6. Archive completed actions ──────────────────────────────────────────
    const idsToArchive = completed.map((a) => a.id);
    if (idsToArchive.length > 0) {
      const { error: archiveErr } = await supabase
        .from("actions")
        .update({ archived_at: new Date().toISOString() })
        .in("id", idsToArchive);

      if (archiveErr) {
        console.error("[daily-reset] archive:", archiveErr);
        return NextResponse.json({ error: archiveErr.message }, { status: 500 });
      }
    }

    // ── 7. Auto-escalate aging actions ──────────────────────────────────────
    // Actions pending >24h with critical/high severity → auto-escalate
    const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: agingActions } = await supabase
      .from("actions")
      .select("id, title, impact_weight, status, created_at")
      .is("archived_at", null)
      .eq("status", "pending")
      .in("impact_weight", ["critical", "high"])
      .lt("created_at", cutoff24h);

    let autoEscalated = 0;
    if (agingActions && agingActions.length > 0) {
      const agingIds = agingActions.map((a) => a.id);
      const { error: escErr } = await supabase
        .from("actions")
        .update({
          status: "escalated",
          escalated_at: new Date().toISOString(),
        })
        .in("id", agingIds);

      if (!escErr) {
        autoEscalated = agingIds.length;
        // Write events for each escalated action
        const events = agingIds.map((id) => ({
          action_id: id,
          event_type: "escalated",
          actor: "system",
          notes: "Auto-escalated: pending >24h with critical/high severity",
        }));
        await (supabase.from("action_events" as any) as any).insert(events);
      }
    }

    // ── 8. Expire stale copilot decisions ──────────────────────────────────
    let expiredDecisions = 0;
    try {
      const { expireStaleDecisions } = await import("@/lib/copilot/decision-store");
      expiredDecisions = await expireStaleDecisions(DEFAULT_SITE_ID);
    } catch {}

    return NextResponse.json({
      success:          true,
      archived:         idsToArchive.length,
      carried_forward:  carriedForward ?? 0,
      auto_escalated:   autoEscalated,
      expired_decisions: expiredDecisions,
      stats: {
        date:                  yesterday,
        total_created:         createdYesterday ?? 0,
        total_completed:       completed.length,
        completion_rate_pct:   completionRate,
        avg_resolution_minutes: avgResolutionMinutes,
      },
    });
  } catch (err) {
    console.error("[daily-reset] unexpected:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
