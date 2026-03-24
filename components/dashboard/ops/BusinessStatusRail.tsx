/**
 * BusinessStatusRail — Right column of the Operating Brain cockpit.
 *
 * Compact, visually strong status indicators for all key business areas:
 * Revenue, Labour, Inventory, Maintenance, Compliance, Today.
 *
 * Each row is a clickable link with metric + trend + support text.
 */

import Link from "next/link";
import { cn } from "@/lib/utils";
import TrendIndicator from "@/components/ui/TrendIndicator";
import SourceBadge from "@/components/ui/SourceBadge";
import type { SourceType } from "@/components/ui/SourceBadge";
import type { TrendSignal } from "@/lib/commandCenter";

export interface StatusItem {
  key:         string;
  label:       string;
  metric:      string;
  metricSub?:  string;
  subtext:     string;
  tone:        "good" | "warning" | "danger" | "neutral";
  href:        string;
  trend?:      TrendSignal;
  sourceType?: SourceType;
  sourceAge?:  string;
}

interface Props {
  items: StatusItem[];
}

const TONE_STYLE: Record<string, string> = {
  good:    "text-emerald-600 dark:text-emerald-500",
  warning: "text-amber-600 dark:text-amber-400",
  danger:  "text-red-600 dark:text-red-400",
  neutral: "text-stone-500 dark:text-stone-500",
};

export default function BusinessStatusRail({ items }: Props) {
  return (
    <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 overflow-hidden">
      {/* Header */}
      <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-stone-100 dark:border-stone-800">
        <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400 dark:text-stone-600">
          Business Status
        </p>
      </div>

      {/* Status rows */}
      <div className="divide-y divide-stone-100 dark:divide-stone-800/60">
        {items.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            className="flex flex-wrap sm:flex-nowrap items-center gap-2 sm:gap-4 px-4 sm:px-6 py-3 sm:py-3.5 hover:bg-stone-50 dark:hover:bg-stone-800/40 transition-colors group"
          >
            {/* Label */}
            <span className="text-[10px] font-semibold uppercase tracking-widest text-stone-400 dark:text-stone-600 w-16 sm:w-24 shrink-0 group-hover:text-stone-500 dark:group-hover:text-stone-400">
              {item.label}
            </span>

            {/* Metric */}
            <div className="flex items-baseline gap-1 min-w-0">
              <span className="text-lg font-bold tabular-nums text-stone-900 dark:text-stone-100 leading-none">
                {item.metric}
              </span>
              {item.metricSub && (
                <span className="text-[10px] text-stone-400 dark:text-stone-600">
                  {item.metricSub}
                </span>
              )}
            </div>

            {/* Subtext + Trend */}
            <div className="flex-1 flex items-center gap-2 justify-end min-w-0">
              <span className={cn(
                "text-[11px] font-medium leading-tight truncate",
                TONE_STYLE[item.tone]
              )}>
                {item.subtext}
              </span>
              {item.trend && (
                <TrendIndicator
                  direction={item.trend.direction}
                  tone={item.trend.tone}
                  label={item.trend.label}
                />
              )}
              {item.sourceType && (
                <SourceBadge source={item.sourceType} ageLabel={item.sourceAge} />
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
