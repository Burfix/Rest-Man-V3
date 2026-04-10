/**
 * BusinessStatusRail — Compact vertical status rail for the secondary column.
 *
 * Shows Revenue, Labour, Inventory, Maintenance, Compliance —
 * each with a horizontal fill bar showing % of target, label, and tone.
 * Click any row to expand supporting text.
 *
 * Second group (FORECAST) shows predictive signals from brain:
 * Dinner Risk, Booking Pace, Peak Window, Staffing Pressure.
 */

"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { EvaluateOperationsOutput, BusinessStatusTone } from "@/services/decision-engine";

export type PredictiveSignals = {
  dinnerRisk:       "Low" | "Medium" | "High";
  bookingPace:      "Strong" | "Moderate" | "Slow";
  peakWindow:       string | null;
  staffingPressure: "Low" | "Medium" | "High";
};

type Props = {
  status: EvaluateOperationsOutput["businessStatus"];
  predictive?: PredictiveSignals;
};

const TONE_STYLES: Record<BusinessStatusTone, { text: string; bar: string }> = {
  positive: { text: "text-emerald-400", bar: "bg-emerald-500/60" },
  warning:  { text: "text-amber-400",   bar: "bg-amber-500/60"   },
  critical: { text: "text-red-400",     bar: "bg-red-500/60"     },
  neutral:  { text: "text-stone-500 dark:text-stone-400",   bar: "bg-stone-600"      },
};

// Approximate fill % from tone for the indicator bar
const TONE_FILL: Record<BusinessStatusTone, number> = {
  positive: 82,
  warning: 46,
  critical: 18,
  neutral: 55,
};

type StatusKey = keyof EvaluateOperationsOutput["businessStatus"];
const KEYS: StatusKey[] = ["revenue", "labour", "maintenance", "compliance"];

// ── Predictive signal helpers ─────────────────────────────────────────────────

type RiskLevel = "Low" | "Medium" | "High";
type PaceLevel = "Strong" | "Moderate" | "Slow";

function riskColor(level: RiskLevel): string {
  if (level === "High")   return "text-red-400";
  if (level === "Medium") return "text-amber-400";
  return "text-emerald-400";
}

function paceColor(level: PaceLevel): string {
  if (level === "Strong")   return "text-emerald-400";
  if (level === "Moderate") return "text-amber-400";
  return "text-red-400";
}

function riskFill(level: RiskLevel): number {
  if (level === "High")   return 16;
  if (level === "Medium") return 48;
  return 82;
}

function riskBarColor(level: RiskLevel): string {
  if (level === "High")   return "bg-red-500/60";
  if (level === "Medium") return "bg-amber-500/60";
  return "bg-emerald-500/60";
}

function paceFill(level: PaceLevel): number {
  if (level === "Strong")   return 82;
  if (level === "Moderate") return 50;
  return 20;
}

export default function BusinessStatusRail({ status, predictive }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <h2 className="text-[9px] uppercase tracking-[0.2em] text-stone-600 font-semibold px-1">
        Business Status
      </h2>
      <div className="rounded border border-stone-800/40 bg-stone-900/50 divide-y divide-stone-800/40">
        {KEYS.map((key) => {
          const item = status[key];
          const tone = TONE_STYLES[item.tone];
          const fillPct = TONE_FILL[item.tone];
          const isExp = expanded === key;
          const isRevenue = key === "revenue";

          return (
            <div
              key={key}
              className="px-4 py-2.5 cursor-pointer hover:bg-stone-800/20 transition-colors"
              onClick={() => setExpanded(isExp ? null : key)}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="text-[9px] uppercase tracking-widest text-stone-600 font-medium w-[72px] shrink-0">
                    {key}
                  </span>
                  <p className={cn(
                    "font-semibold leading-tight truncate",
                    isRevenue ? "text-base font-black" : "text-sm",
                    tone.text
                  )}>
                    {item.label}
                  </p>
                </div>
                <span className="text-stone-700 text-[9px] font-mono shrink-0">
                  {isExp ? "▲" : "▼"}
                </span>
              </div>

              {/* Fill bar */}
              <div className="mt-1.5 h-0.5 bg-stone-100 dark:bg-stone-800 overflow-hidden">
                <div
                  className={cn("h-full transition-all duration-700", tone.bar)}
                  style={{ width: `${fillPct}%` }}
                />
              </div>

              {/* Expanded supporting text */}
              {isExp && (
                <p className="mt-1.5 text-[10px] text-stone-500 leading-snug">
                  {item.supportingText}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Predictive / Forecast group ── */}
      {predictive && (
        <>
          <h2 className="text-[9px] uppercase tracking-[0.2em] text-stone-600 font-semibold px-1 pt-1">
            Forecast
          </h2>
          <div className="rounded border border-stone-800/40 bg-stone-900/50 divide-y divide-stone-800/40 font-mono">

            {/* Dinner / session risk */}
            <div className="px-4 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] uppercase tracking-widest text-stone-600 font-medium w-[88px] shrink-0">
                  DINNER RISK
                </span>
                <span className={cn("text-sm font-bold", riskColor(predictive.dinnerRisk))}>
                  {predictive.dinnerRisk}
                </span>
              </div>
              <div className="mt-1.5 h-0.5 bg-stone-100 dark:bg-stone-800 overflow-hidden">
                <div
                  className={cn("h-full transition-all duration-700", riskBarColor(predictive.dinnerRisk))}
                  style={{ width: `${riskFill(predictive.dinnerRisk)}%` }}
                />
              </div>
            </div>

            {/* Booking pace */}
            <div className="px-4 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] uppercase tracking-widest text-stone-600 font-medium w-[88px] shrink-0">
                  BOOKING PACE
                </span>
                <span className={cn("text-sm font-bold", paceColor(predictive.bookingPace))}>
                  {predictive.bookingPace}
                </span>
              </div>
              <div className="mt-1.5 h-0.5 bg-stone-100 dark:bg-stone-800 overflow-hidden">
                <div
                  className={cn("h-full transition-all duration-700", riskBarColor(
                    predictive.bookingPace === "Slow" ? "High" :
                    predictive.bookingPace === "Moderate" ? "Medium" : "Low"
                  ))}
                  style={{ width: `${paceFill(predictive.bookingPace)}%` }}
                />
              </div>
            </div>

            {/* Peak window */}
            {predictive.peakWindow && (
              <div className="px-4 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[9px] uppercase tracking-widest text-stone-600 font-medium w-[88px] shrink-0">
                    PEAK WINDOW
                  </span>
                  <span className="text-sm font-bold text-stone-600 dark:text-stone-300">
                    {predictive.peakWindow}
                  </span>
                </div>
              </div>
            )}

            {/* Staffing pressure */}
            <div className="px-4 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] uppercase tracking-widest text-stone-600 font-medium w-[88px] shrink-0">
                  STAFFING
                </span>
                <span className={cn("text-sm font-bold", riskColor(predictive.staffingPressure))}>
                  {predictive.staffingPressure}
                </span>
              </div>
              <div className="mt-1.5 h-0.5 bg-stone-100 dark:bg-stone-800 overflow-hidden">
                <div
                  className={cn("h-full transition-all duration-700", riskBarColor(predictive.staffingPressure))}
                  style={{ width: `${riskFill(predictive.staffingPressure)}%` }}
                />
              </div>
            </div>

          </div>
        </>
      )}
    </div>
  );
}
