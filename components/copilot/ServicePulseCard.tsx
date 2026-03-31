/**
 * ServicePulseCard — Service state dashboard card.
 * Command Center design language — flat list, left-border signals, no rounded-xl.
 */

"use client";

import { cn } from "@/lib/utils";
import type { ServiceState, ServiceRevenueImpact } from "@/lib/copilot/types";

type Props = {
  serviceState: ServiceState;
  serviceImpact: ServiceRevenueImpact;
};

const LEVEL_COLOR: Record<string, string> = {
  high:     "text-emerald-400",
  strong:   "text-emerald-400",
  moderate: "text-amber-400",
  low:      "text-red-400",
  weak:     "text-red-400",
  critical: "text-red-400",
  none:     "text-stone-600",
};

const RISK_BORDER: Record<string, string> = {
  none:     "border-l-emerald-600",
  low:      "border-l-emerald-600",
  moderate: "border-l-amber-500",
  high:     "border-l-red-500",
  critical: "border-l-red-500",
};

function rands(v: number): string {
  return `R${Math.abs(v).toLocaleString("en-ZA", { maximumFractionDigits: 0 })}`;
}

export default function ServicePulseCard({ serviceState, serviceImpact }: Props) {
  const s = serviceState.signals;

  return (
    <div className="space-y-2">
      <h2 className="text-[9px] uppercase tracking-[0.2em] text-stone-600 font-semibold px-1">
        Service Pulse
      </h2>

      {/* Summary bar */}
      <div className={cn(
        "border border-[#1a1a1a] border-l-[3px] bg-[#0f0f0f] px-4 py-3",
        RISK_BORDER[serviceState.serviceRiskLevel],
      )}>
        <p className="text-[11px] text-stone-400 leading-snug">
          {serviceState.serviceSummary}
        </p>
        <div className="flex items-center gap-2 mt-2">
          <span className="text-[9px] uppercase tracking-wider text-stone-600">Risk</span>
          <span className={cn(
            "text-[10px] font-mono font-semibold uppercase",
            LEVEL_COLOR[serviceState.serviceRiskLevel],
          )}>
            {serviceState.serviceRiskLevel}
          </span>
        </div>
      </div>

      {/* Signal grid */}
      <div className="border border-[#1a1a1a] bg-[#0f0f0f] divide-y divide-[#1a1a1a]">
        <SignalRow
          label="Floor Energy"
          value={`${s.floorEnergyScore}/100`}
          level={serviceState.energyLevel}
        />
        <SignalRow
          label="Upsell Strength"
          value={serviceState.upsellStrength}
          level={serviceState.upsellStrength}
        />
        <SignalRow
          label="Conversion"
          value={serviceState.conversionRate}
          level={serviceState.conversionRate}
        />
        <SignalRow
          label="Avg Spend"
          value={rands(s.avgSpend)}
          level={s.upsellRate >= 0.95 ? "high" : s.upsellRate >= 0.80 ? "moderate" : "low"}
        />
        <SignalRow
          label="Booking Arrival"
          value={`${Math.round(s.bookingConversionRate * 100)}%`}
          level={s.bookingConversionRate >= 0.85 ? "high" : s.bookingConversionRate >= 0.65 ? "moderate" : "low"}
        />
        <SignalRow
          label="Walk-in Rate"
          value={`${Math.round(s.walkInConversionRate * 100)}%`}
          level={s.walkInConversionRate >= 0.4 ? "high" : s.walkInConversionRate >= 0.25 ? "moderate" : "low"}
        />
      </div>

      {/* Revenue drag */}
      {serviceImpact.estimatedRevenueLoss > 0 && (
        <div className="border border-[#1a1a1a] border-l-[3px] border-l-red-500 bg-[#0f0f0f] px-4 py-2">
          <p className="text-[10px] font-mono text-red-400">
            Service drag: {rands(serviceImpact.estimatedRevenueLoss)} estimated revenue loss
          </p>
          <p className="text-[10px] text-stone-600 mt-0.5">{serviceImpact.revenueImpactExplanation}</p>
        </div>
      )}
    </div>
  );
}

function SignalRow({
  label,
  value,
  level,
}: {
  label: string;
  value: string;
  level: string;
}) {
  const color = LEVEL_COLOR[level] ?? "text-stone-500";

  return (
    <div className="flex items-center justify-between px-4 py-2">
      <span className="text-[9px] uppercase tracking-wider text-stone-600 font-semibold">{label}</span>
      <span className={cn("text-[11px] font-mono font-semibold capitalize", color)}>{value}</span>
    </div>
  );
}
