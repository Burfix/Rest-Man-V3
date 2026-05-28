/**
 * components/dashboard/profit/ProfitKpiStrip.tsx
 *
 * Revenue Mission Bar — the top-of-page engagement hook for store managers.
 *
 * Shows:
 *  - Large revenue progress bar toward daily target
 *  - EOD pace projection (today range only, client-side calculation)
 *  - Live / Stale data pulse indicator
 *  - 4 traffic-light metric tiles (Labour, Food Cost, Margin, Op Profit)
 */

"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { ProfitIntelligenceResult } from "@/lib/profit/types";

// ── Formatting ────────────────────────────────────────────────────────────────

function fmtCurrency(n: number | null, symbol: string): string {
  if (n == null) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${symbol}${(n / 1_000_000).toFixed(2)}m`;
  if (abs >= 1_000)     return `${symbol}${Math.round(n / 1_000)}k`;
  return `${symbol}${Math.round(n).toLocaleString()}`;
}

function fmtPct(n: number | null): string {
  if (n == null) return "—";
  return `${n.toFixed(1)}%`;
}

// ── Traffic light logic ───────────────────────────────────────────────────────

type TL = "green" | "amber" | "red" | "none";

/**
 * Compute traffic light for a metric vs its target.
 * @param value       Current metric value
 * @param target      Target value
 * @param higherBetter True when higher value = better (e.g. margin), false when lower = better (e.g. labour %)
 * @param warningBand How many percentage points away from target before turning amber
 */
function trafficLight(
  value: number | null,
  target: number | null,
  higherBetter: boolean,
  warningBand = 3,
): TL {
  if (value == null || target == null) return "none";
  if (higherBetter) {
    if (value >= target)               return "green";
    if (value >= target - warningBand) return "amber";
    return "red";
  } else {
    if (value <= target)               return "green";
    if (value <= target + warningBand) return "amber";
    return "red";
  }
}

const TL_DOT: Record<TL, string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red:   "bg-red-500",
  none:  "bg-stone-400",
};

const TL_VALUE: Record<TL, string> = {
  green: "text-emerald-700 dark:text-emerald-400",
  amber: "text-amber-700 dark:text-amber-400",
  red:   "text-red-600 dark:text-red-400",
  none:  "text-stone-700 dark:text-stone-300",
};

const TL_STATUS: Record<TL, string> = {
  green: "On Track",
  amber: "Watch",
  red:   "Over Target",
  none:  "No Data",
};

// ── Metric tile ───────────────────────────────────────────────────────────────

function MetricTile({
  label,
  value,
  tl,
  sub,
  isEstimated,
}: {
  label: string;
  value: string;
  tl: TL;
  sub?: string;
  isEstimated?: boolean;
}) {
  return (
    <div className="rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 px-4 py-3 flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <span className={cn("w-2 h-2 rounded-full shrink-0 transition-colors", TL_DOT[tl])} />
        <p className="text-[10px] font-bold uppercase tracking-widest text-stone-500 truncate">{label}</p>
        {isEstimated && (
          <span className="shrink-0 rounded px-1 py-0.5 text-[8px] font-bold uppercase bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
            Est
          </span>
        )}
      </div>
      <p className={cn("text-[22px] font-extrabold tabular-nums leading-none", TL_VALUE[tl])}>
        {value}
      </p>
      <p className="text-[10px] text-stone-400 dark:text-stone-500 truncate">
        {sub ?? TL_STATUS[tl]}
      </p>
    </div>
  );
}

// ── EOD projection ────────────────────────────────────────────────────────────

/**
 * Client-side EOD revenue projection for the "today" range.
 * Uses a 07:00–22:00 service window. Returns null if too early,
 * service is over, or range is not "today".
 */
function useEodProjection(revenue: number | null, dateRange: string): number | null {
  return useMemo(() => {
    if (revenue == null || revenue <= 0 || dateRange !== "today") return null;
    const now   = new Date();
    const open  = new Date(now); open.setHours(7, 0, 0, 0);
    const close = new Date(now); close.setHours(22, 0, 0, 0);
    const totalMs   = close.getTime() - open.getTime();
    const elapsedMs = Math.max(0, Math.min(now.getTime() - open.getTime(), totalMs));
    const fraction  = elapsedMs / totalMs;
    // Suppress if fewer than 8% of service elapsed (projection would be absurd)
    if (fraction < 0.08 || fraction >= 0.98) return null;
    return Math.round(revenue / fraction);
  }, [revenue, dateRange]);
}

// ── Main component ────────────────────────────────────────────────────────────

export function ProfitKpiStrip({ data }: { data: ProfitIntelligenceResult }) {
  const s   = data.currencySymbol;
  const eod = useEodProjection(data.revenue, data.dateRange);

  // Revenue progress
  const revPct =
    data.revenue != null && data.targetRevenue != null && data.targetRevenue > 0
      ? Math.min(100, (data.revenue / data.targetRevenue) * 100)
      : null;

  const revTL: TL =
    revPct == null ? "none" :
    revPct >= 100  ? "green" :
    revPct >= 75   ? "amber" :
    "red";

  // Metric traffic lights
  const labourTL  = trafficLight(data.labourPct,      data.targetLabourPct,   false, 3);
  const foodTL    = trafficLight(data.foodCostPct,     data.targetFoodCostPct, false, 3);
  const marginTL  = trafficLight(data.grossMarginPct,  data.targetMarginPct,   true,  2);
  const profitTL: TL =
    data.operatingProfitEstimate == null ? "none" :
    data.operatingProfitEstimate > 0     ? "green" :
    data.operatingProfitEstimate > -2000 ? "amber" :
    "red";

  const barColor =
    revTL === "green" ? "bg-emerald-500" :
    revTL === "amber" ? "bg-amber-400"   :
    "bg-red-500";

  const isStale = data.dataQuality.staleSales;

  return (
    <div className="flex flex-col gap-3">
      {/* ── Revenue Mission Card ─────────────────────────────────────────── */}
      <div className="rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 px-5 pt-4 pb-4">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-1">
              Revenue Mission
            </p>
            <div className="flex items-baseline gap-2.5 flex-wrap">
              <span className="text-3xl font-extrabold tabular-nums leading-none text-stone-900 dark:text-stone-100">
                {fmtCurrency(data.revenue, s)}
              </span>
              {data.targetRevenue != null && (
                <span className="text-sm text-stone-500">
                  of{" "}
                  <span className="font-semibold text-stone-700 dark:text-stone-300">
                    {fmtCurrency(data.targetRevenue, s)}
                  </span>{" "}
                  target
                </span>
              )}
            </div>
          </div>

          {/* Live pulse badge */}
          <div className={cn(
            "flex items-center gap-1.5 rounded-full border px-2.5 py-1 shrink-0",
            isStale
              ? "border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-900/10"
              : "border-emerald-200 dark:border-emerald-800/40 bg-emerald-50 dark:bg-emerald-900/10",
          )}>
            <span className={cn(
              "w-1.5 h-1.5 rounded-full",
              isStale ? "bg-amber-500" : "bg-emerald-500 animate-pulse",
            )} />
            <span className={cn(
              "text-[10px] font-bold uppercase tracking-wide",
              isStale
                ? "text-amber-700 dark:text-amber-400"
                : "text-emerald-700 dark:text-emerald-400",
            )}>
              {isStale ? "Stale" : "Live"}
            </span>
          </div>
        </div>

        {/* Progress bar + labels */}
        {revPct != null ? (
          <div>
            <div className="h-2.5 rounded-full bg-stone-100 dark:bg-stone-800 overflow-hidden">
              <div
                className={cn("h-full rounded-full transition-all duration-700 ease-out", barColor)}
                style={{ width: `${revPct}%` }}
              />
            </div>
            <div className="flex items-center justify-between mt-2">
              <span className={cn("text-[11px] font-bold tabular-nums", TL_VALUE[revTL])}>
                {revPct.toFixed(0)}% to target
              </span>
              {eod != null && (
                <span className="text-[11px] text-stone-500">
                  At this pace:{" "}
                  <span className="font-bold text-stone-800 dark:text-stone-200">
                    {fmtCurrency(eod, s)} by service end
                  </span>
                </span>
              )}
            </div>
          </div>
        ) : (
          <p className="text-[11px] text-stone-400 italic">
            No revenue target configured — contact head office to set a daily target.
          </p>
        )}
      </div>

      {/* ── Traffic-Light Metric Tiles ───────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricTile
          label="Labour %"
          value={fmtPct(data.labourPct)}
          tl={labourTL}
          sub={
            data.targetLabourPct != null
              ? `Target ${fmtPct(data.targetLabourPct)}`
              : undefined
          }
        />
        <MetricTile
          label="Food Cost %"
          value={fmtPct(data.foodCostPct)}
          tl={foodTL}
          sub={
            data.targetFoodCostPct != null
              ? `Target ${fmtPct(data.targetFoodCostPct)}`
              : undefined
          }
          isEstimated={data.dataQuality.foodCostEstimated}
        />
        <MetricTile
          label="Gross Margin"
          value={fmtPct(data.grossMarginPct)}
          tl={marginTL}
          sub={
            data.targetMarginPct != null
              ? `Target ${fmtPct(data.targetMarginPct)}`
              : undefined
          }
        />
        <MetricTile
          label="Op. Profit Est."
          value={fmtCurrency(data.operatingProfitEstimate, s)}
          tl={profitTL}
          sub="Estimate"
          isEstimated
        />
      </div>
    </div>
  );
}
