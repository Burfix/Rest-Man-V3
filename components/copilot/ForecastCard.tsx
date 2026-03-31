/**
 * ForecastCard — Historical pattern-based day projection.
 *
 * Sidebar card for GM Co-Pilot showing:
 *   — Projected close revenue
 *   — vs same day last year
 *   — vs 4-week weekday average
 *   — Confidence chip
 */

import { cn } from "@/lib/utils";
import type { ForecastResult } from "@/services/forecasting/forecast-engine";

type Props = {
  forecast: ForecastResult;
};

function rands(v: number): string {
  return `R${Math.round(v).toLocaleString("en-ZA", { maximumFractionDigits: 0 })}`;
}

function pctLabel(v: number | null): string {
  if (v == null) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

const CONFIDENCE_STYLES = {
  high:   "text-emerald-400 border-emerald-800/40",
  medium: "text-amber-400 border-amber-800/40",
  low:    "text-stone-500 border-stone-700/40",
};

export default function ForecastCard({ forecast }: Props) {
  const vsTargetColor =
    forecast.vsTarget >= 0
      ? "text-emerald-400"
      : forecast.vsTarget > -10
        ? "text-amber-400"
        : "text-red-400";

  const vsSdlyColor =
    forecast.vsSameDayLastYear == null
      ? "text-stone-600"
      : forecast.vsSameDayLastYear >= 0
        ? "text-emerald-400"
        : forecast.vsSameDayLastYear > -10
          ? "text-amber-400"
          : "text-red-400";

  const vsAvgColor =
    forecast.vsSameWeekdayAvg >= 0
      ? "text-emerald-400"
      : forecast.vsSameWeekdayAvg > -10
        ? "text-amber-400"
        : "text-red-400";

  return (
    <div className="border border-[#1a1a1a] border-l-[3px] border-l-stone-600 bg-[#0f0f0f] px-4 py-3 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-mono tracking-[0.15em] text-stone-600 uppercase">
          Day Projection
        </span>
        <span className={cn(
          "text-[9px] font-mono border px-1.5 py-0.5 uppercase tracking-widest",
          CONFIDENCE_STYLES[forecast.confidence]
        )}>
          {forecast.confidence}
        </span>
      </div>

      {/* Projected close — dominant number */}
      <div>
        <span className="text-[9px] font-mono tracking-[0.12em] text-stone-600 uppercase block mb-0.5">
          Projected Close
        </span>
        <span className="text-xl font-bold font-mono text-stone-100">
          {rands(forecast.projectedClose)}
        </span>
      </div>

      {/* Comparison row */}
      <div className="space-y-1.5 pt-0.5">
        <CompareRow
          label="vs Same Day LY"
          value={pctLabel(forecast.vsSameDayLastYear)}
          valueColor={vsSdlyColor}
          unavailable={forecast.vsSameDayLastYear == null}
        />
        <CompareRow
          label="vs 4-Week Avg"
          value={pctLabel(forecast.vsSameWeekdayAvg)}
          valueColor={vsAvgColor}
        />
        <CompareRow
          label="vs Target"
          value={pctLabel(forecast.vsTarget)}
          valueColor={vsTargetColor}
        />
      </div>

      {/* Warning */}
      {forecast.warning && (
        <p className="text-[10px] text-amber-400/70 leading-snug pt-0.5">
          {forecast.warning}
        </p>
      )}
    </div>
  );
}

function CompareRow({
  label,
  value,
  valueColor,
  unavailable,
}: {
  label: string;
  value: string;
  valueColor: string;
  unavailable?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[10px] text-stone-600 font-mono">{label}</span>
      <span className={cn(
        "text-[11px] font-mono font-semibold",
        unavailable ? "text-stone-700" : valueColor
      )}>
        {value}
      </span>
    </div>
  );
}
