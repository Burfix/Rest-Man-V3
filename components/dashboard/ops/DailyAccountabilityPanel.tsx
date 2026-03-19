/**
 * DailyAccountabilityPanel
 *
 * Compact accountability strip for the main dashboard.
 * Shows actions completed, missed, live ops score and performance rating.
 *
 * Data: most recent action_daily_stats row + live count of open/closed actions.
 * Falls back gracefully when no data is available.
 */

import { createServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import type { ScoreGrade } from "@/services/ops/operatingScore";

// ── Data fetch ────────────────────────────────────────────────────────────────

interface AccountabilityData {
  completed_today:     number;
  open_now:            number;
  ops_score:           number | null;
  grade:               ScoreGrade | null;
  streak_days:         number;   // consecutive days score ≥ 80
}

async function getAccountabilityData(): Promise<AccountabilityData> {
  const supabase = createServerClient();
  const today    = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });

  const [completedRes, openRes, historyRes] = await Promise.allSettled([
    supabase
      .from("actions")
      .select("id", { count: "exact", head: true })
      .gte("completed_at", `${today}T00:00:00.000Z`)
      .not("completed_at", "is", null),

    supabase
      .from("actions")
      .select("id", { count: "exact", head: true })
      .is("archived_at", null)
      .in("status", ["pending", "in_progress"]),

    supabase
      .from("action_daily_stats")
      .select("stat_date, ops_score, completion_rate_pct")
      .order("stat_date", { ascending: false })
      .limit(30),
  ]);

  const completed_today = completedRes.status === "fulfilled" ? (completedRes.value.count ?? 0) : 0;
  const open_now         = openRes.status      === "fulfilled" ? (openRes.value.count      ?? 0) : 0;

  const historyRows = (
    historyRes.status === "fulfilled" ? (historyRes.value.data ?? []) : []
  ) as { stat_date: string; ops_score: number | null; completion_rate_pct: number }[];

  // Most recent stored score
  const latest     = historyRows[0] ?? null;
  const ops_score  = latest?.ops_score ?? null;

  // Compute grade
  const grade: ScoreGrade | null =
    ops_score == null ? null :
    ops_score >= 85   ? "A" :
    ops_score >= 70   ? "B" :
    ops_score >= 55   ? "C" :
    ops_score >= 40   ? "D" : "F";

  // Streak: consecutive days with score ≥ 80
  let streak_days = 0;
  for (const row of historyRows) {
    if ((row.ops_score ?? 0) >= 80) streak_days++;
    else break;
  }

  return { completed_today, open_now, ops_score, grade, streak_days };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const GRADE_STYLE: Record<ScoreGrade, { text: string; badge: string; label: string }> = {
  A: { text: "text-emerald-600 dark:text-emerald-400", badge: "bg-emerald-600 text-white",          label: "Excellent"         },
  B: { text: "text-lime-600 dark:text-lime-400",       badge: "bg-lime-600 text-white",             label: "Good"              },
  C: { text: "text-amber-600 dark:text-amber-400",     badge: "bg-amber-500 text-white",            label: "Needs Action"      },
  D: { text: "text-orange-600 dark:text-orange-400",   badge: "bg-orange-600 text-white",           label: "At Risk"           },
  F: { text: "text-red-600 dark:text-red-400",         badge: "bg-red-600 text-white",              label: "Critical"          },
};

// ── Component ─────────────────────────────────────────────────────────────────

export default async function DailyAccountabilityPanel() {
  const data = await getAccountabilityData();

  const { completed_today, open_now, ops_score, grade, streak_days } = data;
  const gradeStyle = grade ? GRADE_STYLE[grade] : null;

  return (
    <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-stone-100 dark:border-stone-800">
        <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400 dark:text-stone-600">
          Daily Accountability
        </p>
        {streak_days >= 2 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 dark:bg-amber-900/30 px-2.5 py-px text-[10px] font-bold text-amber-700 dark:text-amber-400 ring-1 ring-amber-200 dark:ring-amber-700">
            🔥 {streak_days}-day streak above 80
          </span>
        )}
      </div>

      {/* Stat row */}
      <div className="grid grid-cols-4 divide-x divide-stone-100 dark:divide-stone-800">

        {/* Completed */}
        <div className="flex flex-col items-center justify-center px-4 py-4 gap-0.5">
          <span className={cn(
            "text-2xl font-black tabular-nums",
            completed_today > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-stone-300 dark:text-stone-600"
          )}>
            {completed_today}
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-stone-400 dark:text-stone-600 text-center">
            Completed
          </span>
        </div>

        {/* Open / Missed */}
        <div className="flex flex-col items-center justify-center px-4 py-4 gap-0.5">
          <span className={cn(
            "text-2xl font-black tabular-nums",
            open_now > 0 ? "text-red-500 dark:text-red-400" : "text-stone-300 dark:text-stone-600"
          )}>
            {open_now}
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-stone-400 dark:text-stone-600 text-center">
            {open_now > 0 ? "Requires Action" : "None Open"}
          </span>
        </div>

        {/* Ops Score */}
        <div className="flex flex-col items-center justify-center px-4 py-4 gap-0.5">
          <span className={cn(
            "text-2xl font-black tabular-nums",
            gradeStyle?.text ?? "text-stone-300 dark:text-stone-600"
          )}>
            {ops_score != null ? ops_score : "—"}
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-stone-400 dark:text-stone-600 text-center">
            Ops Score
          </span>
        </div>

        {/* Rating */}
        <div className="flex flex-col items-center justify-center px-4 py-4 gap-1.5">
          {grade && gradeStyle ? (
            <>
              <span className={cn("rounded-md px-2.5 py-0.5 text-sm font-black", gradeStyle.badge)}>
                {grade}
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-stone-400 dark:text-stone-600 text-center">
                {gradeStyle.label}
              </span>
            </>
          ) : (
            <>
              <span className="text-2xl font-black text-stone-300 dark:text-stone-600">—</span>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-stone-400 dark:text-stone-600 text-center">
                Rating
              </span>
            </>
          )}
        </div>

      </div>

    </div>
  );
}
