"use client";

import type { FeatureAdoptionEntry } from "@/lib/adoption/types";
import { cn } from "@/lib/utils";

interface Props {
  entries: FeatureAdoptionEntry[];
}

// Friendly display names
const FEATURE_LABELS: Record<string, string> = {
  "actions":     "Actions",
  "compliance":  "Compliance",
  "labour":      "Labour",
  "profit":      "Profit Intelligence",
  "forecast":    "GM Co-Pilot",
  "maintenance": "Maintenance",
  "reviews":     "Reviews",
  "daily-ops":   "Daily Ops",
  "head-office": "Head Office",
  "alerts":      "Alerts",
};

// Color gradient based on adoption %
function barColor(pct: number): string {
  if (pct >= 80) return "bg-emerald-500 dark:bg-emerald-400";
  if (pct >= 60) return "bg-blue-500 dark:bg-blue-400";
  if (pct >= 40) return "bg-amber-500 dark:bg-amber-400";
  return "bg-red-400 dark:bg-red-500";
}

function pctLabel(pct: number): string {
  return `${pct.toFixed(0)}%`;
}

export default function FeatureAdoptionChart({ entries }: Props) {
  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-stone-200 dark:border-stone-700/60 bg-white dark:bg-stone-900 p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-stone-900 dark:text-stone-100">
          Feature Adoption
        </h3>
        <div className="flex h-24 items-center justify-center rounded-lg bg-stone-50 dark:bg-stone-800/40">
          <p className="text-xs text-stone-400">No feature usage data yet</p>
        </div>
      </div>
    );
  }

  // Ensure sorted descending by adoptionPct
  const sorted = [...entries].sort((a, b) => b.adoptionPct - a.adoptionPct);

  return (
    <div className="rounded-xl border border-stone-200 dark:border-stone-700/60 bg-white dark:bg-stone-900 p-5 shadow-sm">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
            Feature Adoption
          </h3>
          <p className="text-xs text-stone-400 dark:text-stone-600">
            % of active users who used each feature in the last 30 days
          </p>
        </div>
        <span className="text-xs text-stone-400 dark:text-stone-600">
          {sorted[0]?.totalActiveUsers ?? 0} active users
        </span>
      </div>

      <div className="space-y-3">
        {sorted.map((entry) => {
          const label = FEATURE_LABELS[entry.featureName] ?? entry.featureName;
          const pct   = entry.adoptionPct;

          return (
            <div key={entry.featureName} className="group">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-stone-700 dark:text-stone-300">
                  {label}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-stone-400 dark:text-stone-600">
                    {entry.usersCount} users · {entry.totalEvents} events
                  </span>
                  <span
                    className={cn(
                      "text-xs font-bold tabular-nums",
                      pct >= 60
                        ? "text-emerald-600 dark:text-emerald-400"
                        : pct >= 40
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-red-500 dark:text-red-400",
                    )}
                  >
                    {pctLabel(pct)}
                  </span>
                </div>
              </div>

              {/* Bar */}
              <div className="h-2 w-full overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
                <div
                  className={cn("h-full rounded-full transition-all duration-500", barColor(pct))}
                  style={{ width: `${Math.max(pct, 1)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-stone-100 dark:border-stone-800 pt-3">
        {[
          { color: "bg-emerald-500", label: "≥ 80% Strong" },
          { color: "bg-blue-500",    label: "60–79% Good" },
          { color: "bg-amber-500",   label: "40–59% Fair" },
          { color: "bg-red-400",     label: "< 40% Low" },
        ].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-1.5">
            <span className={cn("inline-block h-2 w-2 rounded-full", color)} />
            <span className="text-[10px] text-stone-400 dark:text-stone-600">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
