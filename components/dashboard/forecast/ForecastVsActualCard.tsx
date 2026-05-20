/**
 * ForecastVsActualCard — Pacing comparison card
 */

"use client";

import { cn, formatCurrency } from "@/lib/utils";
import type { PacingSnapshot } from "@/types/forecast";

const STATUS_CONFIG = {
  above_plan: { label: "Above Plan",  icon: "↑", color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/40", ring: "ring-emerald-200 dark:ring-emerald-800" },
  on_track:   { label: "On Track",    icon: "→", color: "text-blue-600 dark:text-blue-400",       bg: "bg-blue-50 dark:bg-blue-950/40",       ring: "ring-blue-200 dark:ring-blue-800" },
  below_plan: { label: "Below Plan",  icon: "↓", color: "text-red-600 dark:text-red-400",         bg: "bg-red-50 dark:bg-red-950/40",         ring: "ring-red-200 dark:ring-red-800" },
};

export default function ForecastVsActualCard({
  pacing,
  salesForecast,
  coversForecast,
}: {
  pacing: PacingSnapshot | null;
  salesForecast: number;
  coversForecast: number;
}) {
  if (!pacing) {
    return (
      <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-5">
        <Header />
        <div className="mt-4 rounded-lg bg-stone-50 dark:bg-stone-800/50 px-4 py-6 text-center">
          <p className="text-xs text-stone-500 dark:text-stone-400">
            Pacing data will appear once live sales start flowing today.
          </p>
          <div className="grid grid-cols-2 gap-3 mt-4">
            <MetricBox label="Forecast Sales" value={formatCurrency(salesForecast)} muted />
            <MetricBox label="Forecast Covers" value={String(coversForecast)} muted />
          </div>
        </div>
      </div>
    );
  }

  const cfg = STATUS_CONFIG[pacing.pacingStatus];

  return (
    <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-5">
      <Header />

      {/* Status badge */}
      <div className={cn("mt-3 flex items-center gap-2 rounded-lg px-3 py-2 ring-1", cfg.bg, cfg.ring)}>
        <span className={cn("text-lg font-bold", cfg.color)}>{cfg.icon}</span>
        <div>
          <p className={cn("text-xs font-semibold", cfg.color)}>{cfg.label}</p>
          <p className="text-[11px] text-stone-600 dark:text-stone-400">{pacing.pacingMessage}</p>
        </div>
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-2 gap-3 mt-4">
        <MetricBox
          label="Actual Sales"
          value={formatCurrency(pacing.actualSalesToDate)}
          sub={`vs ${formatCurrency(pacing.forecastSalesToDate)} forecast`}
          variance={pacing.salesVariancePct}
        />
        <MetricBox
          label="Actual Covers"
          value={String(pacing.actualCoversToDate)}
          sub={`vs ${pacing.forecastCoversToDate} forecast`}
          variance={pacing.coversVariancePct}
        />
      </div>
    </div>
  );
}

function Header() {
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-cyan-50 dark:bg-cyan-950/50">
        <span className="text-sm">📈</span>
      </div>
      <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
        Forecast vs Actual
      </h3>
    </div>
  );
}

function MetricBox({
  label,
  value,
  sub,
  variance,
  muted,
}: {
  label: string;
  value: string;
  sub?: string;
  variance?: number;
  muted?: boolean;
}) {
  return (
    <div className={cn(
      "rounded-lg px-3 py-2.5",
      muted
        ? "bg-stone-50 dark:bg-stone-800/50"
        : "bg-stone-50 dark:bg-stone-800/50",
    )}>
      <span className="text-[10px] uppercase tracking-wider text-stone-500 dark:text-stone-400">
        {label}
      </span>
      <p className={cn(
        "text-sm font-semibold mt-0.5",
        muted ? "text-stone-500 dark:text-stone-500" : "text-stone-900 dark:text-stone-100",
      )}>
        {value}
      </p>
      {sub && (
        <p className="text-[10px] text-stone-500 dark:text-stone-500 mt-0.5">{sub}</p>
      )}
      {variance != null && (
        <span className={cn(
          "text-[10px] font-semibold",
          variance > 0
            ? "text-emerald-600 dark:text-emerald-400"
            : variance < 0
            ? "text-red-600 dark:text-red-400"
            : "text-stone-500",
        )}>
          {variance > 0 ? "+" : ""}{variance}%
        </span>
      )}
    </div>
  );
}
