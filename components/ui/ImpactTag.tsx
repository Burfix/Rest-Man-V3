/**
 * ImpactTag — subtle priority label on critical action rows.
 *
 * Renders as a compact ring-inset badge, visually restrained.
 * Five levels: blocker · required_today · high_impact · quick_win · monitor
 */

import { cn } from "@/lib/utils";
import type { ImpactWeight } from "@/lib/commandCenter";

interface Props {
  weight:    ImpactWeight;
  className?: string;
}

const STYLES: Record<ImpactWeight, string> = {
  blocker:        "bg-red-50    text-red-700    ring-red-200    dark:bg-red-950/30    dark:text-red-400    dark:ring-red-800",
  required_today: "bg-amber-50  text-amber-700  ring-amber-200  dark:bg-amber-950/30  dark:text-amber-400  dark:ring-amber-800",
  high_impact:    "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950/30 dark:text-violet-400 dark:ring-violet-800",
  quick_win:      "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-500 dark:ring-emerald-800",
  monitor:        "bg-stone-100 text-stone-500   ring-stone-200  dark:bg-stone-800     dark:text-stone-500  dark:ring-stone-700",
};

const LABELS: Record<ImpactWeight, string> = {
  blocker:        "BLOCKER",
  required_today: "REQUIRED TODAY",
  high_impact:    "HIGH IMPACT",
  quick_win:      "QUICK WIN",
  monitor:        "MONITOR",
};

export default function ImpactTag({ weight, className }: Props) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-px text-[8px] font-bold uppercase tracking-wider leading-none ring-1 ring-inset shrink-0",
        STYLES[weight],
        className,
      )}
    >
      {LABELS[weight]}
    </span>
  );
}
