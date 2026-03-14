/**
 * SeverityBadge — left-rail severity marker for attention lists and tables.
 *
 * Renders a bold colored pill with a single dot indicator.
 * Distinct from StatusChip: wider, used as a row-level severity marker.
 */

import { cn } from "@/lib/utils";

export type SeverityLevel = "critical" | "urgent" | "action" | "monitor";

const CONFIG: Record<SeverityLevel, { label: string; classes: string; dot: string }> = {
  critical: {
    label:   "CRITICAL",
    classes: "bg-red-600 text-white",
    dot:     "bg-white animate-pulse",
  },
  urgent: {
    label:   "URGENT",
    classes: "bg-amber-500 text-white",
    dot:     "bg-white",
  },
  action: {
    label:   "ACTION",
    classes: "bg-blue-600 text-white",
    dot:     "bg-white",
  },
  monitor: {
    label:   "MONITOR",
    classes: "bg-stone-200 text-stone-700",
    dot:     "bg-stone-500",
  },
};

interface Props {
  level:      SeverityLevel;
  className?: string;
}

export default function SeverityBadge({ level, className }: Props) {
  const cfg = CONFIG[level];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-widest whitespace-nowrap shrink-0",
        cfg.classes,
        className
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", cfg.dot)} />
      {cfg.label}
    </span>
  );
}
