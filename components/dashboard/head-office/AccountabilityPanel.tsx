/**
 * AccountabilityPanel
 *
 * Per-store accountability table for the Head Office Control Tower.
 * Ranked by operating score — visually surfaces underperformers with
 * red highlight and a pulsing dot so attention is drawn immediately.
 *
 * Shows per store:
 *   • Rank + store name / city
 *   • Operating score + grade
 *   • Actions: completed / assigned
 *   • Completion % (progress bar)
 *   • Overdue count (red if > 0)
 *   • Performance signal (👑 | ⚠ | —)
 */

import { cn } from "@/lib/utils";
import type { StoreSummary } from "@/services/ops/headOffice";
import type { ScoreGrade } from "@/services/ops/operatingScore";

// ── Score color ──────────────────────────────────────────────────────────────

function scoreColor(score: number | null): string {
  if (score === null) return "text-stone-400";
  if (score >= 70)    return "text-emerald-600 dark:text-emerald-400";
  if (score >= 45)    return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

const GRADE_BG: Record<ScoreGrade, string> = {
  A: "bg-emerald-600",
  B: "bg-lime-600",
  C: "bg-amber-500",
  D: "bg-orange-600",
  F: "bg-red-600 animate-pulse",
};

// ── Mini completion bar ───────────────────────────────────────────────────────

function MiniBar({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-stone-300 dark:text-stone-700 text-[11px]">—</span>;
  const color =
    pct >= 80 ? "bg-emerald-500" :
    pct >= 50 ? "bg-amber-400"   :
               "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-stone-100 dark:bg-stone-800 overflow-hidden">
        <div className={cn("h-1.5 rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className={cn("text-[10px] font-bold tabular-nums w-7 text-right shrink-0", {
        "text-emerald-600 dark:text-emerald-400": pct >= 80,
        "text-amber-600 dark:text-amber-400":     pct >= 50,
        "text-red-600 dark:text-red-400":         pct <  50,
      })}>
        {pct}%
      </span>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface Props {
  stores: StoreSummary[];
}

export default function AccountabilityPanel({ stores }: Props) {
  // Sort by score descending; no-score stores go last
  const sorted = [...stores].sort(
    (a, b) => (b.operating_score ?? -1) - (a.operating_score ?? -1)
  );

  const underperformers = sorted.filter((s) => (s.operating_score ?? 100) < 55);
  const topPerformer    = sorted[0];

  return (
    <section className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between border-b border-stone-100 dark:border-stone-800 px-5 py-3.5">
        <h2 className="text-xs font-bold uppercase tracking-widest text-stone-700 dark:text-stone-300">
          Accountability
        </h2>
        <div className="flex items-center gap-2">
          {underperformers.length > 0 && (
            <span className="rounded-full bg-red-100 dark:bg-red-900/40 px-2.5 py-px text-[10px] font-bold text-red-700 dark:text-red-300">
              {underperformers.length} underperforming
            </span>
          )}
          <span className="text-[10px] text-stone-400">{stores.length} stores</span>
        </div>
      </div>

      {/* Column headers */}
      <div className="hidden sm:grid grid-cols-[1fr_64px_80px_100px_56px] gap-2 px-5 py-2 border-b border-stone-100 dark:border-stone-800 text-[9px] font-bold uppercase tracking-widest text-stone-400">
        <span>Store</span>
        <span className="text-center">Score</span>
        <span className="text-center">Actions</span>
        <span>Completion</span>
        <span className="text-center text-red-400">Overdue</span>
      </div>

      {/* Rows */}
      <div className="divide-y divide-stone-100 dark:divide-stone-800">
        {sorted.map((store, idx) => {
          const score      = store.operating_score;
          const grade      = store.score_grade as ScoreGrade | null;
          const isBottom   = (score ?? 100) < 55;
          const isTop      = idx === 0 && (score ?? 0) >= 70 && stores.length > 1;
          const overdueBad = store.actions_overdue > 0;

          return (
            <div
              key={store.site_id}
              className={cn(
                "grid grid-cols-[1fr_64px] sm:grid-cols-[1fr_64px_80px_100px_56px] items-center gap-2 px-5 py-3 transition-colors",
                isBottom ? "bg-red-50/50 dark:bg-red-950/10" :
                isTop    ? "bg-emerald-50/40 dark:bg-emerald-950/10" :
                           "hover:bg-stone-50 dark:hover:bg-stone-800/30"
              )}
            >
              {/* Store name */}
              <div className="flex items-center gap-2 min-w-0">
                {isBottom ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse shrink-0" />
                ) : isTop ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-stone-200 dark:bg-stone-700 shrink-0" />
                )}
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-stone-900 dark:text-stone-100 truncate leading-tight">
                    {store.name}
                  </p>
                  <p className="text-[10px] text-stone-400 dark:text-stone-500">{store.city}</p>
                </div>
                {/* Mobile: overdue badge */}
                {overdueBad && (
                  <span className="sm:hidden ml-auto shrink-0 rounded-full bg-red-100 dark:bg-red-900/40 px-1.5 py-px text-[9px] font-bold text-red-600 dark:text-red-400">
                    {store.actions_overdue} late
                  </span>
                )}
              </div>

              {/* Score + grade */}
              <div className="text-center">
                <span className={cn("text-sm font-black tabular-nums leading-none", scoreColor(score))}>
                  {score ?? "—"}
                </span>
                {grade && (
                  <span className={cn("ml-1 rounded px-1 py-px text-[9px] font-black text-white align-middle", GRADE_BG[grade])}>
                    {grade}
                  </span>
                )}
              </div>

              {/* Actions count — hidden on mobile */}
              <div className="hidden sm:block text-center">
                <span className="text-[11px] font-semibold text-stone-600 dark:text-stone-400 tabular-nums">
                  {store.actions_completed}<span className="text-stone-300 dark:text-stone-700">/</span>{store.actions_total}
                </span>
              </div>

              {/* Completion bar — hidden on mobile */}
              <div className="hidden sm:block">
                <MiniBar pct={store.actions_completion_pct} />
              </div>

              {/* Overdue — hidden on mobile */}
              <div className="hidden sm:block text-center">
                {store.actions_overdue > 0 ? (
                  <span className="text-sm font-black text-red-600 dark:text-red-400 tabular-nums">
                    {store.actions_overdue}
                  </span>
                ) : (
                  <span className="text-[11px] text-stone-300 dark:text-stone-700">—</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Underperformance callout banner */}
      {underperformers.length > 0 && (
        <div className="border-t border-red-100 dark:border-red-900/30 bg-red-50/60 dark:bg-red-950/10 px-5 py-2.5 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse shrink-0" />
          <p className="text-xs font-semibold text-red-700 dark:text-red-300">
            {underperformers.length === 1
              ? `${underperformers[0].name} is scoring below 55 — management review required.`
              : `${underperformers.length} stores scoring below 55 — management review required.`}
          </p>
        </div>
      )}

      {/* Top performer callout */}
      {topPerformer && (topPerformer.operating_score ?? 0) >= 85 && underperformers.length === 0 && (
        <div className="border-t border-emerald-100 dark:border-emerald-900/20 bg-emerald-50/50 dark:bg-emerald-950/10 px-5 py-2 flex items-center gap-2">
          <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
            👑 {topPerformer.name} leading the group — score {topPerformer.operating_score}
          </span>
        </div>
      )}
    </section>
  );
}
