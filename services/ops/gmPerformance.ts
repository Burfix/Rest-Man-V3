/**
 * GM Performance Service
 *
 * Returns a personal performance view for the General Manager:
 *   - Today's operating score + grade
 *   - Last 14 days of daily scores for sparkline / trend
 *   - Week-over-week delta (avg last 7 vs avg previous 7)
 *   - Trend direction: "up" | "down" | "flat"
 *
 * No new migration required — reads from action_daily_stats.
 */

import { createServerClient } from "@/lib/supabase/server";
import { getOperatingScore } from "./operatingScore";
import type { ScoreGrade } from "./operatingScore";

const DEFAULT_SITE_ID = "00000000-0000-0000-0000-000000000001";
const FLAT_THRESHOLD  = 2; // ±2 pts = flat

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GMDayScore {
  date:  string;
  score: number | null;
}

export type ScoreTrend = "up" | "down" | "flat" | null;

export interface GMPerformance {
  today_score:    number | null;
  today_grade:    ScoreGrade | null;
  weekly_scores:  GMDayScore[];   // last 7 stored days (newest-first)
  weekly_avg:     number | null;
  week_over_week: number | null;  // delta vs previous 7-day avg (positive = improving)
  trend:          ScoreTrend;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function getGMPerformance(): Promise<GMPerformance> {
  const supabase = createServerClient();

  const [historyRes, scoreRes] = await Promise.allSettled([
    supabase
      .from("action_daily_stats")
      .select("stat_date, ops_score")
      .order("stat_date", { ascending: false })
      .limit(14),

    getOperatingScore(DEFAULT_SITE_ID),
  ]);

  // Today's live score
  const today_score = scoreRes.status === "fulfilled" ? (scoreRes.value?.total ?? null) : null;
  const today_grade = scoreRes.status === "fulfilled" ? (scoreRes.value?.grade ?? null) : null;

  // Historical rows
  const rawRows = (
    historyRes.status === "fulfilled" ? (historyRes.value.data ?? []) : []
  ) as { stat_date: string; ops_score: number | null }[];

  const rows: GMDayScore[] = rawRows.map((r) => ({
    date:  r.stat_date,
    score: r.ops_score,
  }));

  const last7  = rows.slice(0, 7);
  const prev7  = rows.slice(7, 14);

  function avg(arr: GMDayScore[]): number | null {
    const valid = arr.map((r) => r.score).filter((s): s is number => s !== null);
    return valid.length ? valid.reduce((s, n) => s + n, 0) / valid.length : null;
  }

  const weekly_avg      = avg(last7);
  const prev_avg        = avg(prev7);
  const week_over_week  = weekly_avg !== null && prev_avg !== null ? weekly_avg - prev_avg : null;

  let trend: ScoreTrend = null;
  if (week_over_week !== null) {
    trend =
      week_over_week > FLAT_THRESHOLD  ? "up"   :
      week_over_week < -FLAT_THRESHOLD ? "down" :
      "flat";
  }

  return {
    today_score,
    today_grade,
    weekly_scores:  last7,
    weekly_avg,
    week_over_week,
    trend,
  };
}
