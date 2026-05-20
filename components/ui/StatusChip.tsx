/**
 * StatusChip — compact semantic status pill used throughout the command center.
 *
 * Variants map directly to operational meaning:
 *   critical → immediate risk (red fill)
 *   urgent   → needs action today (amber fill)
 *   warning  → attention soon (amber tint)
 *   ok       → on track / compliant (emerald tint)
 *   info     → informational (blue tint)
 *   neutral  → default / no data (stone tint)
 */

import { cn } from "@/lib/utils";

export type StatusVariant =
  | "critical"
  | "urgent"
  | "warning"
  | "ok"
  | "info"
  | "neutral"
  | "muted";

export type StatusSize = "xs" | "sm" | "md";

const VARIANTS: Record<StatusVariant, string> = {
  critical: "bg-red-600   text-white    ring-red-700/20",
  urgent:   "bg-amber-500 text-white    ring-amber-600/20",
  warning:  "bg-amber-50  text-amber-800 ring-1 ring-amber-200",
  ok:       "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200",
  info:     "bg-blue-50   text-blue-800  ring-1 ring-blue-200",
  neutral:  "bg-stone-100 text-stone-600 ring-1 ring-stone-200",
  muted:    "text-stone-500 dark:text-stone-400 ring-1 ring-stone-200 bg-transparent",
};

const SIZES: Record<StatusSize, string> = {
  xs: "px-1.5 py-px text-[10px] font-semibold tracking-wide",
  sm: "px-2   py-0.5 text-[11px] font-semibold tracking-wide",
  md: "px-2.5 py-1   text-xs    font-semibold",
};

interface Props {
  variant?: StatusVariant;
  size?:    StatusSize;
  dot?:     boolean;     // animated dot prefix (for critical/live states)
  children: React.ReactNode;
  className?: string;
}

export default function StatusChip({
  variant   = "neutral",
  size      = "sm",
  dot       = false,
  children,
  className,
}: Props) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full whitespace-nowrap",
        VARIANTS[variant],
        SIZES[size],
        (variant === "critical" || variant === "urgent") ? "ring-0" : "",
        className
      )}
    >
      {dot && (
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full shrink-0",
            variant === "critical" ? "bg-white animate-pulse" :
            variant === "urgent"   ? "bg-white" :
            variant === "warning"  ? "bg-amber-500" :
            variant === "ok"       ? "bg-emerald-500" :
            "bg-current opacity-60"
          )}
        />
      )}
      {children}
    </span>
  );
}
