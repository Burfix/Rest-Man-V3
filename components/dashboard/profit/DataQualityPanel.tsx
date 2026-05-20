/**
 * components/dashboard/profit/DataQualityPanel.tsx
 *
 * Shows the confidence level and data quality flags at the bottom of the page.
 * Transparent about what's estimated vs live.
 */

"use client";

import { cn } from "@/lib/utils";
import type { DataQuality, ConfidenceLevel } from "@/lib/profit/types";

const CONFIDENCE_STYLES: Record<ConfidenceLevel, { dot: string; label: string; bg: string }> = {
  high:   { dot: "bg-emerald-500", label: "High Confidence", bg: "bg-emerald-50 dark:bg-emerald-900/15 border-emerald-200 dark:border-emerald-800/40" },
  medium: { dot: "bg-amber-500",   label: "Medium Confidence", bg: "bg-amber-50 dark:bg-amber-900/15 border-amber-200 dark:border-amber-800/40" },
  low:    { dot: "bg-red-500",     label: "Low Confidence",  bg: "bg-red-50 dark:bg-red-900/15 border-red-200 dark:border-red-800/40" },
};

const FLAG_SEVERITY: Record<string, string> = {
  info:     "text-stone-500 dark:text-stone-400",
  warning:  "text-amber-700 dark:text-amber-400",
  critical: "text-red-700 dark:text-red-400",
};

const CONNECT_STEPS = [
  { key: "sales", label: "Connect MICROS sales", done: false },
  { key: "labour", label: "Sync labour data", done: false },
  { key: "food_cost", label: "Configure food cost target", done: false },
  { key: "overhead", label: "Add overhead estimate", done: false },
];

export function DataQualityPanel({ quality }: { quality: DataQuality }) {
  const style = CONFIDENCE_STYLES[quality.confidenceLevel];

  return (
    <div className={cn(
      "rounded-xl border p-4 flex flex-col gap-3",
      style.bg,
    )}>
      <div className="flex items-center gap-2">
        <span className={cn("w-2 h-2 rounded-full shrink-0", style.dot)} />
        <span className="text-[10px] font-bold uppercase tracking-widest text-stone-500">
          {style.label}
        </span>
      </div>

      <p className="text-[12px] text-stone-700 dark:text-stone-300 leading-relaxed">
        {quality.summary}
      </p>

      {quality.flags.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {quality.flags.map((flag) => (
            <li key={flag.key} className="flex items-start gap-2">
              <span className="mt-0.5 text-stone-400">·</span>
              <span className={cn("text-[11px] leading-relaxed", FLAG_SEVERITY[flag.severity] ?? FLAG_SEVERITY.info)}>
                {flag.message}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Setup checklist when confidence is low */}
      {quality.confidenceLevel === "low" && (
        <div className="mt-1 border-t border-stone-200 dark:border-stone-700 pt-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-stone-500 mb-2">
            Connect data sources to enable Profit Intelligence
          </p>
          <ul className="flex flex-col gap-1.5">
            {CONNECT_STEPS.map((step) => (
              <li key={step.key} className="flex items-center gap-2 text-[12px] text-stone-600 dark:text-stone-400">
                <span className="w-4 h-4 rounded-full border border-stone-300 dark:border-stone-600 flex items-center justify-center shrink-0">
                  {step.done && <span className="w-2 h-2 rounded-full bg-emerald-500" />}
                </span>
                {step.label}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
