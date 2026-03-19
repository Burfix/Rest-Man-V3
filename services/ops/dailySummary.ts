/**
 * Daily Ops Summary Service
 *
 * Returns a time-aware brief for the ops team:
 *   Morning (before 14:00 SAST) → top 3 priorities from open actions
 *   Evening (14:00+ SAST)       → completed / missed / live score + 7-day history
 */

import { createServerClient } from "@/lib/supabase/server";
import { getOperatingScore } from "./operatingScore";
import type { OperatingScore } from "./operatingScore";

const DEFAULT_SITE_ID = "00000000-0000-0000-0000-000000000001";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ActionPriority {
  id:             string;
  title:          string;
  description:    string | null;
  impact_weight:  string;
  status:         string;
  assigned_to:    string | null;
  execution_type: string | null;
}

export interface DailyHistoryRow {
  stat_date:           string;
  total_completed:     number;
  missed_actions:      number;
  ops_score:           number | null;
  completion_rate_pct: number;
}

export interface MorningBrief {
  mode:  "morning";
  date:  string;
  top3:  ActionPriority[];
  total_open: number;
}

export interface EveningDebrief {
  mode:            "evening";
  date:            string;
  completed_today: number;
  missed_today:    number;
  ops_score:       OperatingScore | null;
  history:         DailyHistoryRow[];
}

export type DailyOpsSummary = MorningBrief | EveningDebrief;

// ── Helpers ───────────────────────────────────────────────────────────────────

function isMorningJHB(): boolean {
  const jhb = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Africa/Johannesburg" })
  );
  return jhb.getHours() < 14;
}

function todayJHB(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
}

const IMPACT_ORDER: Record<string, number> = {
  critical: 0, high: 1, medium: 2, low: 3,
};
const STATUS_ORDER: Record<string, number> = {
  in_progress: 0, pending: 1,
};

// ── Main export ───────────────────────────────────────────────────────────────

export async function getDailyOpsSummary(): Promise<DailyOpsSummary> {
  const today = todayJHB();

  if (isMorningJHB()) {
    return getMorningBrief(today);
  }
  return getEveningDebrief(today);
}

async function getMorningBrief(today: string): Promise<MorningBrief> {
  const supabase = createServerClient();

  const { data } = await supabase
    .from("actions")
    .select("id, title, description, impact_weight, status, assigned_to, execution_type")
    .is("archived_at", null)
    .in("status", ["pending", "in_progress"])
    .limit(50);

  const all = (data ?? []) as ActionPriority[];

  // Sort: in_progress first, then by impact weight
  const sorted = [...all].sort((a, b) => {
    const sd = (STATUS_ORDER[a.status] ?? 2) - (STATUS_ORDER[b.status] ?? 2);
    if (sd !== 0) return sd;
    return (IMPACT_ORDER[a.impact_weight] ?? 4) - (IMPACT_ORDER[b.impact_weight] ?? 4);
  });

  return {
    mode:       "morning",
    date:       today,
    top3:       sorted.slice(0, 3),
    total_open: all.length,
  };
}

async function getEveningDebrief(today: string): Promise<EveningDebrief> {
  const supabase = createServerClient();

  const [completedRes, missedRes, historyRes, scoreRes] = await Promise.allSettled([
    // Completed today
    supabase
      .from("actions")
      .select("id", { count: "exact", head: true })
      .gte("completed_at", `${today}T00:00:00.000Z`)
      .not("completed_at", "is", null),

    // Still open (missed / carried forward)
    supabase
      .from("actions")
      .select("id", { count: "exact", head: true })
      .is("archived_at", null)
      .in("status", ["pending", "in_progress"]),

    // Last 7 days of stored history
    supabase
      .from("action_daily_stats")
      .select("stat_date, total_completed, missed_actions, ops_score, completion_rate_pct")
      .order("stat_date", { ascending: false })
      .limit(7),

    // Live operating score
    getOperatingScore(DEFAULT_SITE_ID),
  ]);

  return {
    mode:            "evening",
    date:            today,
    completed_today: completedRes.status === "fulfilled" ? (completedRes.value.count ?? 0) : 0,
    missed_today:    missedRes.status    === "fulfilled" ? (missedRes.value.count    ?? 0) : 0,
    ops_score:       scoreRes.status     === "fulfilled" ? scoreRes.value : null,
    history:         historyRes.status   === "fulfilled"
      ? ((historyRes.value.data ?? []) as DailyHistoryRow[])
      : [],
  };
}
