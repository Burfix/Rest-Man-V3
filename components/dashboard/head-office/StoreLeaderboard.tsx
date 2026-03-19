/**
 * StoreLeaderboard
 *
 * Sorted ranked list of stores by operating score.
 * Top 3 highlighted with medal colors; bottom 3 flagged as needing attention.
 * Shows score delta vs the store directly above for competitive context.
 */

import { cn } from "@/lib/utils";
import type { StoreLeaderboardEntry } from "@/services/ops/headOffice";
import type { ScoreGrade } from "@/services/ops/operatingScore";

// ── Palettes ───────────────────────────────────────────────────────────────────

const RANK_MEDAL: Record<number, { icon: string; bg: string; text: string }> = {
  1: { icon: "🥇", bg: "bg-amber-50 dark:bg-amber-950/30",   text: "text-amber-700 dark:text-amber-300" },
  2: { icon: "🥈", bg: "bg-stone-50 dark:bg-stone-800/50",   text: "text-stone-600 dark:text-stone-300" },
  3: { icon: "🥉", bg: "bg-orange-50 dark:bg-orange-950/20", text: "text-orange-700 dark:text-orange-300" },
};

const GRADE_COLOR: Record<ScoreGrade, string> = {
  A: "bg-emerald-600",
  B: "bg-lime-600",
  C: "bg-amber-500",
  D: "bg-orange-600",
  F: "bg-red-600",
};

const RISK_DOT: Record<string, string> = {
  green:  "bg-emerald-500",
  yellow: "bg-amber-500",
  red:    "bg-red-500 animate-pulse",
};

// ── Main component ─────────────────────────────────────────────────────────────

interface Props {
  entries: StoreLeaderboardEntry[];
}

export default function StoreLeaderboard({ entries }: Props) {
  return (
    <section className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between border-b border-stone-100 dark:border-stone-800 px-5 py-3.5">
        <h2 className="text-xs font-bold uppercase tracking-widest text-stone-700 dark:text-stone-300">
          Store Leaderboard
        </h2>
        <span className="text-[10px] text-stone-400">{entries.length} stores</span>
      </div>

      {/* Rows */}
      <div className="divide-y divide-stone-100 dark:divide-stone-800">
        {entries.map((entry, idx) => {
          const medal  = RANK_MEDAL[entry.rank];
          const prev   = entries[idx - 1];
          const delta  = prev?.operating_score != null && entry.operating_score != null
            ? entry.operating_score - prev.operating_score
            : null;
          const grade  = entry.score_grade as ScoreGrade | null;

          return (
            <div
              key={entry.site_id}
              className={cn(
                "flex items-center gap-3 px-5 py-3 transition-colors hover:bg-stone-50 dark:hover:bg-stone-800/50",
                medal?.bg,
                entry.is_bottom && !medal && "bg-red-50/30 dark:bg-red-950/10"
              )}
            >
              {/* Rank */}
              <div className="w-8 shrink-0 text-center">
                {medal ? (
                  <span className="text-lg leading-none">{medal.icon}</span>
                ) : (
                  <span className={cn(
                    "text-xs font-black tabular-nums",
                    entry.is_bottom ? "text-red-500" : "text-stone-400"
                  )}>
                    #{entry.rank}
                  </span>
                )}
              </div>

              {/* Risk dot + name */}
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className={cn("h-2 w-2 rounded-full shrink-0", RISK_DOT[entry.risk_level])} />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-stone-900 dark:text-stone-100 truncate leading-tight">
                    {entry.name}
                  </p>
                  <p className="text-[10px] text-stone-400 dark:text-stone-500">{entry.city}</p>
                </div>
              </div>

              {/* Revenue */}
              <div className="hidden sm:block text-right shrink-0">
                <p className="text-[11px] font-semibold text-stone-600 dark:text-stone-400 tabular-nums">
                  {entry.sales_net_vat !== null
                    ? `R${Math.round(entry.sales_net_vat / 1000)}k`
                    : "—"}
                </p>
                {entry.revenue_gap_pct !== null && (
                  <p className={cn("text-[9px]", entry.revenue_gap_pct > 0 ? "text-amber-500" : "text-emerald-500")}>
                    {entry.revenue_gap_pct > 0 ? `▼${entry.revenue_gap_pct.toFixed(1)}%` : `▲${Math.abs(entry.revenue_gap_pct).toFixed(1)}%`}
                  </p>
                )}
              </div>

              {/* Score + delta */}
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-base font-black tabular-nums text-stone-900 dark:text-stone-100 leading-none">
                  {entry.operating_score ?? "—"}
                </span>
                {grade && (
                  <span className={cn("rounded px-1 py-px text-[9px] font-black text-white", GRADE_COLOR[grade])}>
                    {grade}
                  </span>
                )}
                {delta !== null && delta < 0 && idx > 0 && (
                  <span className="text-[9px] text-red-500 font-semibold">{delta}</span>
                )}
              </div>

              {/* Bottom warning */}
              {entry.is_bottom && (
                <span className="shrink-0 text-[9px] font-bold text-red-500 uppercase tracking-wider">
                  ⚠ Review
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
