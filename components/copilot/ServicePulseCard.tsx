/**
 * ServicePulseCard — Service state dashboard card.
 *
 * Shows: floor energy, upsell strength, conversion, booking conversion,
 * avg spend, service risk level, and service impact on revenue.
 */

"use client";

import { cn } from "@/lib/utils";
import type { ServiceState, ServiceRevenueImpact } from "@/lib/copilot/types";

type Props = {
  serviceState: ServiceState;
  serviceImpact: ServiceRevenueImpact;
};

const LEVEL_COLOR = {
  high:     "text-emerald-400",
  strong:   "text-emerald-400",
  moderate: "text-amber-400",
  low:      "text-red-400",
  weak:     "text-red-400",
  critical: "text-red-400",
  none:     "text-stone-500",
};

const RISK_COLOR = {
  none:     "bg-emerald-400",
  low:      "bg-emerald-400",
  moderate: "bg-amber-400",
  high:     "bg-red-400",
  critical: "bg-red-400",
};

function rands(v: number): string {
  return `R${Math.abs(v).toLocaleString("en-ZA", { maximumFractionDigits: 0 })}`;
}

export default function ServicePulseCard({ serviceState, serviceImpact }: Props) {
  const s = serviceState.signals;

  return (
    <div className="space-y-2">
      <h2 className="text-xs uppercase tracking-widest text-stone-500 font-medium px-1">
        Service Pulse
      </h2>
      <div className="rounded-xl border border-stone-800/40 bg-stone-900/50 p-4 space-y-4">
        {/* Service summary */}
        <p className="text-sm text-stone-300">
          {serviceState.serviceSummary}
        </p>

        {/* Signal grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <SignalCard
            label="Floor Energy"
            value={`${s.floorEnergyScore}`}
            suffix="/100"
            level={serviceState.energyLevel}
          />
          <SignalCard
            label="Upsell Strength"
            value={serviceState.upsellStrength}
            level={serviceState.upsellStrength === "strong" || serviceState.upsellStrength === "moderate" ? serviceState.upsellStrength : "low"}
          />
          <SignalCard
            label="Conversion"
            value={serviceState.conversionRate}
            level={serviceState.conversionRate === "high" || serviceState.conversionRate === "moderate" ? serviceState.conversionRate : "low"}
          />
          <SignalCard
            label="Avg Spend"
            value={rands(s.avgSpend)}
            level={s.upsellRate >= 0.95 ? "high" : s.upsellRate >= 0.80 ? "moderate" : "low"}
          />
          <SignalCard
            label="Booking Arrival"
            value={`${Math.round(s.bookingConversionRate * 100)}%`}
            level={s.bookingConversionRate >= 0.85 ? "high" : s.bookingConversionRate >= 0.65 ? "moderate" : "low"}
          />
          <SignalCard
            label="Walk-in Rate"
            value={`${Math.round(s.walkInConversionRate * 100)}%`}
            level={s.walkInConversionRate >= 0.4 ? "high" : s.walkInConversionRate >= 0.25 ? "moderate" : "low"}
          />
        </div>

        {/* Service risk indicator */}
        <div className="flex items-center gap-2 border-t border-stone-800/30 pt-3">
          <div className={cn("h-2 w-2 rounded-full", RISK_COLOR[serviceState.serviceRiskLevel])} />
          <span className="text-xs text-stone-400">
            Service Risk: <span className="font-medium text-stone-300 capitalize">{serviceState.serviceRiskLevel}</span>
          </span>
        </div>

        {/* Revenue impact from service */}
        {serviceImpact.estimatedRevenueLoss > 0 && (
          <div className="bg-red-950/20 border border-red-800/20 rounded-lg p-3 text-xs">
            <p className="text-red-400 font-medium">
              Service drag: {rands(serviceImpact.estimatedRevenueLoss)} estimated revenue loss
            </p>
            <p className="text-stone-500 mt-1">{serviceImpact.revenueImpactExplanation}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function SignalCard({
  label,
  value,
  suffix,
  level,
}: {
  label: string;
  value: string;
  suffix?: string;
  level: string;
}) {
  const color = LEVEL_COLOR[level as keyof typeof LEVEL_COLOR] ?? "text-stone-400";

  return (
    <div className="rounded-lg bg-stone-900/60 border border-stone-800/20 px-3 py-2">
      <span className="text-[10px] uppercase tracking-wider text-stone-500 block">{label}</span>
      <span className={cn("text-sm font-bold font-mono capitalize", color)}>
        {value}
        {suffix && <span className="text-stone-500 text-xs font-normal">{suffix}</span>}
      </span>
    </div>
  );
}
