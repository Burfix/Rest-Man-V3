/**
 * components/dashboard/profit/ProfitBridgePanel.tsx
 *
 * Waterfall / bridge table showing:
 *   Revenue → Labour → Food Cost → Waste → Overhead → Operating Profit
 */

"use client";

import { cn } from "@/lib/utils";
import type { ProfitBridge, ProfitBridgeLine } from "@/lib/profit/types";

function fmtCurrency(n: number, symbol: string): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${n < 0 ? "-" : ""}${symbol}${(abs / 1_000_000).toFixed(2)}m`;
  if (abs >= 1_000)     return `${n < 0 ? "-" : ""}${symbol}${Math.round(abs / 1_000)}k`;
  return `${n < 0 ? "-" : ""}${symbol}${Math.round(abs).toLocaleString()}`;
}

function BridgeRow({
  line,
  symbol,
  maxAbs,
}: {
  line: ProfitBridgeLine;
  symbol: string;
  maxAbs: number;
}) {
  const barWidth = maxAbs > 0 ? Math.min(100, (Math.abs(line.amount) / maxAbs) * 100) : 0;
  const isRevenue = line.isRevenue;
  const isNegative = line.amount < 0;

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-stone-100 dark:border-stone-800 last:border-0">
      <div className="w-44 shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm text-stone-700 dark:text-stone-300 leading-tight">{line.label}</span>
          {line.isEstimated && (
            <span className="rounded px-1 py-0.5 text-[8px] font-bold uppercase bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
              Est
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 relative h-5 rounded-sm overflow-hidden bg-stone-100 dark:bg-stone-800">
        <div
          className={cn(
            "absolute top-0 h-full rounded-sm transition-all duration-500",
            isRevenue
              ? "bg-emerald-500/70 dark:bg-emerald-600/60 left-0"
              : "bg-red-400/60 dark:bg-red-600/50 left-0",
          )}
          style={{ width: `${barWidth}%` }}
        />
      </div>

      <div className={cn(
        "w-28 text-right tabular-nums font-bold text-sm shrink-0",
        isRevenue ? "text-emerald-700 dark:text-emerald-400" :
        isNegative ? "text-red-600 dark:text-red-400" :
        "text-stone-900 dark:text-stone-100",
      )}>
        {fmtCurrency(line.amount, symbol)}
      </div>
    </div>
  );
}

export function ProfitBridgePanel({
  bridge,
  symbol,
}: {
  bridge: ProfitBridge;
  symbol: string;
}) {
  const maxAbs = Math.max(...bridge.lines.map((l) => Math.abs(l.amount)), 1);
  const profit = bridge.operatingProfitEstimate;
  const isProfit = profit >= 0;

  return (
    <div className="rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 overflow-hidden">
      <div className="px-5 py-4 border-b border-stone-100 dark:border-stone-800">
        <h2 className="text-sm font-bold text-stone-900 dark:text-stone-100">Profit Bridge</h2>
        <p className="text-[11px] text-stone-500 mt-0.5">Revenue minus controllable costs</p>
      </div>

      <div className="px-5 py-2">
        {bridge.lines.map((line, i) => (
          <BridgeRow key={i} line={line} symbol={symbol} maxAbs={maxAbs} />
        ))}
      </div>

      {/* Operating profit result */}
      <div className={cn(
        "mx-5 mb-5 mt-2 rounded-lg px-4 py-3 flex items-center justify-between",
        isProfit
          ? "bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/40"
          : "bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40",
      )}>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-stone-500">
            Operating Profit Estimate
          </p>
          <p className="text-[10px] text-stone-400 mt-0.5">Based on available data</p>
        </div>
        <p className={cn(
          "text-2xl font-extrabold tabular-nums",
          isProfit ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400",
        )}>
          {fmtCurrency(profit, symbol)}
        </p>
      </div>
    </div>
  );
}
