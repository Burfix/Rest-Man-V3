/**
 * GMBriefingCard — Today's Briefing headline card
 *
 * Shows: forecast sales, covers, avg spend, labour %, peak window,
 * risk level, confidence, top action.
 */

"use client";

import { cn, formatCurrency } from "@/lib/utils";
import type { GMBriefing } from "@/types/forecast";

const RISK_CONFIG = {
  low:      { label: "Low",      bg: "bg-emerald-50 dark:bg-emerald-950/40", text: "text-emerald-700 dark:text-emerald-400", dot: "bg-emerald-500" },
  medium:   { label: "Medium",   bg: "bg-amber-50 dark:bg-amber-950/40",     text: "text-amber-700 dark:text-amber-400",     dot: "bg-amber-500" },
  high:     { label: "High",     bg: "bg-orange-50 dark:bg-orange-950/40",   text: "text-orange-700 dark:text-orange-400",   dot: "bg-orange-500" },
  critical: { label: "Critical", bg: "bg-red-50 dark:bg-red-950/40",         text: "text-red-700 dark:text-red-400",         dot: "bg-red-500" },
};

const CONFIDENCE_CONFIG = {
  low:    { label: "Low",    bar: "w-1/3", color: "bg-red-400" },
  medium: { label: "Medium", bar: "w-2/3", color: "bg-amber-400" },
  high:   { label: "High",   bar: "w-full", color: "bg-emerald-400" },
};

export default function GMBriefingCard({ briefing }: { briefing: GMBriefing }) {
  const risk = RISK_CONFIG[briefing.riskLevel];
  const conf = CONFIDENCE_CONFIG[briefing.confidence];
  const topAction = briefing.recommendations[0];

  return (
    <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-5 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-indigo-50 dark:bg-indigo-950/50">
            <span className="text-base">🧭</span>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
              Today&apos;s Briefing
            </h2>
            <p className="text-[11px] text-stone-500 dark:text-stone-400">
              {new Date(briefing.forecastDate + "T12:00:00").toLocaleDateString("en-ZA", {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </p>
          </div>
        </div>

        {/* Risk badge */}
        <div className={cn("flex items-center gap-1.5 rounded-full px-2.5 py-1", risk.bg)}>
          <span className={cn("h-1.5 w-1.5 rounded-full", risk.dot)} />
          <span className={cn("text-[10px] font-semibold uppercase tracking-wider", risk.text)}>
            {risk.label} Risk
          </span>
        </div>
      </div>

      {/* Headline */}
      <p className="text-xs leading-relaxed text-stone-700 dark:text-stone-300">
        {briefing.headline}
      </p>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="Forecast Sales" value={formatCurrency(briefing.salesForecast)} />
        <Kpi label="Forecast Covers" value={String(briefing.coversForecast)} />
        <Kpi label="Avg Spend" value={formatCurrency(briefing.avgSpendForecast)} />
        <Kpi label="Peak Window" value={briefing.peakWindow} />
      </div>

      {/* Labour + Confidence row */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-stone-50 dark:bg-stone-800/50 px-3 py-2">
          <span className="text-[10px] uppercase tracking-wider text-stone-500 dark:text-stone-400">
            Labour %
          </span>
          <p className="text-sm font-semibold text-stone-900 dark:text-stone-100 mt-0.5">
            {briefing.labourForecastPct != null ? `${briefing.labourForecastPct.toFixed(1)}%` : "—"}
          </p>
        </div>
        <div className="rounded-lg bg-stone-50 dark:bg-stone-800/50 px-3 py-2">
          <span className="text-[10px] uppercase tracking-wider text-stone-500 dark:text-stone-400">
            Confidence
          </span>
          <div className="flex items-center gap-2 mt-1">
            <div className="flex-1 h-1.5 rounded-full bg-stone-200 dark:bg-stone-700 overflow-hidden">
              <div className={cn("h-full rounded-full transition-all", conf.bar, conf.color)} />
            </div>
            <span className="text-[10px] font-medium text-stone-600 dark:text-stone-400">
              {conf.label}
            </span>
          </div>
        </div>
      </div>

      {/* Event badge */}
      {briefing.eventName && (
        <div className="flex items-center gap-2 rounded-lg bg-purple-50 dark:bg-purple-950/30 px-3 py-2 border border-purple-100 dark:border-purple-900/50">
          <span className="text-sm">🎪</span>
          <span className="text-xs font-medium text-purple-700 dark:text-purple-400">
            {briefing.eventName} tonight
          </span>
        </div>
      )}

      {/* Top Action */}
      {topAction && (
        <div className="rounded-lg border border-indigo-100 dark:border-indigo-900/50 bg-indigo-50/50 dark:bg-indigo-950/20 px-3 py-2.5">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
              Top Action
            </span>
            <PriorityDot priority={topAction.priority} />
          </div>
          <p className="text-xs font-medium text-stone-800 dark:text-stone-200">
            {topAction.title}
          </p>
          <p className="text-[11px] text-stone-600 dark:text-stone-400 mt-0.5">
            {topAction.description}
          </p>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-stone-50 dark:bg-stone-800/50 px-3 py-2">
      <span className="text-[10px] uppercase tracking-wider text-stone-500 dark:text-stone-400">
        {label}
      </span>
      <p className="text-sm font-semibold text-stone-900 dark:text-stone-100 mt-0.5 truncate">
        {value}
      </p>
    </div>
  );
}

function PriorityDot({ priority }: { priority: string }) {
  const colors: Record<string, string> = {
    urgent: "bg-red-500",
    high: "bg-orange-500",
    medium: "bg-amber-500",
    low: "bg-stone-400",
  };
  return <span className={cn("inline-block h-1.5 w-1.5 rounded-full", colors[priority] ?? "bg-stone-400")} />;
}
