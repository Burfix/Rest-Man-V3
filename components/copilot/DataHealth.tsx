/**
 * DataHealth — Trust state card showing data freshness.
 *
 * Operational language: "Operating on limited visibility" etc.
 */

"use client";

import { cn } from "@/lib/utils";
import type { DataTrustState, TrustState } from "@/lib/copilot/types";

type Props = {
  trust: DataTrustState;
};

const TRUST_STYLE: Record<TrustState, { bg: string; border: string; dot: string; label: string }> = {
  trusted:    { bg: "bg-emerald-950/20", border: "border-emerald-800/30", dot: "bg-emerald-400",              label: "All Data Current" },
  partial:    { bg: "bg-amber-950/15",   border: "border-amber-800/20",   dot: "bg-amber-400",               label: "Partial Data Gaps" },
  degraded:   { bg: "bg-orange-950/15",  border: "border-orange-800/20",  dot: "bg-orange-400 animate-pulse", label: "Data Quality Degraded" },
  unreliable: { bg: "bg-red-950/20",     border: "border-red-800/30",     dot: "bg-red-400 animate-pulse",    label: "Critical Data Gaps" },
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
      <h2 className="text-xs uppercase tracking-widest text-stone-500 font-medium px-1">
        Data Health
      </h2>
      <div className={cn("rounded-xl border p-4 space-y-3", style.bg, style.border)}>
        {/* Header */}
        <div className="flex items-center gap-2">
          <div className={cn("h-2 w-2 rounded-full", style.dot)} />
          <span className="text-xs font-medium text-stone-300">{style.label}</span>
        </div>

        {/* Explanation */}
        <p className="text-xs text-stone-400">
          {trust.explanation}
        </p>

        {/* Stale sources */}
        {trust.staleSources.length > 0 && (
          <div className="space-y-1.5 border-t border-stone-800/30 pt-2">
            {trust.staleSources.map((s) => (
              <div key={s.source} className="flex items-center justify-between text-xs">
                <span className="text-stone-400">{s.source}</span>
                <span className="text-stone-500">
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
