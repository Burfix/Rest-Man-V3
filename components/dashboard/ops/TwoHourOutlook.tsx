/**
 * TwoHourOutlook — compact predictive insight row in the Command Center.
 *
 * Shows a forward-looking operator forecast for the next ~2 hours.
 * Confidence state (none/low) renders a muted "monitoring" fallback.
 * Visually matches the slim FreshnessBar / MICROS strip aesthetic.
 */

import { cn } from "@/lib/utils";
import type { TwoHourOutlook } from "@/lib/commandCenter";

interface Props {
  outlook: TwoHourOutlook;
}

const CONFIDENCE_DOT: Record<TwoHourOutlook["confidence"], string> = {
  high:   "bg-emerald-500",
  medium: "bg-sky-400",
  low:    "bg-amber-400",
  none:   "bg-stone-300 dark:bg-stone-600",
};

const CONFIDENCE_LABEL: Record<TwoHourOutlook["confidence"], string> = {
  high:   "",
  medium: "",
  low:    " · low confidence",
  none:   " · limited data",
};

export default function TwoHourOutlook({ outlook }: Props) {
  return (
    <div className={cn(
      "flex items-start gap-3 rounded-xl border px-5 py-3",
      outlook.confidence === "none"
        ? "border-stone-100 dark:border-stone-800 bg-stone-50 dark:bg-stone-900/50"
        : "border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900",
    )}>
      {/* Label */}
      <span className="shrink-0 mt-px text-[10px] font-bold uppercase tracking-widest text-stone-400 dark:text-stone-600 whitespace-nowrap">
        Next 2h
      </span>
      <span className="shrink-0 mt-px text-stone-200 dark:text-stone-700">·</span>

      {/* Outlook text */}
      <p className={cn(
        "flex-1 text-xs leading-snug",
        outlook.confidence === "none"
          ? "text-stone-400 dark:text-stone-600 italic"
          : "text-stone-700 dark:text-stone-300",
      )}>
        {outlook.text}
      </p>

      {/* Confidence dot */}
      <div className="shrink-0 flex items-center gap-1 mt-px">
        <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", CONFIDENCE_DOT[outlook.confidence])} />
        {CONFIDENCE_LABEL[outlook.confidence] && (
          <span className="text-[9px] text-stone-400 dark:text-stone-600 font-medium leading-none whitespace-nowrap">
            {CONFIDENCE_LABEL[outlook.confidence].replace(" · ", "")}
          </span>
        )}
      </div>
    </div>
  );
}
