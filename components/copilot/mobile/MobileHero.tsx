/**
 * MobileHero — Mobile-first hero for GM Co-Pilot.
 *
 * Stacked card: service window, urgency, headline, revenue gap,
 * covers, labour%, service score badge.
 * Designed for thumb reach and <5s scan time.
 */

"use client";

import { cn } from "@/lib/utils";
import type { GMBrief, UrgencyState, ServiceWindow } from "@/lib/copilot/types";
import type { ServiceScoreOutput } from "@/lib/copilot/types";

type Props = {
  brief: GMBrief;
  serviceScore: ServiceScoreOutput;
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

const GRADE_COLOR: Record<string, string> = {
  A: "text-emerald-400 bg-emerald-950/40 border-emerald-800/30",
  B: "text-blue-400 bg-blue-950/40 border-blue-800/30",
  C: "text-amber-400 bg-amber-950/40 border-amber-800/30",
  D: "text-orange-400 bg-orange-950/40 border-orange-800/30",
  F: "text-red-400 bg-red-950/40 border-red-800/30",
};

function rands(v: number): string {
  return `R${Math.abs(v).toLocaleString("en-ZA", { maximumFractionDigits: 0 })}`;
}

export default function MobileHero({ brief, serviceScore }: Props) {
  const u = URGENCY_STYLE[brief.urgencyState];

  return (
    <div className={cn("rounded-xl border p-4 space-y-3", u.bg, u.border)}>
      {/* Top bar: window + urgency */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest text-stone-500 dark:text-stone-400 font-medium">
          {WINDOW_LABEL[brief.serviceWindow]}
        </span>
        <div className="flex items-center gap-1.5">
          <div className={cn("h-2 w-2 rounded-full", u.dot)} />
          <span className="text-[10px] uppercase tracking-widest font-bold text-stone-600 dark:text-stone-300">
            {u.label}
          </span>
        </div>
      </div>

      {/* Headline */}
      <h1 className="text-lg font-bold text-stone-100 leading-tight">
        {brief.headline}
      </h1>

      {/* Key metrics — 2x2 grid */}
      <div className="grid grid-cols-2 gap-2">
        <MobilePill
          label="Revenue Gap"
          value={brief.revenueGap > 0 ? rands(brief.revenueGap) : "On Target"}
          tone={brief.revenueGap > brief.todayTarget * 0.15 ? "critical" : brief.revenueGap > 0 ? "warning" : "positive"}
        />
        <MobilePill
          label="Labour"
          value={`${brief.labourPercent.toFixed(1)}%`}
          tone={brief.labourPercent > 37 ? "critical" : brief.labourPercent > 32 ? "warning" : "positive"}
        />
        <MobilePill
          label="Covers"
          value={`${brief.coversActual}/${brief.coversForecast}`}
          tone={brief.coversActual < brief.coversForecast * 0.5 ? "critical" : brief.coversActual < brief.coversForecast * 0.7 ? "warning" : "positive"}
        />
        <div className={cn(
          "rounded-lg border px-3 py-2 flex items-center justify-between",
          GRADE_COLOR[serviceScore.serviceGrade] ?? GRADE_COLOR.C,
        )}>
          <span className="text-[10px] uppercase tracking-wider text-stone-500 dark:text-stone-400">Service</span>
          <span className="text-base font-bold font-mono">{serviceScore.totalScore}</span>
        </div>
      </div>

      {/* Service risk badges */}
      {brief.serviceRiskSummary.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {brief.serviceRiskSummary.slice(0, 3).map((risk, i) => (
            <span key={i} className="text-[10px] text-red-400 bg-red-950/30 border border-red-800/30 rounded-full px-2 py-0.5">
              {risk}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function MobilePill({
  label, value, tone,
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
