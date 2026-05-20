/**
 * InsightsPanel — Pattern + cause insights from the GM engine.
 * Command Center design language — left-border severity, no emoji, IF IGNORED opacity.
 */

"use client";

import { cn } from "@/lib/utils";
import type { GMInsight, GMDecisionCategory, ConfidenceType } from "@/lib/copilot/types";

type Props = {
  insights: GMInsight[];
};

const CAT_LABEL: Record<GMDecisionCategory, string> = {
  service:     "Service",
  revenue:     "Revenue",
  labour:      "Labour",
  bookings:    "Bookings",
  compliance:  "Compliance",
  maintenance: "Maintenance",
  data:        "Data",
};

const CONF_COLOR: Record<ConfidenceType, string> = {
  measured:  "text-emerald-400",
  inferred:  "text-amber-400",
  estimated: "text-stone-500",
};

const CAT_BORDER: Record<GMDecisionCategory, string> = {
  service:     "border-l-amber-500",
  revenue:     "border-l-emerald-500",
  labour:      "border-l-orange-500",
  bookings:    "border-l-stone-500",
  compliance:  "border-l-red-500",
  maintenance: "border-l-orange-500",
  data:        "border-l-stone-600",
};

export default function InsightsPanel({ insights }: Props) {
  if (insights.length === 0) return null;

  return (
    <div className="space-y-2">
      <h2 className="text-[9px] uppercase tracking-[0.2em] text-stone-600 font-semibold px-1">
        Insights
      </h2>
      <div className="border border-[#1a1a1a] bg-[#0f0f0f] divide-y divide-[#1a1a1a]">
        {insights.map((insight, i) => (
          <div
            key={i}
            className={cn(
              "border-l-[3px] px-4 py-3 space-y-1.5",
              CAT_BORDER[insight.category] ?? "border-l-stone-600",
            )}
          >
            {/* Header row */}
            <div className="flex items-center gap-2">
              <span className="text-[9px] uppercase tracking-wider text-stone-600 font-semibold">
                {CAT_LABEL[insight.category] ?? insight.category}
              </span>
              <span className="text-stone-700">·</span>
              <span className={cn("text-[9px] uppercase tracking-wider font-semibold", CONF_COLOR[insight.confidenceType])}>
                {insight.confidenceType}
              </span>
            </div>

            {/* Pattern */}
            <p className="text-[11px] text-stone-700 dark:text-stone-200 leading-snug font-medium">
              {insight.detectedPattern}
            </p>

            {/* Cause */}
            <p className="text-[10px] text-stone-500 leading-snug">
              <span className="text-stone-600 uppercase tracking-wider text-[9px]">Cause </span>
              {insight.likelyCause}
            </p>

            {/* Action + Impact */}
            <div className="flex items-center justify-between pt-0.5 border-t border-[#1a1a1a]">
              <p className="text-[10px] text-stone-500 dark:text-stone-400 leading-snug">
                <span className="text-stone-600 uppercase tracking-wider text-[9px]">Do </span>
                {insight.recommendedAction}
              </p>
              <span className="text-[10px] text-emerald-400/80 font-mono ml-3 flex-shrink-0">
                {insight.expectedImpact}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
