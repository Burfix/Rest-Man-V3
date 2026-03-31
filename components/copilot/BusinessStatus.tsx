/**
 * BusinessStatus — Revenue / labour / covers / maintenance / compliance rail.
 * Command Center design language — flat list, left-border severity, no rounded > sm.
 */

"use client";

import { cn } from "@/lib/utils";
import type { GMBrief } from "@/lib/copilot/types";
import type { CopilotOperatingScore } from "@/lib/copilot/types";

type Props = {
  brief: GMBrief;
  score: CopilotOperatingScore;
};

type Tone = "positive" | "warning" | "critical";

interface StatusItem {
  label: string;
  value: string;
  tone: Tone;
}

function rands(v: number): string {
  return `R${Math.abs(v).toLocaleString("en-ZA", { maximumFractionDigits: 0 })}`;
}

const TONE_COLOR: Record<Tone, string> = {
  positive: "text-emerald-400",
  warning:  "text-amber-400",
  critical: "text-red-400",
};

const TONE_BORDER: Record<Tone, string> = {
  positive: "border-l-emerald-600",
  warning:  "border-l-amber-500",
  critical: "border-l-red-500",
};

export default function BusinessStatus({ brief, score }: Props) {
  const items: StatusItem[] = [
    {
      label: "Revenue",
      value: brief.revenueGap > 0
        ? `${rands(brief.revenueGap)} behind`
        : "On target",
      tone: brief.revenueGap > brief.todayTarget * 0.15 ? "critical"
        : brief.revenueGap > 0 ? "warning" : "positive",
    },
    {
      label: "Labour",
      value: `${brief.labourPercent.toFixed(1)}%`,
      tone: brief.labourPercent > 37 ? "critical"
        : brief.labourPercent > 32 ? "warning" : "positive",
    },
    {
      label: "Covers",
      value: `${brief.coversActual}/${brief.coversForecast}`,
      tone: brief.coversActual < brief.coversForecast * 0.5 ? "critical"
        : brief.coversActual < brief.coversForecast * 0.7 ? "warning" : "positive",
    },
    {
      label: "Maintenance",
      value: score.breakdown.maintenance >= 7 ? "Clear"
        : score.breakdown.maintenance >= 3 ? "Issues open"
        : "Blocking",
      tone: score.breakdown.maintenance >= 7 ? "positive"
        : score.breakdown.maintenance >= 3 ? "warning" : "critical",
    },
    {
      label: "Compliance",
      value: score.breakdown.compliance >= 7 ? "Current"
        : score.breakdown.compliance >= 3 ? "Due soon"
        : "Expired",
      tone: score.breakdown.compliance >= 7 ? "positive"
        : score.breakdown.compliance >= 3 ? "warning" : "critical",
    },
  ];

  return (
    <div className="space-y-2">
      <h2 className="text-[9px] uppercase tracking-[0.2em] text-stone-600 font-semibold px-1">
        Business Status
      </h2>
      <div className="border border-[#1a1a1a] bg-[#0f0f0f] divide-y divide-[#1a1a1a]">
        {items.map((item) => (
          <div
            key={item.label}
            className={cn(
              "flex items-center justify-between px-4 py-2 border-l-[3px]",
              TONE_BORDER[item.tone],
            )}
          >
            <span className="text-[9px] uppercase tracking-wider text-stone-600 font-semibold">
              {item.label}
            </span>
            <span className={cn("text-[11px] font-mono font-semibold", TONE_COLOR[item.tone])}>
              {item.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
