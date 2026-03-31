/**
 * CopilotHero — Horizontal threat bar matching Command Center design language.
 *
 * One-line format: [GRADE] [Score] [Issues Active] [Top Risk] [Window]
 * Metrics row: Revenue Gap / Labour / Covers / Avg Spend
 * Service risks: inline pills without emoji
 * Consequence: opacity-40 until hovered
 */

"use client";

import { cn } from "@/lib/utils";
import type { GMBrief, UrgencyState, ServiceWindow } from "@/lib/copilot/types";

type Props = {
  brief: GMBrief;
};

const URGENCY_BORDER: Record<UrgencyState, string> = {
  critical:  "border-l-red-500",
  urgent:    "border-l-amber-500",
  attention: "border-l-yellow-500",
  on_track:  "border-l-emerald-600",
};

const URGENCY_LABEL_COLOR: Record<UrgencyState, string> = {
  critical:  "text-red-400",
  urgent:    "text-amber-400",
  attention: "text-yellow-400",
  on_track:  "text-emerald-400",
};

const WINDOW_LABEL: Record<ServiceWindow, string> = {
  pre_open:      "PRE-OPEN",
  breakfast:     "BREAKFAST",
  lunch_build:   "LUNCH BUILD",
  lunch_peak:    "LUNCH PEAK",
  dinner_build:  "DINNER BUILD",
  dinner_peak:   "DINNER PEAK",
  afternoon_lull:"AFTERNOON",
  close:         "CLOSE",
};

function rands(v: number): string {
  return `R${Math.abs(v).toLocaleString("en-ZA", { maximumFractionDigits: 0 })}`;
}

export default function CopilotHero({ brief }: Props) {
  const issueCount = brief.topThreeActions.length;
  const topRisk = brief.topThreeActions[0]?.title ?? null;

  return (
    <div className="space-y-2">
      {/* Threat bar */}
      <div className={cn(
        "group border border-[#1a1a1a] border-l-[3px] bg-[#0f0f0f] px-4 py-3",
        URGENCY_BORDER[brief.urgencyState],
      )}>
        <div className="flex items-center gap-4 font-mono text-[11px] flex-wrap">
          <span className={cn("font-bold tracking-wider uppercase", URGENCY_LABEL_COLOR[brief.urgencyState])}>
            {brief.urgencyState.replace("_", " ")}
          </span>
          <span className="text-stone-500">·</span>
          <span className="text-stone-300">{brief.criticalIssues} issues active</span>
          {topRisk && (
            <>
              <span className="text-stone-600">·</span>
              <span className="text-stone-500">Top risk: <span className="text-stone-300">{topRisk}</span></span>
            </>
          )}
          <span className="ml-auto text-stone-600 text-[10px] tracking-widest">
            {WINDOW_LABEL[brief.serviceWindow]}
          </span>
        </div>
      </div>

      {/* Metrics row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px border border-[#1a1a1a]">
        <MetricCell
          label="REVENUE GAP"
          value={brief.revenueGap > 0 ? rands(brief.revenueGap) : "On Target"}
          tone={brief.revenueGap > brief.todayTarget * 0.15 ? "critical" : brief.revenueGap > 0 ? "warning" : "positive"}
        />
        <MetricCell
          label="LABOUR"
          value={`${brief.labourPercent.toFixed(1)}%`}
          tone={brief.labourPercent > 37 ? "critical" : brief.labourPercent > 32 ? "warning" : "positive"}
        />
        <MetricCell
          label="COVERS"
          value={`${brief.coversActual} / ${brief.coversForecast}`}
          tone={brief.coversActual < brief.coversForecast * 0.5 ? "critical" : brief.coversActual < brief.coversForecast * 0.7 ? "warning" : "positive"}
        />
        <MetricCell
          label="AVG SPEND"
          value={rands(brief.avgSpend)}
          tone={brief.avgSpend < 200 ? "warning" : "positive"}
        />
      </div>

      {/* Service risk signals */}
      {brief.serviceRiskSummary.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-1">
          {brief.serviceRiskSummary.map((risk, i) => (
            <span key={i} className="inline-flex items-center gap-1 text-[10px] font-mono text-red-400/70 border border-red-900/30 px-2 py-0.5">
              <span className="h-1 w-1 bg-red-500 block" />
              {risk}
            </span>
          ))}
        </div>
      )}

      {/* Consequence if ignored */}
      {brief.urgencyState !== "on_track" && (
        <div className="group/consequence px-4 py-2 border border-[#1a1a1a] opacity-40 hover:opacity-100 transition-opacity duration-200">
          <span className="text-[10px] uppercase tracking-wider text-red-400/80 font-mono">If ignored → </span>
          <span className="text-[11px] text-red-300/80">{brief.consequenceIfIgnored}</span>
        </div>
      )}
    </div>
  );
}

function MetricCell({
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
    warning:  "text-amber-400",
    critical: "text-red-400",
  };

  return (
    <div className="bg-[#0f0f0f] px-3 py-2.5">
      <span className="text-[9px] uppercase tracking-[0.15em] text-stone-600 font-semibold block">{label}</span>
      <span className={cn("text-sm font-bold font-mono", colors[tone])}>{value}</span>
    </div>
  );
}
