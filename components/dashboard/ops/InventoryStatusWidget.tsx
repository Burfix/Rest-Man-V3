/**
 * InventoryStatusWidget — Inventory risk summary card
 *
 * Compact overview: critical (red) · low (orange) · healthy (green)
 * counts with top risk items, menu impact, and last synced time.
 *
 * Injected into the main dashboard — NOT a separate page.
 */

import { cn } from "@/lib/utils";
import type { InventoryIntelligence } from "@/services/inventory/intelligence";

interface Props {
  inventory: InventoryIntelligence | null;
}

const RISK_BADGE = {
  critical: "bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400",
  warning:  "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400",
  healthy:  "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400",
} as const;

export default function InventoryStatusWidget({ inventory }: Props) {
  if (!inventory || inventory.totalItems === 0) return null;

  const critCount = inventory.criticalItems.length;
  const lowCount  = inventory.lowItems.length;
  const healthy   = inventory.healthyCount;
  const total     = inventory.totalItems;
  const noPO      = inventory.noPOItems.length;

  // Risk score → colour
  const scoreColor =
    inventory.riskScore <= 3  ? "text-red-600 dark:text-red-400"     :
    inventory.riskScore <= 6  ? "text-amber-600 dark:text-amber-400" :
    "text-emerald-600 dark:text-emerald-400";

  const topRisks = [...inventory.criticalItems, ...inventory.lowItems].slice(0, 4);
  const menuImpacts = inventory.menuImpact.filter((m) => m.riskLevel !== "healthy").slice(0, 3);

  // Freshness label
  let syncLabel = "No sync data";
  if (inventory.lastSynced) {
    const mins = Math.floor((Date.now() - new Date(inventory.lastSynced).getTime()) / 60_000);
    syncLabel = mins < 1 ? "Synced just now" : mins < 60 ? `Synced ${mins}m ago` : `Synced ${Math.floor(mins / 60)}h ago`;
  }

  return (
    <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-stone-100 dark:border-stone-800">
        <div className="flex items-center gap-2">
          <span className="text-sm">📦</span>
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-stone-400 dark:text-stone-600">
            Inventory Status
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-stone-400 dark:text-stone-600">{syncLabel}</span>
          <span className={cn("text-sm font-bold tabular-nums", scoreColor)}>
            {inventory.riskScore}/10
          </span>
        </div>
      </div>

      {/* Summary counters */}
      <div className="grid grid-cols-3 divide-x divide-stone-100 dark:divide-stone-800 border-b border-stone-100 dark:border-stone-800">
        <div className="flex flex-col items-center py-3">
          <span className="text-lg font-bold tabular-nums text-red-600 dark:text-red-400">{critCount}</span>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-stone-400 dark:text-stone-600">Stockout</span>
        </div>
        <div className="flex flex-col items-center py-3">
          <span className="text-lg font-bold tabular-nums text-amber-600 dark:text-amber-400">{lowCount}</span>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-stone-400 dark:text-stone-600">Low Stock</span>
        </div>
        <div className="flex flex-col items-center py-3">
          <span className="text-lg font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{healthy}</span>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-stone-400 dark:text-stone-600">Healthy</span>
        </div>
      </div>

      {/* Top risk items */}
      {topRisks.length > 0 && (
        <div className="px-5 py-3 border-b border-stone-100 dark:border-stone-800">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-stone-400 dark:text-stone-600 mb-2">
            Top Risk Items
          </p>
          <div className="space-y-1.5">
            {topRisks.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={cn(
                    "shrink-0 rounded-full px-1.5 py-px text-[9px] font-bold uppercase",
                    RISK_BADGE[item.risk_level]
                  )}>
                    {item.risk_level === "critical" ? "OUT" : "LOW"}
                  </span>
                  <span className="text-[11px] text-stone-700 dark:text-stone-300 font-medium truncate">
                    {item.name}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] tabular-nums text-stone-500 dark:text-stone-500">
                    {item.current_stock} {item.unit}
                  </span>
                  {item.days_remaining != null && (
                    <span className={cn(
                      "text-[10px] tabular-nums font-medium",
                      item.days_remaining <= 1 ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"
                    )}>
                      {item.days_remaining}d left
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Menu impact */}
      {menuImpacts.length > 0 && (
        <div className="px-5 py-3 border-b border-stone-100 dark:border-stone-800">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-stone-400 dark:text-stone-600 mb-2">
            Menu Impact
          </p>
          <div className="space-y-1.5">
            {menuImpacts.map((m) => (
              <div key={m.ingredientId} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="text-[11px] text-stone-700 dark:text-stone-300 font-medium">
                    {m.ingredientName}
                  </span>
                  {m.affectedDishes.length > 0 && (
                    <span className="text-[10px] text-stone-400 dark:text-stone-600 ml-1">
                      → {m.affectedDishes.slice(0, 2).join(", ")}
                    </span>
                  )}
                </div>
                <span className="shrink-0 text-[10px] font-medium text-red-600 dark:text-red-400 tabular-nums">
                  R{m.estimatedRevenueLoss.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer — totals + no-PO warning */}
      <div className="px-5 py-3 flex items-center justify-between">
        <span className="text-[10px] text-stone-400 dark:text-stone-600">
          {total} item{total !== 1 ? "s" : ""} tracked
        </span>
        <div className="flex items-center gap-3">
          {noPO > 0 && (
            <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
              {noPO} without PO
            </span>
          )}
          {inventory.estimatedLostRevenue > 0 && (
            <span className="text-[10px] font-bold text-red-600 dark:text-red-400 tabular-nums">
              R{inventory.estimatedLostRevenue.toLocaleString()} at risk
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
