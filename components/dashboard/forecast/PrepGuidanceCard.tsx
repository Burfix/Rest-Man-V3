/**
 * PrepGuidanceCard — Kitchen prep recommendations
 */

"use client";

import { cn } from "@/lib/utils";
import type { PrepGuidanceItem } from "@/types/forecast";

const RISK_STYLE = {
  high:   { bg: "bg-red-50 dark:bg-red-950/30",    text: "text-red-700 dark:text-red-400",    dot: "bg-red-500" },
  medium: { bg: "bg-amber-50 dark:bg-amber-950/30", text: "text-amber-700 dark:text-amber-400", dot: "bg-amber-500" },
  low:    { bg: "bg-stone-50 dark:bg-stone-800/50", text: "text-stone-600 dark:text-stone-400", dot: "bg-stone-400" },
};

export default function PrepGuidanceCard({ items }: { items: PrepGuidanceItem[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-5">
        <Header />
        <p className="text-xs text-stone-500 dark:text-stone-400 mt-3">
          No prep guidance generated — forecast covers are low.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-5">
      <Header />
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-stone-100 dark:border-stone-800">
              <th className="pb-2 text-[10px] uppercase tracking-wider font-semibold text-stone-500 dark:text-stone-500">Item</th>
              <th className="pb-2 text-[10px] uppercase tracking-wider font-semibold text-stone-500 dark:text-stone-500">Category</th>
              <th className="pb-2 text-[10px] uppercase tracking-wider font-semibold text-stone-500 dark:text-stone-500 text-right">Qty</th>
              <th className="pb-2 text-[10px] uppercase tracking-wider font-semibold text-stone-500 dark:text-stone-500 text-center">Urgency</th>
              <th className="pb-2 text-[10px] uppercase tracking-wider font-semibold text-stone-500 dark:text-stone-500 hidden sm:table-cell">Note</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => {
              const style = RISK_STYLE[item.riskLevel];
              return (
                <tr key={i} className="border-b border-stone-50 dark:border-stone-800/50 last:border-0">
                  <td className="py-2.5 text-xs font-medium text-stone-800 dark:text-stone-200">
                    {item.itemName}
                  </td>
                  <td className="py-2.5 text-[11px] text-stone-500 dark:text-stone-400">
                    {item.itemCategory}
                  </td>
                  <td className="py-2.5 text-xs font-semibold text-stone-800 dark:text-stone-200 text-right">
                    {item.estimatedQuantity} <span className="text-stone-500 dark:text-stone-400 font-normal">{item.unit}</span>
                  </td>
                  <td className="py-2.5 text-center">
                    <span className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider",
                      style.bg, style.text,
                    )}>
                      <span className={cn("h-1 w-1 rounded-full", style.dot)} />
                      {item.riskLevel}
                    </span>
                  </td>
                  <td className="py-2.5 text-[11px] text-stone-500 dark:text-stone-400 hidden sm:table-cell max-w-[200px] truncate">
                    {item.note}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Header() {
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-amber-50 dark:bg-amber-950/50">
        <span className="text-sm">🔪</span>
      </div>
      <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
        Prep Guidance
      </h3>
    </div>
  );
}
