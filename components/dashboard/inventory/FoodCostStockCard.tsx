"use client";

import { cn } from "@/lib/utils";
import type { FoodCostSummary } from "@/types/inventory";

const STATUS_STYLE = {
  on_target:    { label: "On Target",    badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400" },
  above_target: { label: "Above Target", badge: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400" },
  high:         { label: "High Risk",    badge: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400" },
  no_data:      { label: "No Data",      badge: "bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-500" },
};

const RISK_STYLE = {
  critical: "text-red-600 dark:text-red-400",
  warning:  "text-amber-600 dark:text-amber-400",
  healthy:  "text-emerald-600 dark:text-emerald-400",
};

interface Props {
  summary: FoodCostSummary | null;
}

export default function FoodCostStockCard({ summary }: Props) {
  if (!summary) {
    return (
      <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-5">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-sm">🥩</span>
          <h3 className="text-xs font-bold uppercase tracking-widest text-stone-500 dark:text-stone-600">
            Food Cost & Stock Risk
          </h3>
        </div>
        <p className="text-sm text-stone-500">No inventory data yet</p>
      </div>
    );
  }

  const statusStyle = STATUS_STYLE[summary.status];
  const { stock_risk } = summary;

  return (
    <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-stone-100 dark:border-stone-800">
        <div className="flex items-center gap-2">
          <span className="text-sm">🥩</span>
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-stone-500 dark:text-stone-600">
            Food Cost & Stock Risk
          </h3>
        </div>
        <span className={cn("rounded-full px-2 py-px text-[10px] font-bold", statusStyle.badge)}>
          {statusStyle.label}
        </span>
      </div>

      <div className="px-5 py-4 space-y-4">
        {/* KPIs */}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-stone-500 dark:text-stone-600">Food Cost</p>
            <p className="text-lg font-bold tabular-nums text-stone-900 dark:text-stone-100">
              {summary.current_pct !== null ? `${summary.current_pct.toFixed(1)}%` : "—"}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-stone-500 dark:text-stone-600">Target</p>
            <p className="text-lg font-bold tabular-nums text-stone-900 dark:text-stone-100">
              {summary.target_pct !== null ? `${summary.target_pct.toFixed(1)}%` : "—"}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-stone-500 dark:text-stone-600">Variance</p>
            <p className={cn(
              "text-lg font-bold tabular-nums",
              summary.variance_pct !== null && summary.variance_pct > 0
                ? "text-red-600 dark:text-red-400"
                : "text-emerald-600 dark:text-emerald-400"
            )}>
              {summary.variance_pct !== null ? `${summary.variance_pct > 0 ? "+" : ""}${summary.variance_pct.toFixed(1)}%` : "—"}
            </p>
          </div>
        </div>

        {/* Stock risk strip */}
        <div className="flex items-center gap-3 rounded-lg bg-stone-50 dark:bg-stone-800/50 px-3 py-2">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-red-500" />
            <span className={cn("text-xs font-semibold tabular-nums", RISK_STYLE.critical)}>
              {stock_risk.critical}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            <span className={cn("text-xs font-semibold tabular-nums", RISK_STYLE.warning)}>
              {stock_risk.warning}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            <span className={cn("text-xs font-semibold tabular-nums", RISK_STYLE.healthy)}>
              {stock_risk.healthy}
            </span>
          </div>
          <span className="ml-auto text-[10px] text-stone-500 dark:text-stone-600">
            {stock_risk.total_items} items tracked
          </span>
        </div>

        {/* Top risks */}
        {stock_risk.top_risks.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] uppercase tracking-wide font-semibold text-stone-500 dark:text-stone-600">
              Stock Alerts
            </p>
            {stock_risk.top_risks.slice(0, 3).map((item) => (
              <div key={item.id} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    item.risk_level === "critical" ? "bg-red-500" : "bg-amber-500"
                  )} />
                  <span className="font-medium text-stone-700 dark:text-stone-300">{item.name}</span>
                </div>
                <span className={cn(
                  "text-[10px] font-semibold",
                  RISK_STYLE[item.risk_level]
                )}>
                  {item.days_remaining !== null ? `${item.days_remaining}d left` : "Low stock"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
