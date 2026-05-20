/**
 * Streaks Engine
 *
 * Computes consecutive-day achievement streaks from action_daily_stats history.
 *
 * Three streak types:
 *   score_above_80     — N consecutive days with ops_score ≥ 80     🔥
 *   compliance_perfect — N consecutive days with no missed compliance 🔴→✅
 *   no_critical        — N consecutive days with 0 critical actions missed 🟢
 *
 * "Consecutive" means every stored row (oldest→newest), stopping at the
 * first row that breaks the condition.  Gaps in the history are treated
 * as neutral (not a break) so a weekend without a reset doesn't kill a streak.
 */

import { createServerClient } from "@/lib/supabase/server";

// ── Types ─────────────────────────────────────────────────────────────────────

export type StreakType = "score_above_80" | "compliance_perfect" | "no_critical";

export interface Streak {
  type:    StreakType;
  count:   number;      // consecutive days
  active:  boolean;     // true if today/yesterday is still in the streak
  emoji:   string;
  label:   string;
}

export interface StreakSummary {
  streaks:    Streak[];
  best_score: number;   // highest single-day score in history
  avg_score:  number | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function countStreak<T extends { stat_date: string }>(
  rows: T[],
  predicate: (r: T) => boolean
): { count: number; active: boolean } {
  // Rows must be newest-first for "active" detection; we iterate from most recent
  let count  = 0;
  let active = false;
  for (let i = 0; i < rows.length; i++) {
    if (predicate(rows[i])) {
      count++;
      if (i === 0) active = true;
    } else {
      break;
    }
  }
  return { count, active };
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function getStreaks(): Promise<StreakSummary> {
  const supabase = createServerClient();

  const { data } = await supabase
    .from("action_daily_stats")
    .select("stat_date, ops_score, missed_actions, completion_rate_pct")
    .order("stat_date", { ascending: false })
    .limit(30);

  const rows = (data ?? []) as {
    stat_date:           string;
    ops_score:           number | null;
    missed_actions:      number;
    completion_rate_pct: number;
  }[];

  if (rows.length === 0) {
    return { streaks: [], best_score: 0, avg_score: null };
  }

  // Score above 80
  const s80 = countStreak(rows, (r) => (r.ops_score ?? 0) >= 80);

  // Compliance perfect = completion_rate_pct = 100%
  const sCompliance = countStreak(rows, (r) => r.completion_rate_pct >= 100);

  // No critical = 0 missed_actions (carried forward open actions)
  const sNoCritical = countStreak(rows, (r) => r.missed_actions === 0);

  const scoredRows  = rows.filter((r) => r.ops_score !== null);
  const best_score  = scoredRows.reduce((m, r) => Math.max(m, r.ops_score ?? 0), 0);
  const avg_score   = scoredRows.length > 0
    ? Math.round(scoredRows.reduce((s, r) => s + (r.ops_score ?? 0), 0) / scoredRows.length)
    : null;

  const streaks: Streak[] = [];

  if (s80.count >= 2) {
    streaks.push({
      type:   "score_above_80",
      count:  s80.count,
      active: s80.active,
      emoji:  "🔥",
      label:  `${s80.count} day${s80.count === 1 ? "" : "s"} above 80 score`,
    });
  }

  if (sCompliance.count >= 2) {
    streaks.push({
      type:   "compliance_perfect",
      count:  sCompliance.count,
      active: sCompliance.active,
      emoji:  "✅",
      label:  `${sCompliance.count} day${sCompliance.count === 1 ? "" : "s"} all actions completed`,
    });
  }

  if (sNoCritical.count >= 2) {
    streaks.push({
      type:   "no_critical",
      count:  sNoCritical.count,
      active: sNoCritical.active,
      emoji:  "🟢",
      label:  `${sNoCritical.count} day${sNoCritical.count === 1 ? "" : "s"} no missed actions`,
    });
  }

  return { streaks, best_score, avg_score };
}
