/**
 * components/dashboard/labour/LabourByCategoryChart.tsx
 *
 * Labour cost breakdown by labour category with bar visualisation.
 */
"use client";

import { cn } from "@/lib/utils";
import type { LabourCategorySummary } from "@/types/labour";

interface Props {
  categories: LabourCategorySummary[];
  totalPay: number;
}

function formatCurrency(v: number): string {
  return `R${v.toLocaleString("en-ZA", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

const BAR_COLORS = [
  "bg-blue-500 dark:bg-blue-400",
  "bg-emerald-500 dark:bg-emerald-400",
  "bg-amber-500 dark:bg-amber-400",
  "bg-purple-500 dark:bg-purple-400",
  "bg-rose-500 dark:bg-rose-400",
  "bg-teal-500 dark:bg-teal-400",
];

export default function LabourByCategoryChart({ categories, totalPay }: Props) {
  if (categories.length === 0) {
    return (
      <div className="rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 p-6 text-center">
        <p className="text-sm text-stone-400 dark:text-stone-500">
          No category data available
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 overflow-hidden">
      <div className="px-4 py-3 border-b border-stone-100 dark:border-stone-800">
        <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
          Labour by Category
        </h3>
      </div>
      <div className="p-4 space-y-3">
        {categories.map((cat, i) => {
          const pct = totalPay > 0 ? (cat.pay / totalPay) * 100 : 0;
          return (
            <div key={cat.categoryNum}>
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="font-medium text-stone-700 dark:text-stone-300">
                  {cat.categoryName}
                </span>
                <span className="text-stone-500 dark:text-stone-400 text-xs">
                  {formatCurrency(cat.pay)} · {cat.hours.toFixed(1)}h · {cat.staffCount} staff
                </span>
              </div>
              <div className="h-3 w-full rounded-full bg-stone-100 dark:bg-stone-800 overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    BAR_COLORS[i % BAR_COLORS.length],
                  )}
                  style={{ width: `${Math.max(pct, 1)}%` }}
                />
              </div>
              <p className="text-[10px] text-stone-400 dark:text-stone-500 mt-0.5">
                {pct.toFixed(1)}% of total
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
