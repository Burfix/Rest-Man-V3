"use client";

import { useEffect, useState } from "react";

interface StockRisk {
  id: string;
  name: string;
  category: string | null;
  current_stock: number;
  avg_daily_usage: number;
  days_remaining: number;
  risk_level: "critical" | "warning" | "healthy";
}

interface FoodCostData {
  current_pct: number | null;
  target_pct: number | null;
  variance_pct: number | null;
  stockRisks: StockRisk[];
}

const RISK_BADGE: Record<string, string> = {
  critical: "bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400 ring-red-200 dark:ring-red-800",
  warning:  "bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 ring-amber-200 dark:ring-amber-800",
  healthy:  "bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-400 ring-green-200 dark:ring-green-800",
};

export default function FoodCostRiskCard() {
  const [data, setData] = useState<FoodCostData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/inventory")
      .then(r => r.json())
      .then(json => {
        const items = (json.items ?? []) as Array<{
          id: string;
          name: string;
          category: string | null;
          current_stock: number;
          avg_daily_usage: number;
          minimum_threshold: number;
        }>;
        const fc = json.foodCost as { current_pct: number | null; target_pct: number | null; variance_pct: number | null } | null;

        const risks: StockRisk[] = items
          .filter(i => i.avg_daily_usage > 0)
          .map(i => {
            const dr = i.current_stock / i.avg_daily_usage;
            return {
              id: i.id,
              name: i.name,
              category: i.category,
              current_stock: i.current_stock,
              avg_daily_usage: i.avg_daily_usage,
              days_remaining: dr,
              risk_level: dr <= 2 ? "critical" as const : dr <= 3 ? "warning" as const : "healthy" as const,
            };
          })
          .filter(r => r.risk_level !== "healthy")
          .sort((a, b) => a.days_remaining - b.days_remaining);

        setData({
          current_pct: fc?.current_pct ?? null,
          target_pct: fc?.target_pct ?? null,
          variance_pct: fc?.variance_pct ?? null,
          stockRisks: risks,
        });
      })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-5 animate-pulse">
        <div className="h-4 w-40 bg-stone-200 dark:bg-stone-800 rounded" />
        <div className="mt-4 h-20 bg-stone-100 dark:bg-stone-800/50 rounded" />
      </div>
    );
  }

  if (!data) return null;

  const hasFC = data.current_pct !== null;
  const overTarget = (data.variance_pct ?? 0) > 0;

  return (
    <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold text-stone-900 dark:text-stone-100 flex items-center gap-2">
          <span className="text-base">🍽️</span> Food Cost & Stock Risk
        </h3>
        {hasFC && (
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ring-1 ring-inset ${
            overTarget
              ? "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950 dark:text-red-400 dark:ring-red-800"
              : "bg-green-50 text-green-700 ring-green-200 dark:bg-green-950 dark:text-green-400 dark:ring-green-800"
          }`}>
            {overTarget ? "Above Target" : "On Target"}
          </span>
        )}
      </div>

      {/* Food cost KPI */}
      {hasFC && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="text-center">
            <p className="text-2xl font-bold text-stone-900 dark:text-stone-100">
              {data.current_pct?.toFixed(1)}%
            </p>
            <p className="text-[10px] font-medium text-stone-500 dark:text-stone-400 uppercase tracking-wide">Actual</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-stone-400 dark:text-stone-500">
              {data.target_pct?.toFixed(1)}%
            </p>
            <p className="text-[10px] font-medium text-stone-500 dark:text-stone-400 uppercase tracking-wide">Target</p>
          </div>
          <div className="text-center">
            <p className={`text-2xl font-bold ${overTarget ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>
              {overTarget ? "+" : ""}{data.variance_pct?.toFixed(1)}%
            </p>
            <p className="text-[10px] font-medium text-stone-500 dark:text-stone-400 uppercase tracking-wide">Variance</p>
          </div>
        </div>
      )}

      {!hasFC && (
        <p className="text-xs text-stone-400 dark:text-stone-500 mb-4">
          No food cost data available yet. Upload purchase data to begin tracking.
        </p>
      )}

      {/* Stock risks */}
      {data.stockRisks.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-stone-600 dark:text-stone-400 uppercase tracking-wide">
            Stock Alerts ({data.stockRisks.length})
          </p>
          {data.stockRisks.slice(0, 5).map(r => (
            <div
              key={r.id}
              className="flex items-center justify-between rounded-lg border border-stone-100 dark:border-stone-800 px-3 py-2"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className={`shrink-0 inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${RISK_BADGE[r.risk_level]}`}>
                  {r.risk_level === "critical" ? "⚠️" : "⏳"} {r.days_remaining.toFixed(1)}d
                </span>
                <span className="text-sm font-medium text-stone-800 dark:text-stone-200 truncate">{r.name}</span>
              </div>
              <span className="text-xs text-stone-400 dark:text-stone-500 shrink-0 ml-2">
                {r.current_stock} units left
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-100 dark:border-green-900 px-3 py-2">
          <span>✅</span>
          <span className="text-xs font-medium text-green-700 dark:text-green-400">
            All stock levels healthy
          </span>
        </div>
      )}
    </div>
  );
}
