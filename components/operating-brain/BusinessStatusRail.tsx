/**
 * BusinessStatusRail — Compact vertical status rail for the secondary column.
 *
 * Shows Revenue, Labour, Inventory, Maintenance, Compliance —
 * each with label, current state, supporting text, and tone.
 * Supporting context, not the hero.
 */

"use client";

import { cn } from "@/lib/utils";
import type { EvaluateOperationsOutput, BusinessStatusTone } from "@/services/decision-engine";

type Props = {
  status: EvaluateOperationsOutput["businessStatus"];
};

const TONE_STYLES: Record<BusinessStatusTone, { text: string; dot: string }> = {
  positive: { text: "text-emerald-400", dot: "bg-emerald-400" },
  warning:  { text: "text-amber-400",   dot: "bg-amber-400"   },
  critical: { text: "text-red-400",     dot: "bg-red-400"     },
  neutral:  { text: "text-stone-400",   dot: "bg-stone-500"   },
};

const CATEGORY_ICON: Record<string, string> = {
  revenue: "💰",
  labour: "👥",
  inventory: "📦",
  maintenance: "🔧",
  compliance: "📋",
};

type StatusKey = keyof EvaluateOperationsOutput["businessStatus"];
const KEYS: StatusKey[] = ["revenue", "labour", "inventory", "maintenance", "compliance"];

export default function BusinessStatusRail({ status }: Props) {
  return (
    <div className="space-y-2">
      <h2 className="text-xs uppercase tracking-widest text-stone-500 font-medium px-1">
        Business Status
      </h2>
      <div className="rounded-xl border border-stone-800/40 bg-stone-900/50 divide-y divide-stone-800/40">
        {KEYS.map((key) => {
          const item = status[key];
          const tone = TONE_STYLES[item.tone];
          return (
            <div key={key} className="flex items-start gap-3 px-4 py-3">
              <span className="text-sm mt-0.5">{CATEGORY_ICON[key]}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wider text-stone-500 font-medium">
                    {key}
                  </span>
                  <span className={cn("h-1.5 w-1.5 rounded-full", tone.dot)} />
                </div>
                <p className={cn("text-sm font-semibold mt-0.5", tone.text)}>
                  {item.label}
                </p>
                <p className="text-[11px] text-stone-500 mt-0.5 leading-snug">
                  {item.supportingText}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
