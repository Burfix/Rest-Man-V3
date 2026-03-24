/**
 * SinceLastCheck — Compact habit-loop strip below the command bar.
 *
 * Shows 3–4 quick status updates since the GM last checked.
 * Lightweight, scannable, drives daily check-in behaviour.
 */

"use client";

import { cn } from "@/lib/utils";
import type { EvaluateOperationsOutput } from "@/services/decision-engine";

type Props = {
  items: EvaluateOperationsOutput["sinceLastCheck"];
};

const TONE_STYLES: Record<string, { text: string; dot: string }> = {
  positive: { text: "text-emerald-400", dot: "bg-emerald-400" },
  warning:  { text: "text-amber-400",   dot: "bg-amber-400"   },
  critical: { text: "text-red-400",     dot: "bg-red-400"     },
  neutral:  { text: "text-stone-400",   dot: "bg-stone-500"   },
};

const DIRECTION_ICON: Record<string, string> = {
  up:   "↑",
  down: "↓",
  new:  "•",
};

export default function SinceLastCheck({ items }: Props) {
  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 py-1.5 text-xs">
      <span className="text-[10px] uppercase tracking-widest text-stone-500 font-medium mr-1">
        Since last check
      </span>
      {items.slice(0, 4).map((item, i) => {
        const tone = TONE_STYLES[item.tone ?? "neutral"];
        return (
          <span key={i} className={cn("flex items-center gap-1.5", tone.text)}>
            <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", tone.dot)} />
            {item.direction && (
              <span className="font-mono text-[10px]">
                {DIRECTION_ICON[item.direction]}
              </span>
            )}
            {item.label}
          </span>
        );
      })}
    </div>
  );
}
