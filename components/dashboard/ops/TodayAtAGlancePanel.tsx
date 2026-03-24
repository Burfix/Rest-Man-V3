/**
 * TodayAtAGlancePanel — Left column of the Operating Brain cockpit.
 *
 * Shows the GM's operating posture in 10 seconds:
 * - Operating grade + score
 * - Risk level
 * - Shift mode
 * - Last sync
 * - One-sentence day summary
 */

import { cn } from "@/lib/utils";
import type { OperatingScore, ScoreGrade } from "@/services/ops/operatingScore";

interface Props {
  score:         OperatingScore | null;
  riskLevel:     "low" | "moderate" | "elevated" | "critical";
  servicePeriod: string;
  lastSync:      string;
  daySummary:    string;
}

const GRADE_STYLE: Record<ScoreGrade, { bg: string; text: string; ring: string }> = {
  A: { bg: "bg-emerald-50 dark:bg-emerald-950/30", text: "text-emerald-600 dark:text-emerald-400", ring: "ring-emerald-400/50" },
  B: { bg: "bg-lime-50 dark:bg-lime-950/30",       text: "text-lime-600 dark:text-lime-400",       ring: "ring-lime-400/50" },
  C: { bg: "bg-amber-50 dark:bg-amber-950/30",     text: "text-amber-600 dark:text-amber-400",     ring: "ring-amber-400/50" },
  D: { bg: "bg-orange-50 dark:bg-orange-950/30",    text: "text-orange-600 dark:text-orange-400",   ring: "ring-orange-400/50" },
  F: { bg: "bg-red-50 dark:bg-red-950/30",          text: "text-red-600 dark:text-red-400",         ring: "ring-red-500/50" },
};

const RISK_CONFIG: Record<string, { dot: string; label: string; text: string }> = {
  low:      { dot: "bg-emerald-500", label: "Low Risk",      text: "text-emerald-600 dark:text-emerald-500" },
  moderate: { dot: "bg-amber-500",   label: "Moderate Risk",  text: "text-amber-600 dark:text-amber-500" },
  elevated: { dot: "bg-orange-500",  label: "Elevated Risk", text: "text-orange-600 dark:text-orange-400" },
  critical: { dot: "bg-red-500",     label: "Critical Risk", text: "text-red-600 dark:text-red-400" },
};

export default function TodayAtAGlancePanel({ score, riskLevel, servicePeriod, lastSync, daySummary }: Props) {
  const grade = score?.grade ?? "C";
  const gs = GRADE_STYLE[grade];
  const risk = RISK_CONFIG[riskLevel] ?? RISK_CONFIG.low;

  return (
    <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-4 sm:p-6 flex flex-col gap-4 sm:gap-5">
      {/* Section label */}
      <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400 dark:text-stone-600">
        Today at a Glance
      </p>

      {/* Grade + Score */}
      <div className="flex items-center gap-3 sm:gap-4">
        <div className={cn(
          "h-14 w-14 sm:h-16 sm:w-16 shrink-0 rounded-full ring-4 flex flex-col items-center justify-center",
          gs.ring, gs.bg
        )}>
          <span className={cn("text-xl sm:text-2xl font-black tabular-nums leading-none", gs.text)}>
            {score?.total ?? "—"}
          </span>
          <span className="text-[9px] font-semibold text-stone-400 dark:text-stone-600 mt-0.5">/100</span>
        </div>
        <div>
          <p className={cn("text-sm font-bold", gs.text)}>
            Grade {grade}
          </p>
          <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
            Operating Score
          </p>
        </div>
      </div>

      {/* Risk + Shift + Sync */}
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center gap-2">
          <span className={cn("h-2 w-2 rounded-full shrink-0", risk.dot)} />
          <span className={cn("text-xs font-semibold", risk.text)}>
            {risk.label}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full shrink-0 bg-blue-500 dark:bg-blue-400" />
          <span className="text-xs font-semibold text-stone-600 dark:text-stone-400">
            {servicePeriod} Service
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full shrink-0 bg-stone-300 dark:bg-stone-600" />
          <span className="text-[11px] text-stone-400 dark:text-stone-500">
            Last sync {lastSync}
          </span>
        </div>
      </div>

      {/* Day summary */}
      <p className="text-sm text-stone-700 dark:text-stone-300 leading-relaxed border-t border-stone-100 dark:border-stone-800 pt-4">
        {daySummary}
      </p>
    </div>
  );
}
