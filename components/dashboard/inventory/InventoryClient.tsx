"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import type { InventoryItemWithRisk, FoodCostSummary, PurchaseOrder } from "@/types/inventory";

type FilterLevel = "all" | "critical" | "warning" | "healthy";

const RISK_BADGE = {
  critical: { label: "Critical", cls: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400" },
  warning:  { label: "Warning",  cls: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400" },
  healthy:  { label: "Healthy",  cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400" },
};

export default function InventoryClient() {
  const [items, setItems] = useState<InventoryItemWithRisk[]>([]);
  const [foodCost, setFoodCost] = useState<FoodCostSummary | null>(null);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterLevel>("all");
  const [tab, setTab] = useState<"inventory" | "orders">("inventory");

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [invRes, ordRes] = await Promise.all([
        fetch("/api/inventory"),
        fetch("/api/inventory/orders"),
      ]);
      if (invRes.ok) {
        const data = await invRes.json();
        setItems(data.items ?? []);
        setFoodCost(data.foodCost ?? null);
      }
      if (ordRes.ok) {
        setOrders(await ordRes.json());
      }
    } catch (err) {
      console.error("Failed to fetch inventory:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = filter === "all" ? items : items.filter((i) => i.risk_level === filter);
  const criticalCount = items.filter((i) => i.risk_level === "critical").length;
  const warningCount  = items.filter((i) => i.risk_level === "warning").length;
  const orderCount    = items.filter((i) => i.needs_order_today).length;

  async function handleMarkOrdered(poId: string) {
    const res = await fetch(`/api/inventory/orders/${poId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "ordered" }),
    });
    if (res.ok) fetchData();
  }

  async function handleMarkReceived(poId: string) {
    const res = await fetch(`/api/inventory/orders/${poId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "received" }),
    });
    if (res.ok) fetchData();
  }

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 w-64 rounded bg-stone-200 dark:bg-stone-800" />
        <div className="grid grid-cols-4 gap-3">
          {[1,2,3,4].map(i => <div key={i} className="h-20 rounded-xl bg-stone-100 dark:bg-stone-800/50" />)}
        </div>
        <div className="h-96 rounded-xl bg-stone-100 dark:bg-stone-800/50" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-gradient-to-br from-orange-500 to-red-600 shadow-sm">
            <span className="text-lg text-white">🥩</span>
          </div>
          <div>
            <h1 className="text-lg font-bold text-stone-900 dark:text-stone-100">Inventory & Food Cost</h1>
            <p className="text-xs text-stone-500 dark:text-stone-400">Stock levels, food cost tracking & ordering</p>
          </div>
        </div>
        <button onClick={fetchData} className="flex items-center gap-1.5 rounded-lg border border-stone-200 dark:border-stone-700 px-3 py-1.5 text-xs font-medium text-stone-600 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-800 transition-colors">
          ↻ Refresh
        </button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiTile label="Food Cost %" value={foodCost?.current_pct !== null ? `${foodCost?.current_pct?.toFixed(1)}%` : "—"} subtext={foodCost?.target_pct ? `Target: ${foodCost.target_pct.toFixed(1)}%` : ""} />
        <KpiTile label="Critical Items" value={String(criticalCount)} color={criticalCount > 0 ? "text-red-600 dark:text-red-400" : undefined} />
        <KpiTile label="Warning Items" value={String(warningCount)} color={warningCount > 0 ? "text-amber-600 dark:text-amber-400" : undefined} />
        <KpiTile label="Need Ordering" value={String(orderCount)} color={orderCount > 0 ? "text-orange-600 dark:text-orange-400" : undefined} />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-stone-200 dark:border-stone-800">
        {(["inventory", "orders"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cn(
            "px-4 py-2 text-xs font-semibold uppercase tracking-wide border-b-2 transition-colors",
            tab === t ? "border-stone-900 dark:border-stone-100 text-stone-900 dark:text-stone-100" : "border-transparent text-stone-400 dark:text-stone-600 hover:text-stone-600 dark:hover:text-stone-400"
          )}>
            {t === "inventory" ? "Stock Items" : `Orders (${orders.length})`}
          </button>
        ))}
      </div>

      {tab === "inventory" ? (
        <>
          {/* Filters */}
          <div className="flex gap-2">
            {(["all", "critical", "warning", "healthy"] as FilterLevel[]).map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                filter === f ? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900" : "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-700"
              )}>
                {f === "all" ? `All (${items.length})` : `${f.charAt(0).toUpperCase() + f.slice(1)} (${items.filter(i => i.risk_level === f).length})`}
              </button>
            ))}
          </div>

          {/* Table */}
          <div className="rounded-xl border border-stone-200 dark:border-stone-800 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-stone-50 dark:bg-stone-800/50 text-stone-500 dark:text-stone-500">
                    <th className="text-left px-4 py-2.5 font-semibold">Item</th>
                    <th className="text-left px-4 py-2.5 font-semibold">Category</th>
                    <th className="text-right px-4 py-2.5 font-semibold">Stock</th>
                    <th className="text-right px-4 py-2.5 font-semibold">Days Left</th>
                    <th className="text-left px-4 py-2.5 font-semibold">Supplier</th>
                    <th className="text-right px-4 py-2.5 font-semibold">Suggested Order</th>
                    <th className="text-center px-4 py-2.5 font-semibold">Risk</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                  {filtered.map((item) => {
                    const badge = RISK_BADGE[item.risk_level];
                    return (
                      <tr key={item.id} className="bg-white dark:bg-stone-900 hover:bg-stone-50 dark:hover:bg-stone-800/50 transition-colors">
                        <td className="px-4 py-3 font-medium text-stone-800 dark:text-stone-200">{item.name}</td>
                        <td className="px-4 py-3 text-stone-500 dark:text-stone-500 capitalize">{item.category}</td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums text-stone-700 dark:text-stone-300">
                          {item.current_stock} {item.unit}
                        </td>
                        <td className={cn(
                          "px-4 py-3 text-right font-semibold tabular-nums",
                          item.risk_level === "critical" ? "text-red-600 dark:text-red-400"
                            : item.risk_level === "warning" ? "text-amber-600 dark:text-amber-400"
                            : "text-stone-600 dark:text-stone-400"
                        )}>
                          {item.days_remaining !== null ? `${item.days_remaining}d` : "—"}
                        </td>
                        <td className="px-4 py-3 text-stone-500 dark:text-stone-500">{item.supplier_name ?? "—"}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-stone-600 dark:text-stone-400">
                          {item.suggested_order !== null ? `${item.suggested_order} ${item.unit}` : "—"}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", badge.cls)}>
                            {badge.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        /* Orders tab */
        <div className="space-y-3">
          {orders.length === 0 ? (
            <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-8 text-center">
              <p className="text-sm text-stone-500">No purchase orders yet</p>
            </div>
          ) : orders.map((po) => (
            <div key={po.id} className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-4">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="text-sm font-semibold text-stone-800 dark:text-stone-200">{po.supplier_name}</p>
                  <p className="text-[10px] text-stone-400">{new Date(po.created_at).toLocaleDateString()}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                    po.status === "received" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                      : po.status === "ordered" ? "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400"
                      : po.status === "cancelled" ? "bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-500"
                      : "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
                  )}>
                    {po.status}
                  </span>
                  {po.status === "draft" && (
                    <button onClick={() => handleMarkOrdered(po.id)} className="rounded bg-blue-600 px-2 py-1 text-[10px] font-bold text-white hover:bg-blue-700">
                      Mark Ordered
                    </button>
                  )}
                  {po.status === "ordered" && (
                    <button onClick={() => handleMarkReceived(po.id)} className="rounded bg-emerald-600 px-2 py-1 text-[10px] font-bold text-white hover:bg-emerald-700">
                      Mark Received
                    </button>
                  )}
                </div>
              </div>
              {po.items && po.items.length > 0 && (
                <div className="text-[10px] text-stone-400 dark:text-stone-600">
                  {po.items.length} item{po.items.length !== 1 ? "s" : ""}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function KpiTile({ label, value, subtext, color }: { label: string; value: string; subtext?: string; color?: string }) {
  return (
    <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 px-4 py-3">
      <p className="text-[10px] uppercase tracking-wide text-stone-400 dark:text-stone-600 font-semibold">{label}</p>
      <p className={cn("text-xl font-bold tabular-nums mt-0.5", color ?? "text-stone-900 dark:text-stone-100")}>{value}</p>
      {subtext && <p className="text-[10px] text-stone-400">{subtext}</p>}
    </div>
  );
}
