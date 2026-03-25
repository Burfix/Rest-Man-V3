/**
 * BusinessStatus — Revenue/labour/bookings/inventory/maintenance/compliance rail.
 *
 * Compact status overview of all domain areas with at-a-glance indicators.
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

const TONE_COLORS: Record<Tone, { dot: string; text: string }> = {
  positive: { dot: "bg-emerald-400", text: "text-emerald-400" },
  warning:  { dot: "bg-amber-400",  text: "text-amber-400" },
  critical: { dot: "bg-red-400",    text: "text-red-400" },
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
      label: "Inventory",
      value: score.breakdown.inventory >= 7 ? "Healthy"
        : score.breakdown.inventory >= 3 ? "Low stock"
        : "Critical",
      tone: score.breakdown.inventory >= 7 ? "positive"
        : score.breakdown.inventory >= 3 ? "warning" : "critical",
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
      <h2 className="text-xs uppercase tracking-widest text-stone-500 font-medium px-1">
        Business Status
      </h2>
      <div className="rounded-xl border border-stone-800/40 bg-stone-900/50 p-4">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {items.map((item) => {
            const t = TONE_COLORS[item.tone];
            return (
              <div key={item.label} className="flex items-center gap-2">
                <div className={cn("h-2 w-2 rounded-full flex-shrink-0", t.dot)} />
                <div className="min-w-0">
                  <span className="text-[10px] uppercase tracking-wider text-stone-500 block">
                    {item.label}
                  </span>
                  <span className={cn("text-xs font-medium", t.text)}>
                    {item.value}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
