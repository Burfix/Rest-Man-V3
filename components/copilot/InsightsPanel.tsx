/**
 * InsightsPanel — Pattern + cause insights from the GM engine.
 *
 * Shows detected patterns, likely causes, and recommended actions.
 */

"use client";

import { cn } from "@/lib/utils";
import type { GMInsight, GMDecisionCategory, ConfidenceType } from "@/lib/copilot/types";

type Props = {
  insights: GMInsight[];
};

const CAT_ICON: Record<GMDecisionCategory, string> = {
  service: "🎯",
  revenue: "💰",
  labour: "👥",
  bookings: "📋",
  inventory: "📦",
  compliance: "📜",
  maintenance: "🔧",
  data: "📡",
};

const CONF_STYLE: Record<ConfidenceType, { bg: string; text: string }> = {
  measured:  { bg: "bg-emerald-950/20", text: "text-emerald-400" },
  inferred:  { bg: "bg-amber-950/20",  text: "text-amber-400" },
  estimated: { bg: "bg-stone-800/50",  text: "text-stone-400" },
};

export default function InsightsPanel({ insights }: Props) {
  if (insights.length === 0) return null;

  return (
    <div className="space-y-2">
      <h2 className="text-xs uppercase tracking-widest text-stone-500 font-medium px-1">
        Insights
      </h2>
      <div className="space-y-2">
        {insights.map((insight, i) => {
          const conf = CONF_STYLE[insight.confidenceType];
          return (
            <div key={i} className="rounded-xl border border-stone-800/40 bg-stone-900/50 p-4 space-y-2">
              <div className="flex items-start gap-2">
                <span className="text-sm flex-shrink-0">{CAT_ICON[insight.category]}</span>
                <div className="min-w-0">
                  <p className="text-sm text-stone-200 font-medium leading-tight">
                    {insight.detectedPattern}
                  </p>
                  <p className="text-xs text-stone-400 mt-1">
                    <span className="text-stone-500">Cause: </span>
                    {insight.likelyCause}
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs border-t border-stone-800/30 pt-2">
                <div className="text-stone-400">
                  <span className="text-stone-500">Do: </span>
                  {insight.recommendedAction}
                </div>
                <span className={cn("text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded", conf.bg, conf.text)}>
                  {insight.confidenceType}
                </span>
              </div>

              <p className="text-[11px] text-emerald-400/80">
                Impact: {insight.expectedImpact}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
