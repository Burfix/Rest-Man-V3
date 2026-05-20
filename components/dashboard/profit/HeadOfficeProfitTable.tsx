/**
 * components/dashboard/profit/HeadOfficeProfitTable.tsx
 *
 * Multi-store profit intelligence table for head office, executive,
 * and area manager roles.
 *
 * Shows each store ranked by operating profit estimate, with
 * signal indicators for labour drag, food cost risk, revenue shortfall,
 * and margin improvement.
 */

"use client";

import { cn } from "@/lib/utils";
import type { GroupProfitIntelligenceResult, StoreProfitSummary, ConfidenceLevel } from "@/lib/profit/types";

function fmtCurrency(n: number | null, symbol = "R"): string {
  if (n == null) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${symbol}${(n / 1_000_000).toFixed(2)}m`;
  if (abs >= 1_000)     return `${symbol}${Math.round(n / 1_000)}k`;
  return `${symbol}${Math.round(n).toLocaleString()}`;
}

function fmtPct(n: number | null): string {
  return n == null ? "—" : `${n.toFixed(1)}%`;
}

const SIGNAL_CONFIG: Record<string, { label: string; color: string }> = {
  margin_improved:  { label: "Margin OK",       color: "text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20" },
  on_target:        { label: "On Target",        color: "text-stone-600 dark:text-stone-400 bg-stone-100 dark:bg-stone-800" },
  labour_drag:      { label: "Labour Drag",      color: "text-orange-700 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20" },
  food_cost_risk:   { label: "Food Cost Risk",   color: "text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20" },
  revenue_shortfall:{ label: "Rev. Shortfall",   color: "text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20" },
  data_unavailable: { label: "No Data",          color: "text-stone-400 dark:text-stone-500 bg-stone-50 dark:bg-stone-900" },
};

const CONFIDENCE_DOT: Record<ConfidenceLevel, string> = {
  high:   "bg-emerald-500",
  medium: "bg-amber-500",
  low:    "bg-red-500",
};

function StoreRow({ store }: { store: StoreProfitSummary }) {
  const signal = SIGNAL_CONFIG[store.signal] ?? SIGNAL_CONFIG.on_target;

  return (
    <tr className="border-b border-stone-100 dark:border-stone-800 hover:bg-stone-50 dark:hover:bg-stone-800/40 transition-colors">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", CONFIDENCE_DOT[store.confidenceLevel])} />
          <span className="text-sm font-semibold text-stone-900 dark:text-stone-100">
            {store.siteName}
          </span>
        </div>
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-sm text-stone-700 dark:text-stone-300">
        {fmtCurrency(store.revenue)}
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-sm">
        <span className={cn(
          store.grossMarginPct == null ? "text-stone-400" :
          store.grossMarginPct >= 12 ? "text-emerald-700 dark:text-emerald-400" :
          store.grossMarginPct >= 8  ? "text-amber-700 dark:text-amber-400" :
          "text-red-700 dark:text-red-400",
        )}>
          {fmtPct(store.grossMarginPct)}
        </span>
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-sm">
        <span className={cn(
          store.labourPct == null ? "text-stone-400" :
          store.labourPct > 35 ? "text-red-700 dark:text-red-400" :
          store.labourPct > 32 ? "text-amber-700 dark:text-amber-400" :
          "text-stone-700 dark:text-stone-300",
        )}>
          {fmtPct(store.labourPct)}
        </span>
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-sm">
        <span className={cn(
          store.foodCostPct == null ? "text-stone-400" :
          store.foodCostPct > 37 ? "text-red-700 dark:text-red-400" :
          store.foodCostPct > 34 ? "text-amber-700 dark:text-amber-400" :
          "text-stone-700 dark:text-stone-300",
        )}>
          {fmtPct(store.foodCostPct)}
        </span>
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-sm">
        <span className={cn(
          store.operatingProfitEstimate == null ? "text-stone-400" :
          store.operatingProfitEstimate > 0 ? "text-emerald-700 dark:text-emerald-400 font-semibold" :
          "text-red-700 dark:text-red-400 font-semibold",
        )}>
          {fmtCurrency(store.operatingProfitEstimate)}
        </span>
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-sm text-red-700 dark:text-red-400 font-semibold">
        {store.profitAtRisk ? fmtCurrency(store.profitAtRisk) : "—"}
      </td>
      <td className="px-4 py-3">
        <span className={cn(
          "rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide",
          signal.color,
        )}>
          {signal.label}
        </span>
      </td>
    </tr>
  );
}

function SummaryTile({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 px-4 py-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-stone-500">{label}</p>
      <p className={cn("text-xl font-extrabold tabular-nums mt-0.5", color ?? "text-stone-900 dark:text-stone-100")}>
        {value}
      </p>
      {sub && <p className="text-[11px] text-stone-500">{sub}</p>}
    </div>
  );
}

export function HeadOfficeProfitTable({
  data,
  symbol = "R",
}: {
  data: GroupProfitIntelligenceResult;
  symbol?: string;
}) {
  return (
    <div className="flex flex-col gap-5">
      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryTile
          label="Total Revenue"
          value={fmtCurrency(data.totalRevenue, symbol)}
          color="text-stone-900 dark:text-stone-100"
        />
        <SummaryTile
          label="Total Op. Profit Est."
          value={fmtCurrency(data.totalOperatingProfit, symbol)}
          color={data.totalOperatingProfit > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}
          sub="Estimate"
        />
        <SummaryTile
          label="Stores with Labour Drag"
          value={String(data.storesWithLabourDrag)}
          color={data.storesWithLabourDrag > 0 ? "text-orange-700 dark:text-orange-400" : "text-emerald-700 dark:text-emerald-400"}
          sub={`of ${data.stores.length} stores`}
        />
        <SummaryTile
          label="Stores at Profit Risk"
          value={String(data.storesAtRisk)}
          color={data.storesAtRisk > 0 ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}
          sub={`of ${data.stores.length} stores`}
        />
      </div>

      {/* Store table */}
      <div className="rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 overflow-hidden">
        <div className="px-5 py-4 border-b border-stone-100 dark:border-stone-800">
          <h2 className="text-sm font-bold text-stone-900 dark:text-stone-100">
            Store Profit Intelligence
          </h2>
          <p className="text-[11px] text-stone-500 mt-0.5">
            Ranked by operating profit estimate — confidence dots indicate data quality
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px]">
            <thead>
              <tr className="border-b border-stone-100 dark:border-stone-800">
                {["Store", "Revenue", "Margin %", "Labour %", "Food Cost %", "Op. Profit", "At Risk", "Signal"].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-stone-500 text-right first:text-left last:text-left"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.stores.map((store) => (
                <StoreRow key={store.siteId} store={store} />
              ))}
            </tbody>
          </table>
        </div>

        {data.stores.length === 0 && (
          <div className="text-center py-10 text-stone-500 text-sm">
            No store data available for this period.
          </div>
        )}
      </div>
    </div>
  );
}
