/**
 * OperatingBrainHeader — Premium identity bar for the ForgeStack Operating Brain.
 *
 * Replaces "Operations Command" with stronger product identity.
 * Shows venue name, service period, date, and a compact alert badge.
 */

import { cn, formatDisplayDate } from "@/lib/utils";

interface Props {
  venueName:     string;
  date:          string;
  servicePeriod: string;
  alertCount:    number;
}

const PERIOD_STYLE: Record<string, string> = {
  Breakfast:     "bg-amber-100/80  dark:bg-amber-900/20  text-amber-700  dark:text-amber-400",
  Lunch:         "bg-emerald-100/80 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400",
  Afternoon:     "bg-sky-100/80    dark:bg-sky-900/20    text-sky-700    dark:text-sky-400",
  Dinner:        "bg-violet-100/80 dark:bg-violet-900/20 text-violet-700 dark:text-violet-400",
  "After Hours": "bg-stone-100/80  dark:bg-stone-800/60  text-stone-500  dark:text-stone-400",
};

export default function OperatingBrainHeader({ venueName, date, servicePeriod, alertCount }: Props) {
  const periodStyle = PERIOD_STYLE[servicePeriod] ?? PERIOD_STYLE["After Hours"];

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-4 pb-2">
      {/* Left: Identity + Product Name */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center gap-2">
          <div className="h-8 w-1 rounded-full bg-blue-600 dark:bg-blue-500" />
          <div>
            <h1 className="text-base sm:text-lg font-bold tracking-tight text-stone-900 dark:text-stone-100 leading-none truncate">
              {venueName}
            </h1>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-blue-600 dark:text-blue-400 mt-0.5">
              ForgeStack Operating Brain
            </p>
          </div>
        </div>
      </div>

      {/* Right: Date + Period + Alerts */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        <span className="text-[10px] sm:text-xs text-stone-500 dark:text-stone-500">
          {formatDisplayDate(date)}
        </span>
        <span className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold",
          periodStyle
        )}>
          <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
          {servicePeriod}
        </span>
        {alertCount > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-600 px-2.5 py-1 text-[10px] font-bold text-white leading-none">
            <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
            {alertCount}
          </span>
        )}
      </div>
    </div>
  );
}
