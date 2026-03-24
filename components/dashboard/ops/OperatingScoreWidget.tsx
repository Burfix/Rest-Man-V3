/**
 * OperatingScoreWidget
 *
 * Large live Operating Score (0–100) with colour-coded grade,
 * four component breakdown bars and a single-line status copy.
 *
 * Used at the top of the Operations Command dashboard so the GM
 * immediately sees the venue's operational health number.
 */

import { cn } from "@/lib/utils";
import type { OperatingScore, ScoreGrade } from "@/services/ops/operatingScore";
import type { SalesFreshnessState } from "@/lib/sales/types";

// ── Score palette ─────────────────────────────────────────────────────────────

const SCORE_PALETTE: Record<ScoreGrade, {
  ring:    string;
  number:  string;
  grade:   string;
  label:   string;
  bg:      string;
}> = {
  A: {
    ring:   "ring-emerald-400",
    number: "text-emerald-600 dark:text-emerald-400",
    grade:  "bg-emerald-600 text-white",
    label:  "Excellent",
    bg:     "bg-emerald-50 dark:bg-emerald-950/20",
  },
  B: {
    ring:   "ring-lime-400",
    number: "text-lime-600 dark:text-lime-400",
    grade:  "bg-lime-600 text-white",
    label:  "Strong",
    bg:     "bg-lime-50 dark:bg-lime-950/20",
  },
  C: {
    ring:   "ring-amber-400",
    number: "text-amber-600 dark:text-amber-400",
    grade:  "bg-amber-500 text-white",
    label:  "Needs Attention",
    bg:     "bg-amber-50 dark:bg-amber-950/20",
  },
  D: {
    ring:   "ring-orange-400",
    number: "text-orange-600 dark:text-orange-400",
    grade:  "bg-orange-600 text-white",
    label:  "At Risk",
    bg:     "bg-orange-50 dark:bg-orange-950/20",
  },
  F: {
    ring:   "ring-red-500 animate-pulse",
    number: "text-red-600 dark:text-red-400",
    grade:  "bg-red-600 text-white",
    label:  "Critical — Act Now",
    bg:     "bg-red-50 dark:bg-red-950/20",
  },
};

// ── Component bars config ─────────────────────────────────────────────────────

const COMPONENT_BARS = [
  { key: "revenue",        label: "Revenue",     max: 20, bar: "bg-emerald-500 dark:bg-emerald-400" },
  { key: "labour",         label: "Labour",      max: 20, bar: "bg-sky-500 dark:bg-sky-400"         },
  { key: "food_cost",      label: "Food Cost",   max: 15, bar: "bg-orange-500 dark:bg-orange-400"   },
  { key: "compliance",     label: "Compliance",  max: 15, bar: "bg-violet-500 dark:bg-violet-400"   },
  { key: "inventory_risk", label: "Inventory",   max: 10, bar: "bg-rose-500 dark:bg-rose-400"       },
  { key: "maintenance",    label: "Maintenance", max: 10, bar: "bg-amber-500 dark:bg-amber-400"     },
  { key: "daily_ops",      label: "Daily Ops",   max: 10, bar: "bg-cyan-500 dark:bg-cyan-400"       },
] as const;

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  score: OperatingScore | null;
  salesSource?: {
    label: string;
    freshnessState: SalesFreshnessState;
    freshnessMinutes: number | null;
  } | null;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function OperatingScoreWidget({ score, salesSource }: Props) {
  if (!score) {
    return (
      <div className="flex items-center gap-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 px-5 py-4">
        <div className="h-16 w-16 shrink-0 rounded-full ring-4 ring-stone-200 dark:ring-stone-700 flex items-center justify-center">
          <span className="text-2xl font-bold text-stone-300 dark:text-stone-600">—</span>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-stone-400 dark:text-stone-600 mb-0.5">
            Operating Score
          </p>
          <p className="text-sm text-stone-500 dark:text-stone-500">
            Upload daily ops data to generate score
          </p>
        </div>
      </div>
    );
  }

  const palette = SCORE_PALETTE[score.grade];

  return (
    <div className={cn(
      "rounded-xl border border-stone-200 dark:border-stone-800 overflow-hidden",
      "bg-white dark:bg-stone-900"
    )}>

      {/* Header bar */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-stone-100 dark:border-stone-800">
        <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400 dark:text-stone-600">
          Operating Score
        </p>
        <span className={cn(
          "rounded-full px-2.5 py-px text-[10px] font-bold uppercase tracking-wide",
          palette.grade
        )}>
          Grade {score.grade} — {palette.label}
        </span>
      </div>

      {/* Score + breakdown */}
      <div className="flex items-center gap-5 px-5 py-4">

        {/* Big number */}
        <div className={cn(
          "h-20 w-20 shrink-0 rounded-full ring-4 flex flex-col items-center justify-center",
          palette.ring,
          palette.bg
        )}>
          <span className={cn("text-3xl font-black tabular-nums leading-none", palette.number)}>
            {score.total}
          </span>
          <span className="text-[10px] font-semibold text-stone-400 dark:text-stone-600 mt-0.5">
            /100
          </span>
        </div>

        {/* Component bars — 4+3 layout for 7 categories */}
        <div className="flex-1 grid grid-cols-4 gap-x-4 gap-y-2.5">
          {COMPONENT_BARS.map(({ key, label, max, bar }) => {
            const comp = score.components[key];
            const pct  = Math.round((comp.score / max) * 100);
            const isRevenue = key === "revenue";
            const srcBadge = isRevenue && salesSource;
            return (
              <div key={key}>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-500">
                    {label}
                  </span>
                  <span className="text-[10px] font-bold tabular-nums text-stone-700 dark:text-stone-300">
                    {comp.score}<span className="font-normal text-stone-400">/{max}</span>
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-stone-100 dark:bg-stone-800 overflow-hidden">
                  <div
                    className={cn("h-full rounded-full transition-all", bar)}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="mt-0.5 flex items-center gap-1">
                  <p className="text-[10px] text-stone-400 dark:text-stone-600 truncate" title={comp.detail}>
                    {comp.detail}
                  </p>
                  {srcBadge && (
                    <span className={cn(
                      "shrink-0 inline-flex items-center gap-0.5 rounded px-1 py-px text-[8px] font-bold uppercase tracking-wider",
                      salesSource.freshnessState === "live"
                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
                        : salesSource.freshnessState === "stale"
                        ? "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
                        : "bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-500"
                    )}>
                      {salesSource.freshnessState === "live" && (
                        <span className="h-1 w-1 rounded-full bg-emerald-500 animate-pulse" />
                      )}
                      {salesSource.label}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
