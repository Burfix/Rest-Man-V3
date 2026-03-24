/**
 * OperatingCommandBar — Hero strip at the very top of the Operating Brain.
 *
 * Shows system status, issue count, revenue at risk, time to peak,
 * and the top 3 recommended actions as compact chips.
 * Calm, premium, decisive. This is NOT a loud alert banner.
 */

"use client";

import { cn } from "@/lib/utils";
import type { EvaluateOperationsOutput } from "@/services/decision-engine";

type Props = {
  bar: EvaluateOperationsOutput["operatingCommandBar"];
  score?: number | null;
};

const STATUS_CONFIG = {
  healthy: {
    bg: "bg-emerald-950/60",
    border: "border-emerald-800/40",
    dot: "bg-emerald-400",
    text: "text-emerald-300",
    accent: "text-emerald-400",
  },
  needs_attention: {
    bg: "bg-amber-950/50",
    border: "border-amber-800/30",
    dot: "bg-amber-400",
    text: "text-amber-300",
    accent: "text-amber-400",
  },
  critical: {
    bg: "bg-red-950/50",
    border: "border-red-800/30",
    dot: "bg-red-400 animate-pulse",
    text: "text-red-300",
    accent: "text-red-400",
  },
};

export default function OperatingCommandBar({ bar, score }: Props) {
  const cfg = STATUS_CONFIG[bar.status];

  return (
    <div
      className={cn(
        "rounded-xl border px-5 py-4",
        cfg.bg,
        cfg.border,
      )}
    >
      {/* Top row: status + score + meta */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className={cn("h-2.5 w-2.5 rounded-full shrink-0", cfg.dot)} />
          <span className={cn("text-sm font-semibold", cfg.text)}>
            {bar.label}
          </span>
          {bar.issueCount > 0 && (
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium text-white/70">
              {bar.issueCount} issue{bar.issueCount !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-4 text-xs text-white/50">
          {score != null && (
            <span className="font-mono text-white/70">
              Score {score}/100
            </span>
          )}
          {bar.revenueAtRisk != null && bar.revenueAtRisk > 0 && (
            <span className={cn("font-medium", cfg.accent)}>
              R{bar.revenueAtRisk.toLocaleString("en-ZA")} at risk
            </span>
          )}
          {bar.timeToPeakLabel && (
            <span className="font-medium text-white/60">
              {bar.timeToPeakLabel}
            </span>
          )}
        </div>
      </div>

      {/* Top actions as inline chips */}
      {bar.topActions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {bar.topActions.map((action, i) => (
            <span
              key={i}
              className="rounded-md bg-white/8 px-2.5 py-1 text-xs text-white/80 border border-white/6"
            >
              {action}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
