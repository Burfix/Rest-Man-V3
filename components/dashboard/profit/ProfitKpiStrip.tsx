/**
 * components/dashboard/profit/ProfitKpiStrip.tsx
 *
 * The top KPI row: Net Revenue, Gross Margin %, Labour %, Food Cost %,
 * Operating Profit Estimate, Profit at Risk.
 */

"use client";

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

// ── KPI tile ──────────────────────────────────────────────────────────────────

type TileSignal = "positive" | "negative" | "warning" | "neutral";

function KpiTile({
  label,
  value,
  sub,
  signal = "neutral",
  badge,
  isEstimated,
}: {
  label: string;
  value: string;
  sub?: string;
  signal?: TileSignal;
  badge?: string;
  isEstimated?: boolean;
}) {
  const valueColor =
    signal === "positive" ? "text-emerald-600 dark:text-emerald-400" :
    signal === "negative" ? "text-red-600 dark:text-red-400"         :
    signal === "warning"  ? "text-amber-600 dark:text-amber-400"     :
    "text-stone-900 dark:text-stone-100";

  return (
    <div className="relative rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 px-4 py-4 flex flex-col gap-1 min-w-0">
      <div className="flex items-center gap-1.5">
        <p className="text-[10px] font-bold uppercase tracking-widest text-stone-500 truncate">{label}</p>
        {isEstimated && (
          <span className="shrink-0 rounded px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
            Est
          </span>
        )}
      </div>
      <p className={cn("text-2xl font-extrabold tabular-nums leading-none", valueColor)}>
        {value}
      </p>
      {sub && <p className="text-[11px] text-stone-500 dark:text-stone-500">{sub}</p>}
      {badge && (
        <span className="mt-1 self-start rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
          {badge}
        </span>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ProfitKpiStrip({ data }: { data: ProfitIntelligenceResult }) {
  const s = data.currencySymbol;

  const labourSignal: TileSignal =
    data.labourPct != null && data.targetLabourPct != null
      ? data.labourPct > data.targetLabourPct + 5 ? "negative"
      : data.labourPct > data.targetLabourPct + 2 ? "warning"
      : "positive"
      : "neutral";

  const foodSignal: TileSignal =
    data.foodCostPct != null && data.targetFoodCostPct != null
      ? data.foodCostPct > data.targetFoodCostPct + 5 ? "negative"
      : data.foodCostPct > data.targetFoodCostPct + 2 ? "warning"
      : "positive"
      : "neutral";

  const marginSignal: TileSignal =
    data.grossMarginPct != null && data.targetMarginPct != null
      ? data.grossMarginPct >= data.targetMarginPct ? "positive" : "warning"
      : "neutral";

  const profitSignal: TileSignal =
    data.operatingProfitEstimate != null
      ? data.operatingProfitEstimate > 0 ? "positive" : "negative"
      : "neutral";

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      <KpiTile
        label="Net Revenue"
        value={fmtCurrency(data.revenue, s)}
        sub={data.targetRevenue ? `Target ${fmtCurrency(data.targetRevenue, s)}` : undefined}
        signal={
          data.revenue != null && data.targetRevenue != null
            ? data.revenue >= data.targetRevenue ? "positive" : "warning"
            : "neutral"
        }
      />

      <KpiTile
        label="Gross Margin %"
        value={fmtPct(data.grossMarginPct)}
        sub={data.targetMarginPct ? `Target ${fmtPct(data.targetMarginPct)}` : undefined}
        signal={marginSignal}
      />

      <KpiTile
        label="Labour %"
        value={fmtPct(data.labourPct)}
        sub={data.targetLabourPct ? `Target ${fmtPct(data.targetLabourPct)}` : undefined}
        signal={labourSignal}
      />

      <KpiTile
        label="Food Cost %"
        value={fmtPct(data.foodCostPct)}
        sub={data.targetFoodCostPct ? `Target ${fmtPct(data.targetFoodCostPct)}` : undefined}
        signal={foodSignal}
        isEstimated={!!(data.dataQuality.foodCostEstimated)}
      />

      <KpiTile
        label="Operating Profit"
        value={fmtCurrency(data.operatingProfitEstimate, s)}
        sub="Estimate"
        signal={profitSignal}
        isEstimated
      />

      <KpiTile
        label="Profit at Risk"
        value={data.profitAtRisk ? fmtCurrency(data.profitAtRisk, s) : "—"}
        sub={data.profitAtRisk ? "if no action" : "No risk detected"}
        signal={data.profitAtRisk ? "negative" : "positive"}
        badge={data.profitAtRisk && data.profitAtRisk > 5000 ? "Act Now" : undefined}
      />
    </div>
  );
}
