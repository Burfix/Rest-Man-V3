/**
 * GET /api/accountability/site-trend?siteId=xxx&days=30
 * Returns daily averaged scores for a site over the last N days.
 * Used by the SiteTrendPanel drill-down chart.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/rbac/roles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* eslint-disable @typescript-eslint/no-explicit-any */

function gradeFromScore(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 65) return "C";
  if (score >= 50) return "D";
  return "F";
}

function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" });
}

export async function GET(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.VIEW_OWN_STORE, "GET /api/accountability/site-trend");
  if (guard.error) return guard.error;

  const { searchParams } = new URL(req.url);
  const siteId = searchParams.get("siteId");
  const days   = Math.min(Math.max(parseInt(searchParams.get("days") ?? "30", 10) || 30, 1), 90);

  if (!siteId) {
    return NextResponse.json({ error: "siteId is required" }, { status: 400 });
  }

  const supabase = createServerClient() as any;

  // ── Site name ────────────────────────────────────────────────────────────
  const { data: siteRow } = await supabase
    .from("sites")
    .select("id, name")
    .eq("id", siteId)
    .single();

  if (!siteRow) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }

  // ── Trend query — daily avg across all GMs at the site ──────────────────
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().slice(0, 10);

  const { data: rows, error } = await supabase
    .from("manager_performance_scores")
    .select(
      "period_date, score, completion_rate, on_time_rate, tasks_assigned, tasks_completed",
    )
    .eq("site_id", siteId)
    .gte("period_date", sinceStr)
    .order("period_date", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Group by period_date (aggregate multiple GMs per day)
  const grouped = new Map<string, {
    scores: number[];
    completionRates: number[];
    onTimeRates: number[];
    tasksAssigned: number;
    tasksCompleted: number;
  }>();

  for (const r of (rows ?? []) as any[]) {
    const date = r.period_date;
    if (!grouped.has(date)) {
      grouped.set(date, { scores: [], completionRates: [], onTimeRates: [], tasksAssigned: 0, tasksCompleted: 0 });
    }
    const g = grouped.get(date)!;
    g.scores.push(r.score);
    g.completionRates.push(Number(r.completion_rate));
    g.onTimeRates.push(Number(r.on_time_rate));
    g.tasksAssigned  += r.tasks_assigned  ?? 0;
    g.tasksCompleted += r.tasks_completed ?? 0;
  }

  const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const round1 = (n: number) => Math.round(n * 10) / 10;

  const trend = Array.from(grouped.entries()).map(([date, g]) => {
    const score = Math.round(avg(g.scores));
    return {
      date,
      displayDate: formatDate(date),
      score,
      grade:          gradeFromScore(score),
      completionRate: round1(avg(g.completionRates)),
      onTimeRate:     round1(avg(g.onTimeRates)),
      tasksAssigned:  g.tasksAssigned,
      tasksCompleted: g.tasksCompleted,
    };
  });

  // Summary
  const scores = trend.map((t) => t.score);
  const avgScore = scores.length > 0 ? Math.round(avg(scores)) : 0;
  const bestDay  = trend.reduce((a, b) => (a.score >= b.score ? a : b), trend[0] ?? { date: "", score: 0 });
  const worstDay = trend.reduce((a, b) => (a.score <= b.score ? a : b), trend[0] ?? { date: "", score: 0 });

  return NextResponse.json({
    site: { id: siteRow.id, name: siteRow.name },
    trend,
    summary: {
      avgScore,
      bestDay:   { date: bestDay?.date,  score: bestDay?.score },
      worstDay:  { date: worstDay?.date, score: worstDay?.score },
      totalDays: trend.length,
    },
  });
}
