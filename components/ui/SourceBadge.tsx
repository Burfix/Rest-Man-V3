/**
 * SourceBadge — compact data-source/freshness badge
 *
 * Used throughout the dashboard to show where data comes from and how fresh it is.
 * Keeps the existing understated palette — never overpowers card content.
 *
 * Sources:
 *   micros_live   — green pulse dot, "MICROS LIVE · 4m"
 *   labour_sync   — green, "LABOUR SYNC · 12m"
 *   csv_upload    — sky, "CSV UPLOAD"
 *   historical    — stone, "HISTORICAL"
 *   forecast      — violet, "FORECAST"
 *   manual        — stone, "MANUAL · 5d"
 *   stale         — amber, "STALE · 2d"
 *   error         — red, "SYNC ERROR"
 *   awaiting      — stone dashed, "AWAITING SETUP"
 */

import { cn } from "@/lib/utils";

export type SourceType =
  | "micros_live"
  | "labour_sync"
  | "csv_upload"
  | "historical"
  | "forecast"
  | "manual"
  | "stale"
  | "error"
  | "awaiting";

interface Props {
  source:     SourceType;
  ageLabel?:  string;      // e.g. "4m", "2d", "12m" — shown after ·
  className?: string;
}

const STYLES: Record<SourceType, { cls: string; dot: string; label: string; pulse?: boolean }> = {
  micros_live:  {
    cls:   "bg-emerald-50 text-emerald-700 ring-emerald-200",
    dot:   "bg-emerald-500",
    label: "MICROS LIVE",
    pulse: true,
  },
  labour_sync:  {
    cls:   "bg-emerald-50 text-emerald-700 ring-emerald-200",
    dot:   "bg-emerald-500",
    label: "LABOUR SYNC",
  },
  csv_upload:   {
    cls:   "bg-sky-50 text-sky-700 ring-sky-200",
    dot:   "bg-sky-400",
    label: "CSV UPLOAD",
  },
  historical:   {
    cls:   "bg-stone-100 text-stone-500 ring-stone-200",
    dot:   "bg-stone-400",
    label: "HISTORICAL",
  },
  forecast:     {
    cls:   "bg-violet-50 text-violet-700 ring-violet-200",
    dot:   "bg-violet-400",
    label: "FORECAST",
  },
  manual:       {
    cls:   "bg-stone-100 text-stone-500 ring-stone-200",
    dot:   "bg-stone-400",
    label: "MANUAL",
  },
  stale:        {
    cls:   "bg-amber-50 text-amber-700 ring-amber-200",
    dot:   "bg-amber-400",
    label: "STALE",
  },
  error:        {
    cls:   "bg-red-50 text-red-700 ring-red-200",
    dot:   "bg-red-500",
    label: "SYNC ERROR",
  },
  awaiting:     {
    cls:   "bg-stone-50 text-stone-400 ring-stone-200",
    dot:   "bg-stone-300",
    label: "AWAITING",
  },
};

export default function SourceBadge({ source, ageLabel, className }: Props) {
  const cfg = STYLES[source];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider ring-1 ring-inset leading-none",
        cfg.cls,
        className,
      )}
    >
      <span
        className={cn(
          "h-1 w-1 rounded-full shrink-0",
          cfg.dot,
          cfg.pulse && "animate-pulse",
        )}
      />
      {cfg.label}
      {ageLabel && (
        <>
          <span className="opacity-60 mx-px">·</span>
          {ageLabel}
        </>
      )}
    </span>
  );
}
