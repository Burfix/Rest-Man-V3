/**
 * MobileBusinessSnapshot — Stacked domain status cards for mobile.
 *
 * Revenue, labour, covers, inventory, maintenance, compliance — each as
 * a compact row with a colour-coded dot.
 */

"use client";

import { cn } from "@/lib/utils";
import type { GMBrief, CopilotOperatingScore } from "@/lib/copilot/types";

type Props = {
  brief: GMBrief;
  score: CopilotOperatingScore;
};

type Tone = "positive" | "warning" | "critical";

interface StatusRow {
  label: string;
  value: string;
  tone: Tone;
}

function rands(v: number): string {
  return `R${Math.abs(v).toLocaleString("en-ZA", { maximumFractionDigits: 0 })}`;
}

const DOT: Record<Tone, string> = {
  positive: "bg-emerald-400",
  warning:  "bg-amber-400",
  critical: "bg-red-400",
};

const TEXT: Record<Tone, string> = {
  positive: "text-emerald-400",
  warning:  "text-amber-400",
  critical: "text-red-400",
};

export default function MobileBusinessSnapshot({ brief, score }: Props) {
  const rows: StatusRow[] = [
    {
      label: "Revenue",
      value: brief.revenueGap > 0 ? `${rands(brief.revenueGap)} behind` : "On target",
      tone: brief.revenueGap > brief.todayTarget * 0.15 ? "critical" : brief.revenueGap > 0 ? "warning" : "positive",
    },
    {
      label: "Labour",
      value: `${brief.labourPercent.toFixed(1)}%`,
      tone: brief.labourPercent > 37 ? "critical" : brief.labourPercent > 32 ? "warning" : "positive",
    },
    {
      label: "Covers",
      value: `${brief.coversActual}/${brief.coversForecast}`,
      tone: brief.coversActual < brief.coversForecast * 0.5 ? "critical" : brief.coversActual < brief.coversForecast * 0.7 ? "warning" : "positive",
    },
    {
      label: "Maintenance",
      value: score.breakdown.maintenance >= 7 ? "Clear" : score.breakdown.maintenance >= 3 ? "Open issues" : "Blocking",
      tone: score.breakdown.maintenance >= 7 ? "positive" : score.breakdown.maintenance >= 3 ? "warning" : "critical",
    },
    {
      label: "Compliance",
      value: score.breakdown.compliance >= 7 ? "Current" : score.breakdown.compliance >= 3 ? "Due soon" : "Expired",
      tone: score.breakdown.compliance >= 7 ? "positive" : score.breakdown.compliance >= 3 ? "warning" : "critical",
    },
  ];

  return (
    <div className="space-y-2">
      <h2 className="text-xs uppercase tracking-widest text-stone-500 font-medium px-1">
        Business Snapshot
      </h2>
      <div className="rounded-xl border border-stone-800/40 bg-stone-900/50 p-4 space-y-3">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={cn("h-1.5 w-1.5 rounded-full", DOT[r.tone])} />
              <span className="text-xs text-stone-400">{r.label}</span>
            </div>
            <span className={cn("text-xs font-medium", TEXT[r.tone])}>
              {r.value}
            </span>
          </div>
        ))}

        {/* Operating score footer */}
        <div className="border-t border-stone-800/30 pt-2 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-stone-500">Operating Score</span>
          <span className={cn(
            "text-sm font-bold font-mono",
            score.totalScore >= 70 ? "text-emerald-400" : score.totalScore >= 50 ? "text-amber-400" : "text-red-400",
          )}>
            {score.totalScore} <span className="text-xs text-stone-500">{score.grade}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
