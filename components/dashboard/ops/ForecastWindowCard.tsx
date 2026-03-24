/**
 * ForecastWindowCard — Replaces "Next 2h" with a richer forecast view.
 *
 * Shows the forward-looking operational forecast:
 * - Two-hour outlook text
 * - Confidence indicator
 * - Branded as "Forecast Window"
 */

import { cn } from "@/lib/utils";
import type { TwoHourOutlook } from "@/lib/commandCenter";

interface Props {
  outlook: TwoHourOutlook;
}

const CONFIDENCE_STYLE: Record<TwoHourOutlook["confidence"], {
  dot:    string;
  border: string;
  bg:     string;
  label:  string;
}> = {
  high:   { dot: "bg-emerald-500", border: "border-emerald-200 dark:border-emerald-900/50", bg: "bg-emerald-50/50 dark:bg-emerald-950/10", label: "High confidence" },
  medium: { dot: "bg-sky-400",     border: "border-sky-200 dark:border-sky-900/50",         bg: "bg-sky-50/50 dark:bg-sky-950/10",         label: "Medium confidence" },
  low:    { dot: "bg-amber-400",   border: "border-amber-200 dark:border-amber-900/50",     bg: "bg-amber-50/50 dark:bg-amber-950/10",     label: "Low confidence" },
  none:   { dot: "bg-stone-300 dark:bg-stone-600", border: "border-stone-100 dark:border-stone-800", bg: "bg-stone-50/50 dark:bg-stone-900/50", label: "Limited data" },
};

export default function ForecastWindowCard({ outlook }: Props) {
  const cfg = CONFIDENCE_STYLE[outlook.confidence];

  return (
    <div className={cn(
      "flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-4 rounded-2xl border px-4 sm:px-6 py-3 sm:py-4",
      cfg.border, cfg.bg
    )}>
      {/* Label */}
      <div className="shrink-0 mt-0.5">
        <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400 dark:text-stone-600">
          Forecast Window
        </p>
        <div className="flex items-center gap-1.5 mt-1.5">
          <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", cfg.dot)} />
          <span className="text-[10px] font-medium text-stone-400 dark:text-stone-500">
            {cfg.label}
          </span>
        </div>
      </div>

      {/* Divider */}
      <div className="hidden sm:block w-px h-10 bg-stone-200 dark:bg-stone-700 shrink-0 self-center" />

      {/* Outlook text */}
      <p className={cn(
        "flex-1 text-sm leading-relaxed",
        outlook.confidence === "none"
          ? "text-stone-400 dark:text-stone-600 italic"
          : "text-stone-700 dark:text-stone-300",
      )}>
        {outlook.text}
      </p>
    </div>
  );
}
