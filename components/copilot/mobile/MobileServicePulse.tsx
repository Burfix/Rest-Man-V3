/**
 * MobileServicePulse — Service signals stacked for mobile.
 *
 * Shows: floor energy, upsell, walk-in conversion, avg spend,
 * service risk level, service score + grade.
 */

"use client";

import { cn } from "@/lib/utils";
import type { ServiceState, ServiceRevenueImpact } from "@/lib/copilot/types";
import type { ServiceScoreOutput } from "@/lib/copilot/types";

type Props = {
  serviceState: ServiceState;
  serviceImpact: ServiceRevenueImpact;
  serviceScore: ServiceScoreOutput;
};

const LEVEL_COLOR: Record<string, string> = {
  high:     "text-emerald-400",
  strong:   "text-emerald-400",
  moderate: "text-amber-400",
  low:      "text-red-400",
  weak:     "text-red-400",
  critical: "text-red-400",
  none:     "text-stone-500",
};

const RISK_BG: Record<string, string> = {
  none:     "bg-emerald-400",
  low:      "bg-emerald-400",
  moderate: "bg-amber-400",
  high:     "bg-red-400",
  critical: "bg-red-400 animate-pulse",
};

const GRADE_COLOR: Record<string, string> = {
  A: "text-emerald-400",
  B: "text-blue-400",
  C: "text-amber-400",
  D: "text-orange-400",
  F: "text-red-400",
};

function rands(v: number): string {
  return `R${Math.abs(v).toLocaleString("en-ZA", { maximumFractionDigits: 0 })}`;
}

export default function MobileServicePulse({ serviceState, serviceImpact, serviceScore }: Props) {
  const s = serviceState.signals;

  return (
    <div className="space-y-2">
      <h2 className="text-xs uppercase tracking-widest text-stone-500 font-medium px-1">
        Service Pulse
      </h2>
      <div className="rounded-xl border border-stone-800/40 bg-stone-900/50 p-4 space-y-3">
        {/* Score + grade header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={cn(
              "text-2xl font-bold font-mono",
              GRADE_COLOR[serviceScore.serviceGrade] ?? "text-stone-300",
            )}>
              {serviceScore.totalScore}
            </span>
            <span className={cn(
              "text-xs font-bold uppercase",
              GRADE_COLOR[serviceScore.serviceGrade] ?? "text-stone-400",
            )}>
              {serviceScore.serviceGrade}
            </span>
          </div>
          {serviceScore.movementVsYesterday != null && (
            <span className={cn(
              "text-xs font-mono",
              serviceScore.movementVsYesterday > 0 ? "text-emerald-400" :
              serviceScore.movementVsYesterday < 0 ? "text-red-400" : "text-stone-500",
            )}>
              {serviceScore.movementVsYesterday > 0 ? "+" : ""}{serviceScore.movementVsYesterday} vs yesterday
            </span>
          )}
        </div>

        {/* Labels */}
        {serviceScore.labels.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {serviceScore.labels.map((l) => (
              <span key={l} className="text-[10px] text-emerald-400 bg-emerald-950/30 border border-emerald-800/30 rounded-full px-2 py-0.5">
                {l}
              </span>
            ))}
          </div>
        )}

        {/* Service signals — stacked rows */}
        <div className="space-y-2.5">
          <SignalRow
            label="Floor Energy"
            value={`${s.floorEnergyScore}/100`}
            level={serviceState.energyLevel}
          />
          <SignalRow
            label="Upsell"
            value={serviceState.upsellStrength}
            level={serviceState.upsellStrength === "strong" ? "high" : serviceState.upsellStrength === "moderate" ? "moderate" : "low"}
          />
          <SignalRow
            label="Walk-in Conv"
            value={`${Math.round(s.walkInConversionRate * 100)}%`}
            level={s.walkInConversionRate >= 0.4 ? "high" : s.walkInConversionRate >= 0.25 ? "moderate" : "low"}
          />
          <SignalRow
            label="Avg Spend"
            value={rands(s.avgSpend)}
            level={s.avgSpend >= 280 ? "high" : s.avgSpend >= 200 ? "moderate" : "low"}
          />
          <SignalRow
            label="Table Turn"
            value={`${s.tableTurnRate.toFixed(1)}/hr`}
            level={s.tableTurnRate >= 1.5 ? "high" : s.tableTurnRate >= 1.0 ? "moderate" : "low"}
          />
        </div>

        {/* Service risk bar */}
        <div className="flex items-center gap-2 border-t border-stone-800/30 pt-3">
          <div className={cn("h-2 w-2 rounded-full", RISK_BG[serviceState.serviceRiskLevel] ?? RISK_BG.moderate)} />
          <span className="text-xs text-stone-400 capitalize">
            Service risk: {serviceState.serviceRiskLevel}
          </span>
        </div>

        {/* Revenue impact if significant */}
        {serviceImpact.estimatedRevenueLoss > 0 && (
          <div className="text-xs text-red-400">
            Est. service-driven loss: {rands(serviceImpact.estimatedRevenueLoss)}
          </div>
        )}

        {/* Biggest driver callouts */}
        <div className="flex gap-3 text-[11px] text-stone-500">
          {serviceScore.biggestDriverUp && (
            <span>↑ {serviceScore.biggestDriverUp}</span>
          )}
          {serviceScore.biggestDriverDown && (
            <span>↓ {serviceScore.biggestDriverDown}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function SignalRow({
  label, value, level,
}: {
  label: string;
  value: string;
  level: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-stone-500">{label}</span>
      <span className={cn("text-xs font-medium", LEVEL_COLOR[level] ?? "text-stone-400")}>
        {value}
      </span>
    </div>
  );
}
