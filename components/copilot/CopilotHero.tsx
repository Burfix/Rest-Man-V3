/**
 * CopilotHero — Top hero section of the GM Co-Pilot page.
 *
 * Shows: service window badge, urgency state, headline, revenue gap,
 * labour %, covers, avg spend, service risk signals, consequence if ignored.
 */

"use client";

import { cn } from "@/lib/utils";
import type { GMBrief, UrgencyState, ServiceWindow } from "@/lib/copilot/types";

type Props = {
  brief: GMBrief;
};

const URGENCY_STYLE: Record<UrgencyState, { bg: string; border: string; dot: string; label: string }> = {
  critical:  { bg: "bg-red-950/30",    border: "border-red-800/50",    dot: "bg-red-400 animate-pulse",    label: "CRITICAL" },
  urgent:    { bg: "bg-amber-950/20",  border: "border-amber-800/40",  dot: "bg-amber-400 animate-pulse",  label: "URGENT" },
  attention: { bg: "bg-yellow-950/20", border: "border-yellow-800/30", dot: "bg-yellow-400",                label: "ATTENTION" },
  on_track:  { bg: "bg-emerald-950/20",border: "border-emerald-800/30",dot: "bg-emerald-400",              label: "ON TRACK" },
};

const WINDOW_LABEL: Record<ServiceWindow, string> = {
  pre_open: "Pre-Open",
  breakfast: "Breakfast",
  lunch_build: "Lunch Build",
  lunch_peak: "Lunch Peak",
  dinner_build: "Dinner Build",
  dinner_peak: "Dinner Peak",
  afternoon_lull: "Afternoon",
  close: "Close",
};

function rands(v: number): string {
  return `R${Math.abs(v).toLocaleString("en-ZA", { maximumFractionDigits: 0 })}`;
}

export default function CopilotHero({ brief }: Props) {
  const u = URGENCY_STYLE[brief.urgencyState];

  return (
    <div className={cn("rounded-xl border p-5 space-y-4", u.bg, u.border)}>
      {/* Top row: window + urgency badge */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-widest text-stone-400 font-medium">
            {WINDOW_LABEL[brief.serviceWindow]}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className={cn("h-2 w-2 rounded-full", u.dot)} />
          <span className="text-[10px] uppercase tracking-widest font-bold text-stone-300">
            {u.label}
          </span>
        </div>
      </div>

      {/* Headline */}
      <h1 className="text-xl md:text-2xl font-bold text-stone-100 leading-tight">
        {brief.headline}
      </h1>

      {/* Summary */}
      <p className="text-sm text-stone-400 leading-relaxed">
        {brief.summary}
      </p>

      {/* Key metrics row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricPill
          label="Revenue Gap"
          value={brief.revenueGap > 0 ? rands(brief.revenueGap) : "On Target"}
          tone={brief.revenueGap > brief.todayTarget * 0.15 ? "critical" : brief.revenueGap > 0 ? "warning" : "positive"}
        />
        <MetricPill
          label="Labour"
          value={`${brief.labourPercent.toFixed(1)}%`}
          tone={brief.labourPercent > 37 ? "critical" : brief.labourPercent > 32 ? "warning" : "positive"}
        />
        <MetricPill
          label="Covers"
          value={`${brief.coversActual} / ${brief.coversForecast}`}
          tone={brief.coversActual < brief.coversForecast * 0.5 ? "critical" : brief.coversActual < brief.coversForecast * 0.7 ? "warning" : "positive"}
        />
        <MetricPill
          label="Avg Spend"
          value={rands(brief.avgSpend)}
          tone={brief.avgSpend < 200 ? "warning" : "positive"}
        />
      </div>

      {/* Service risk signals */}
      {brief.serviceRiskSummary.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {brief.serviceRiskSummary.map((risk, i) => (
            <span key={i} className="inline-flex items-center gap-1 text-[11px] text-red-400 bg-red-950/30 border border-red-800/30 rounded-full px-2.5 py-0.5">
              <span className="h-1 w-1 rounded-full bg-red-400" />
              {risk}
            </span>
          ))}
        </div>
      )}

      {/* Consequence if ignored */}
      {brief.urgencyState !== "on_track" && (
        <div className="text-xs text-stone-500 italic border-t border-stone-800/40 pt-3">
          If ignored: {brief.consequenceIfIgnored}
        </div>
      )}
    </div>
  );
}

function MetricPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "positive" | "warning" | "critical";
}) {
  const colors = {
    positive: "text-emerald-400",
    warning: "text-amber-400",
    critical: "text-red-400",
  };

  return (
    <div className="rounded-lg bg-stone-900/50 border border-stone-800/30 px-3 py-2">
      <span className="text-[10px] uppercase tracking-wider text-stone-500 block">{label}</span>
      <span className={cn("text-sm font-bold font-mono", colors[tone])}>{value}</span>
    </div>
  );
}
