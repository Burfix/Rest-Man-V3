/**
 * BusinessStatusRail — Compact vertical status rail for the secondary column.
 *
 * Shows Revenue, Labour, Inventory, Maintenance, Compliance —
 * each with a horizontal fill bar showing % of target, label, and tone.
 * Click any row to expand supporting text.
 */

"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { EvaluateOperationsOutput, BusinessStatusTone } from "@/services/decision-engine";

type Props = {
  status: EvaluateOperationsOutput["businessStatus"];
};

const TONE_STYLES: Record<BusinessStatusTone, { text: string; bar: string }> = {
  positive: { text: "text-emerald-400", bar: "bg-emerald-500/60" },
  warning:  { text: "text-amber-400",   bar: "bg-amber-500/60"   },
  critical: { text: "text-red-400",     bar: "bg-red-500/60"     },
  neutral:  { text: "text-stone-400",   bar: "bg-stone-600"      },
};

// Approximate fill % from tone for the indicator bar
const TONE_FILL: Record<BusinessStatusTone, number> = {
  positive: 82,
  warning: 46,
  critical: 18,
  neutral: 55,
};

type StatusKey = keyof EvaluateOperationsOutput["businessStatus"];
const KEYS: StatusKey[] = ["revenue", "labour", "inventory", "maintenance", "compliance"];

export default function BusinessStatusRail({ status }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <h2 className="text-[9px] uppercase tracking-[0.2em] text-stone-600 font-semibold px-1">
        Business Status
      </h2>
      <div className="rounded border border-stone-800/40 bg-stone-900/50 divide-y divide-stone-800/40">
        {KEYS.map((key) => {
          const item = status[key];
          const tone = TONE_STYLES[item.tone];
          const fillPct = TONE_FILL[item.tone];
          const isExp = expanded === key;
          const isRevenue = key === "revenue";

          return (
            <div
              key={key}
              className="px-4 py-2.5 cursor-pointer hover:bg-stone-800/20 transition-colors"
              onClick={() => setExpanded(isExp ? null : key)}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="text-[9px] uppercase tracking-widest text-stone-600 font-medium w-[72px] shrink-0">
                    {key}
                  </span>
                  <p className={cn(
                    "font-semibold leading-tight truncate",
                    isRevenue ? "text-base font-black" : "text-sm",
                    tone.text
                  )}>
                    {item.label}
                  </p>
                </div>
                <span className="text-stone-700 text-[9px] font-mono shrink-0">
                  {isExp ? "▲" : "▼"}
                </span>
              </div>

              {/* Fill bar */}
              <div className="mt-1.5 h-0.5 bg-stone-800 overflow-hidden">
                <div
                  className={cn("h-full transition-all duration-700", tone.bar)}
                  style={{ width: `${fillPct}%` }}
                />
              </div>

              {/* Expanded supporting text */}
              {isExp && (
                <p className="mt-1.5 text-[10px] text-stone-500 leading-snug">
                  {item.supportingText}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
