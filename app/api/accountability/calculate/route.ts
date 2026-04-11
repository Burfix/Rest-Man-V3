/**
 * POST /api/accountability/calculate
 *   Body: { siteId?, date?, backfill? }
 *   Calculates daily scores for one site or all sites.
 *   If backfill=true, loops from 2026-03-31 to yesterday.
 *
 * GET  /api/accountability/calculate?siteId=xxx&limit=30
 *   Returns manager_performance_scores with profile info.
 *
 * Vercel cron fires GET at 01:00 UTC daily (03:00 SAST).
 */

import * as Sentry from "@sentry/nextjs";
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import {
  calculateDailyScores,
  calculateAllSitesScores,
} from "@/services/accountability/score-calculator";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── POST: trigger score calculation ─────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Auth: CRON_SECRET or apiGuard
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  const isCron = cronSecret && authHeader === `Bearer ${cronSecret}`;

  if (!isCron) {
    // Fallback: require signed-in user with elevated role
    try {
      const { apiGuard } = await import("@/lib/auth/api-guard");
      const { PERMISSIONS } = await import("@/lib/rbac/roles");
      const guard = await apiGuard(PERMISSIONS.VIEW_FINANCIALS, "POST /api/accountability/calculate");
      if (guard.error) return guard.error;
    } catch {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine — defaults apply
  }

  const { siteId, date, backfill } = body as {
    siteId?: string;
    date?: string;
    backfill?: boolean;
  };

  try {
    // ── Backfill mode: loop dates from 2026-03-31 to yesterday ──────────
    if (backfill) {
      const start = new Date("2026-03-31");
      const end = yesterdaySAST();
      const endDate = new Date(end);
      const allErrors: string[] = [];
      let totalScores = 0;
      let totalSites = 0;

      const d = new Date(start);
      while (d <= endDate) {
        const dateStr = d.toISOString().slice(0, 10);
        logger.info(`[backfill] Calculating scores for ${dateStr}`);

        if (siteId) {
          try {
            const written = await calculateDailyScores(siteId, dateStr);
            totalScores += written;
            totalSites++;
          } catch (err: any) {
            allErrors.push(`${dateStr}: ${err.message}`);
          }
        } else {
          const r = await calculateAllSitesScores(dateStr);
          totalScores += r.scoresWritten;
          totalSites += r.sitesProcessed;
          allErrors.push(...r.errors);
        }

        d.setDate(d.getDate() + 1);
      }

      return NextResponse.json({
        success: true,
        backfill: true,
        from: start.toISOString().slice(0, 10),
        to: end,
        sitesProcessed: totalSites,
        scoresWritten: totalScores,
        errors: allErrors,
      });
    }

    // ── Single date mode ────────────────────────────────────────────────
    if (siteId) {
      const resolvedDate = date ?? yesterdaySAST();
      const written = await calculateDailyScores(siteId, resolvedDate);
      return NextResponse.json({
        success: true,
        date: resolvedDate,
        sitesProcessed: 1,
        scoresWritten: written,
        errors: [],
      });
    }

    // ── All sites ────────────────────────────────────────────────────────
    const result = await calculateAllSitesScores(date);
    return NextResponse.json({
      success: true,
      date: date ?? yesterdaySAST(),
      ...result,
    });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { route: "POST /api/accountability/calculate" },
    });
    return NextResponse.json(
      { success: false, error: String(err) },
      { status: 500 },
    );
  }
}

// ── GET: read scores (also serves as Vercel cron entry) ─────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const siteId = searchParams.get("siteId");
  const limitParam = searchParams.get("limit");

  // If no siteId → this is likely the cron trigger
  if (!siteId) {
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = req.headers.get("authorization");
    const isCron = cronSecret && authHeader === `Bearer ${cronSecret}`;

    if (isCron) {
      // Cron: calculate yesterday's scores for all sites
      try {
        const result = await calculateAllSitesScores();
        logger.info(
          `[cron] Accountability scores: ${result.scoresWritten} scores across ${result.sitesProcessed} sites`,
        );
        return NextResponse.json({ success: true, ...result });
      } catch (err) {
        Sentry.captureException(err, {
          tags: { route: "GET /api/accountability/calculate", trigger: "cron" },
        });
        return NextResponse.json(
          { success: false, error: String(err) },
          { status: 500 },
        );
      }
    }

    return NextResponse.json(
      { error: "siteId query parameter is required" },
      { status: 400 },
    );
  }

  // Auth: require signed-in user
  try {
    const { apiGuard } = await import("@/lib/auth/api-guard");
    const { PERMISSIONS } = await import("@/lib/rbac/roles");
    const guard = await apiGuard(PERMISSIONS.VIEW_OWN_STORE, "GET /api/accountability/calculate");
    if (guard.error) return guard.error;
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = Math.min(Math.max(parseInt(limitParam ?? "30", 10) || 30, 1), 100);
  const supabase = createServerClient() as any;

  // Fetch scores with profile join
  const { data: scores, error } = await supabase
    .from("manager_performance_scores")
    .select(
      "id, user_id, site_id, period_date, tasks_assigned, tasks_completed, " +
      "tasks_on_time, tasks_late, tasks_blocked, tasks_escalated, " +
      "completion_rate, on_time_rate, avg_completion_minutes, score, " +
      "created_at, updated_at",
    )
    .eq("site_id", siteId)
    .order("period_date", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const scoreList = (scores ?? []) as any[];

  // Resolve user profiles
  const userIds = Array.from(new Set(scoreList.map((s: any) => s.user_id))) as string[];
  let profileMap = new Map<string, { full_name: string | null; email: string }>();

  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", userIds);
    profileMap = new Map(
      (profiles ?? []).map((p: any) => [p.id, { full_name: p.full_name, email: p.email }]),
    );
  }

  const enriched = scoreList.map((s: any) => {
    const profile = profileMap.get(s.user_id);
    return {
      ...s,
      full_name: profile?.full_name ?? null,
      email: profile?.email ?? null,
    };
  });

  // Period range from the returned data
  const dates = scoreList.map((s: any) => s.period_date).sort();
  const period = dates.length > 0
    ? { from: dates[0], to: dates[dates.length - 1] }
    : { from: null, to: null };

  return NextResponse.json({ scores: enriched, period });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function yesterdaySAST(): string {
  const now = new Date();
  const sast = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  sast.setDate(sast.getDate() - 1);
  return sast.toISOString().slice(0, 10);
}
