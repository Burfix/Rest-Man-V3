/**
 * components/dashboard/profit/ProfitLeaksPanel.tsx
 *
 * Shows all detected profit leaks ranked by severity.
 * Each leak card includes title, severity, financial impact, explanation,
 * and recommended action.
 */

"use client";

import { cn } from "@/lib/utils";
import type { ProfitLeak, LeakSeverity } from "@/lib/profit/types";

const SEVERITY_STYLES: Record<LeakSeverity, { dot: string; badge: string; border: string }> = {
  critical: {
    dot:    "bg-red-500",
    badge:  "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    border: "border-red-200 dark:border-red-800/40",
  },
  high: {
    dot:    "bg-orange-500",
    badge:  "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
    border: "border-orange-200 dark:border-orange-800/40",
  },
  medium: {
    dot:    "bg-amber-500",
    badge:  "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    border: "border-stone-200 dark:border-stone-700",
  },
  low: {
    dot:    "bg-stone-400",
    badge:  "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400",
    border: "border-stone-200 dark:border-stone-700",
  },
};

function fmtCurrency(n: number, symbol = "R"): string {
  if (Math.abs(n) >= 1_000) return `${symbol}${Math.round(n / 1_000)}k`;
  return `${symbol}${Math.round(n).toLocaleString()}`;
}

function LeakCard({ leak, symbol }: { leak: ProfitLeak; symbol: string }) {
  const style = SEVERITY_STYLES[leak.severity];
  return (
    <div className={cn(
      "rounded-xl border bg-white dark:bg-stone-900 p-4 flex flex-col gap-2",
      style.border,
    )}>
      <div className="flex items-start gap-2">
        <span className={cn("mt-1 w-2 h-2 rounded-full shrink-0", style.dot)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-stone-900 dark:text-stone-100 leading-snug">
              {leak.title}
            </span>
            <span className={cn("rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide", style.badge)}>
              {leak.severity}
            </span>
          </div>
          {leak.financialImpact != null && (
            <p className="text-[11px] font-bold text-red-600 dark:text-red-400 mt-0.5">
              ~{fmtCurrency(leak.financialImpact, symbol)} impact
            </p>
          )}
        </div>
      </div>

      <p className="text-[12px] text-stone-600 dark:text-stone-400 leading-relaxed pl-4">
        {leak.explanation}
      </p>

      <div className="pl-4 pt-1 border-t border-stone-100 dark:border-stone-800">
        <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-1">
          Recommended Action
        </p>
        <p className="text-[12px] text-stone-700 dark:text-stone-300 leading-relaxed">
          {leak.recommendedAction}
        </p>
      </div>
    </div>
  );
}

export function ProfitLeaksPanel({
  leaks,
  symbol,
}: {
  leaks: ProfitLeak[];
  symbol: string;
}) {
  const actionableLeaks = leaks.filter((l) => l.category !== "data");
  const dataLeaks       = leaks.filter((l) => l.category === "data");

  return (
    <div className="rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 overflow-hidden">
      <div className="px-5 py-4 border-b border-stone-100 dark:border-stone-800">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-stone-900 dark:text-stone-100">Profit Leaks</h2>
          {actionableLeaks.length > 0 && (
            <span className="rounded-full px-2 py-0.5 text-[10px] font-bold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
              {actionableLeaks.length} detected
            </span>
          )}
        </div>
        <p className="text-[11px] text-stone-500 mt-0.5">
          Operational factors reducing margin right now
        </p>
      </div>

      <div className="p-4 flex flex-col gap-3">
        {actionableLeaks.length === 0 && dataLeaks.length === 0 && (
          <div className="text-center py-8">
            <p className="text-2xl mb-2">✓</p>
            <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
              No profit leaks detected
            </p>
            <p className="text-[11px] text-stone-500 mt-1">
              Margin protected through labour and cost control
            </p>
          </div>
        )}

        {actionableLeaks.map((leak) => (
          <LeakCard key={leak.id} leak={leak} symbol={symbol} />
        ))}

        {dataLeaks.length > 0 && (
          <div className="mt-1 border-t border-stone-100 dark:border-stone-800 pt-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-2">
              Data Gaps
            </p>
            {dataLeaks.map((leak) => (
              <div
                key={leak.id}
                className="rounded-lg bg-stone-50 dark:bg-stone-800/50 border border-stone-200 dark:border-stone-700 px-3 py-2 mb-2"
              >
                <p className="text-[12px] text-stone-600 dark:text-stone-400">{leak.explanation}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
