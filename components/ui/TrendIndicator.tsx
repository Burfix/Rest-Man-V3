/**
 * TrendIndicator — compact directional signal for KPI tiles.
 *
 * Usage:
 *   <TrendIndicator direction="up" tone="negative" label="rising" />
 *
 * Tone is context-sensitive:
 *   Revenue up   → positive
 *   Labour up    → negative (cost rising)
 *   Labour down  → positive (cost easing)
 */

import { cn } from "@/lib/utils";
import type { TrendDirection, TrendTone } from "@/lib/commandCenter";

interface Props {
  direction: TrendDirection;
  tone:      TrendTone;
  label:     string;
  className?: string;
}

const ARROW: Record<TrendDirection, string> = {
  up:   "↑",
  down: "↓",
  flat: "→",
};

const TONE_COLORS: Record<TrendTone, string> = {
  positive: "text-emerald-600",
  negative: "text-amber-600",
  neutral:  "text-stone-500 dark:text-stone-400",
};

export default function TrendIndicator({ direction, tone, label, className }: Props) {
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[10px] font-medium leading-none", TONE_COLORS[tone], className)}>
      <span aria-hidden>{ARROW[direction]}</span>
      <span>{label}</span>
    </span>
  );
}
