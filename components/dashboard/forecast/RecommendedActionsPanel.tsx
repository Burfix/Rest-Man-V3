/**
 * RecommendedActionsPanel — Ranked operational recommendations
 */

"use client";

import { cn } from "@/lib/utils";
import type { GMActionRecommendation, ForecastPriority, RecommendationCategory } from "@/types/forecast";

const PRIORITY_CONFIG: Record<ForecastPriority, { label: string; bg: string; text: string }> = {
  urgent: { label: "Urgent",  bg: "bg-red-50 dark:bg-red-950/40",    text: "text-red-700 dark:text-red-400" },
  high:   { label: "High",    bg: "bg-orange-50 dark:bg-orange-950/40", text: "text-orange-700 dark:text-orange-400" },
  medium: { label: "Medium",  bg: "bg-amber-50 dark:bg-amber-950/40",   text: "text-amber-700 dark:text-amber-400" },
  low:    { label: "Low",     bg: "bg-stone-100 dark:bg-stone-800",      text: "text-stone-600 dark:text-stone-400" },
};

const CATEGORY_ICONS: Record<RecommendationCategory, string> = {
  staffing:    "👥",
  prep:        "🔪",
  promo:       "📣",
  compliance:  "📋",
  maintenance: "🔧",
  revenue:     "💰",
  service:     "🍽️",
};

export default function RecommendedActionsPanel({
  recommendations,
}: {
  recommendations: GMActionRecommendation[];
}) {
  if (recommendations.length === 0) {
    return (
      <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-5">
        <Header />
        <p className="text-xs text-stone-500 dark:text-stone-400 mt-3">
          No actions flagged for today. All operational areas are on track.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-5">
      <Header count={recommendations.length} />
      <div className="mt-4 space-y-3">
        {recommendations.map((rec, i) => (
          <ActionCard key={i} rec={rec} index={i} />
        ))}
      </div>
    </div>
  );
}

function Header({ count }: { count?: number }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-orange-50 dark:bg-orange-950/50">
          <span className="text-sm">⚡</span>
        </div>
        <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
          Recommended Actions
        </h3>
      </div>
      {count != null && (
        <span className="text-[10px] font-medium text-stone-500 dark:text-stone-400 bg-stone-100 dark:bg-stone-800 rounded-full px-2 py-0.5">
          {count} action{count !== 1 ? "s" : ""}
        </span>
      )}
    </div>
  );
}

function ActionCard({ rec, index }: { rec: GMActionRecommendation; index: number }) {
  const pri = PRIORITY_CONFIG[rec.priority];
  const icon = CATEGORY_ICONS[rec.category] ?? "📌";

  return (
    <div className="rounded-lg border border-stone-100 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-800/30 p-3.5 space-y-2">
      {/* Top row: category icon + title + priority badge */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <span className="text-sm mt-0.5 shrink-0">{icon}</span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-stone-800 dark:text-stone-200 leading-tight">
              {rec.title}
            </p>
            <span className="text-[10px] text-stone-500 dark:text-stone-500 capitalize">
              {rec.category}
            </span>
          </div>
        </div>
        <span className={cn(
          "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
          pri.bg, pri.text,
        )}>
          {pri.label}
        </span>
      </div>

      {/* Description */}
      <p className="text-[11px] leading-relaxed text-stone-600 dark:text-stone-400">
        {rec.description}
      </p>

      {/* Why + Impact */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-stone-100 dark:border-stone-700/50">
        <div>
          <span className="text-[9px] uppercase tracking-wider font-semibold text-stone-500 dark:text-stone-500">
            Why this matters
          </span>
          <p className="text-[11px] text-stone-600 dark:text-stone-400 mt-0.5">
            {rec.operationalReason}
          </p>
        </div>
        <div>
          <span className="text-[9px] uppercase tracking-wider font-semibold text-stone-500 dark:text-stone-500">
            Expected impact
          </span>
          <p className="text-[11px] text-stone-600 dark:text-stone-400 mt-0.5">
            {rec.expectedImpact}
          </p>
        </div>
      </div>
    </div>
  );
}
