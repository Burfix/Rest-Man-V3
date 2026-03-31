/**
 * DataHealth — Trust state card showing data freshness.
 * Command Center design language — left-border trust state, no rounded-xl.
 */

"use client";

import { cn } from "@/lib/utils";
import type { DataTrustState, TrustState } from "@/lib/copilot/types";

type Props = {
  trust: DataTrustState;
};

const TRUST_STYLE: Record<TrustState, { border: string; dot: string; label: string; labelColor: string }> = {
  trusted:    { border: "border-l-emerald-600", dot: "bg-emerald-400",              label: "All Data Current",       labelColor: "text-emerald-400" },
  partial:    { border: "border-l-amber-500",   dot: "bg-amber-400",               label: "Partial Data Gaps",      labelColor: "text-amber-400" },
  degraded:   { border: "border-l-orange-500",  dot: "bg-orange-400 animate-pulse", label: "Data Quality Degraded",  labelColor: "text-orange-400" },
  unreliable: { border: "border-l-red-500",     dot: "bg-red-400 animate-pulse",    label: "Critical Data Gaps",     labelColor: "text-red-400" },
};

function formatAge(minutes: number | null): string {
  if (minutes == null) return "unavailable";
  if (minutes < 60) return `${Math.round(minutes)}m ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1440)}d ago`;
}

export default function DataHealth({ trust }: Props) {
  const style = TRUST_STYLE[trust.trustState];

  return (
    <div className="space-y-2">
      <h2 className="text-[9px] uppercase tracking-[0.2em] text-stone-600 font-semibold px-1">
        Data Health
      </h2>
      <div className={cn("border border-[#1a1a1a] border-l-[3px] bg-[#0f0f0f] px-4 py-3 space-y-2", style.border)}>
        {/* Status */}
        <div className="flex items-center gap-2">
          <div className={cn("h-1.5 w-1.5 flex-shrink-0", style.dot)} />
          <span className={cn("text-[11px] font-semibold font-mono", style.labelColor)}>
            {style.label}
          </span>
        </div>

        {/* Explanation */}
        <p className="text-[10px] text-stone-500 leading-snug">
          {trust.explanation}
        </p>

        {/* Stale sources */}
        {trust.staleSources.length > 0 && (
          <div className="space-y-1 border-t border-[#1a1a1a] pt-2">
            {trust.staleSources.map((s) => (
              <div key={s.source} className="flex items-center justify-between">
                <span className="text-[10px] text-stone-500 font-mono">{s.source}</span>
                <span className="text-[10px] text-stone-700 font-mono">
                  {formatAge(s.ageMinutes)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
