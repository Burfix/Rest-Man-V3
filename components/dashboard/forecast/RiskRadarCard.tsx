/**
 * RiskRadarCard — Operational risk overview
 */

"use client";

import { cn } from "@/lib/utils";
import type { RiskAssessment, RiskSeverity } from "@/types/forecast";

const SEV_CONFIG: Record<RiskSeverity, { label: string; bg: string; text: string; dot: string; bar: string }> = {
  low:      { label: "Low",      bg: "bg-emerald-50 dark:bg-emerald-950/30", text: "text-emerald-700 dark:text-emerald-400", dot: "bg-emerald-500", bar: "bg-emerald-400" },
  medium:   { label: "Medium",   bg: "bg-amber-50 dark:bg-amber-950/30",     text: "text-amber-700 dark:text-amber-400",     dot: "bg-amber-500",   bar: "bg-amber-400" },
  high:     { label: "High",     bg: "bg-orange-50 dark:bg-orange-950/30",   text: "text-orange-700 dark:text-orange-400",   dot: "bg-orange-500",  bar: "bg-orange-400" },
  critical: { label: "Critical", bg: "bg-red-50 dark:bg-red-950/30",         text: "text-red-700 dark:text-red-400",         dot: "bg-red-500",     bar: "bg-red-500" },
};

const TYPE_ICONS: Record<string, string> = {
  staffing:   "👥",
  compliance: "📋",
  maintenance: "🔧",
  service:    "🍽️",
  revenue:    "💰",
};

export default function RiskRadarCard({ risk }: { risk: RiskAssessment }) {
  const overall = SEV_CONFIG[risk.overallLevel];

  return (
    <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-red-50 dark:bg-red-950/50">
            <span className="text-sm">🛡️</span>
          </div>
          <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
            Risk Radar
          </h3>
        </div>
        <div className={cn("flex items-center gap-1.5 rounded-full px-2.5 py-1", overall.bg)}>
          <span className={cn("h-1.5 w-1.5 rounded-full", overall.dot)} />
          <span className={cn("text-[10px] font-semibold uppercase tracking-wider", overall.text)}>
            {overall.label}
          </span>
        </div>
      </div>

      {/* Risk score bar */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-stone-500 dark:text-stone-400">Risk Score</span>
          <span className="text-[10px] font-semibold text-stone-700 dark:text-stone-300">{risk.overallScore}/100</span>
        </div>
        <div className="h-2 rounded-full bg-stone-200 dark:bg-stone-700 overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all", overall.bar)}
            style={{ width: `${Math.min(100, risk.overallScore)}%` }}
          />
        </div>
      </div>

      {/* Individual risks */}
      {risk.risks.length === 0 ? (
        <p className="text-xs text-stone-500 dark:text-stone-400">
          No significant risks identified for today.
        </p>
      ) : (
        <div className="space-y-2.5">
          {risk.risks.map((r, i) => {
            const sev = SEV_CONFIG[r.severity];
            const icon = TYPE_ICONS[r.riskType] ?? "⚠️";
            return (
              <div
                key={i}
                className="rounded-lg border border-stone-100 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-800/30 p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 min-w-0">
                    <span className="text-sm mt-0.5 shrink-0">{icon}</span>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-stone-800 dark:text-stone-200">
                        {r.title}
                      </p>
                      <p className="text-[11px] text-stone-500 dark:text-stone-400 mt-0.5">
                        {r.description}
                      </p>
                    </div>
                  </div>
                  <span className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider",
                    sev.bg, sev.text,
                  )}>
                    {sev.label}
                  </span>
                </div>
                {r.recommendedAction && (
                  <p className="text-[11px] text-indigo-600 dark:text-indigo-400 mt-2 pl-6">
                    → {r.recommendedAction}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
