/**
 * StockOnHand — GM-facing stock visibility dashboard.
 *
 * Shows current stock levels with urgency-sorted table,
 * search, status filter tabs, low-stock toggle, and refresh.
 */

"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import type { InventoryItem, StockOnHandItem, StockOnHandStatus } from "@/types/inventory";
import { toStockOnHandItem, sortByUrgency } from "@/lib/inventory/stockStatus";

type StatusFilter = "all" | StockOnHandStatus;

const STATUS_BADGE: Record<StockOnHandStatus, { label: string; cls: string }> = {
  critical:    { label: "Critical",    cls: "bg-red-500/15 text-red-400" },
  running_low: { label: "Running Low", cls: "bg-amber-500/15 text-amber-400" },
  healthy:     { label: "Healthy",     cls: "bg-emerald-500/15 text-emerald-400" },
};

const FILTER_TABS: { key: StatusFilter; label: string }[] = [
  { key: "all",         label: "All" },
  { key: "critical",    label: "Critical" },
  { key: "running_low", label: "Running Low" },
  { key: "healthy",     label: "Healthy" },
];

export default function StockOnHand() {
  const [items, setItems] = useState<StockOnHandItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);


  const fetchData = useCallback(async () => {
    try {
      setRefreshing(true);
      const res = await fetch("/api/inventory");
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      const raw = (data.items ?? []) as InventoryItem[];
      setItems(sortByUrgency(raw.map(toStockOnHandItem)));
      setLastFetched(new Date());
    } catch (err) {
      console.error("Stock fetch error:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const syncFromMicros = useCallback(async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch("/api/micros/inventory-sync", { method: "POST" });
      const data = await res.json();
      setSyncMsg(data.ok ? `✓ ${data.message}` : `✗ ${data.message}`);
      if (data.ok) await fetchData();
    } catch {
      setSyncMsg("✗ Sync failed — check connection");
    } finally {
      setSyncing(false);
    }
  }, [fetchData]);



  // ── Derived data ────────────────────────────────────────────────────────

  const counts = useMemo(() => {
    let critical = 0, running_low = 0, healthy = 0;
    for (const i of items) {
      if (i.status === "critical") critical++;
      else if (i.status === "running_low") running_low++;
      else healthy++;
    }
    return { total: items.length, critical, running_low, healthy };
  }, [items]);

  const filtered = useMemo(() => {
    let result = items;

    if (lowStockOnly) {
      result = result.filter((i) => i.status === "critical" || i.status === "running_low");
    }
    if (statusFilter !== "all") {
      result = result.filter((i) => i.status === statusFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (i) => i.item_name.toLowerCase().includes(q) || i.category.toLowerCase().includes(q),
      );
    }
    return result;
  }, [items, statusFilter, lowStockOnly, search]);

  // ── Loading skeleton ────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-20 rounded-xl bg-stone-800/50" />
          ))}
        </div>
        <div className="h-10 rounded-lg bg-stone-800/50 w-72" />
        <div className="h-96 rounded-xl bg-stone-800/50" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ── Summary Cards ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard label="Total Items" value={counts.total} />
        <SummaryCard
          label="Critical"
          value={counts.critical}
          color={counts.critical > 0 ? "text-red-400" : undefined}
          dotColor={counts.critical > 0 ? "bg-red-400 animate-pulse" : "bg-stone-600"}
        />
        <SummaryCard
          label="Running Low"
          value={counts.running_low}
          color={counts.running_low > 0 ? "text-amber-400" : undefined}
          dotColor={counts.running_low > 0 ? "bg-amber-400" : "bg-stone-600"}
        />
        <SummaryCard
          label="Healthy"
          value={counts.healthy}
          color="text-emerald-400"
          dotColor="bg-emerald-400"
        />
      </div>

      {/* ── Toolbar: search + filter + toggle + refresh ────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 max-w-xs">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-stone-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search items..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-stone-800/60 bg-stone-900/50 pl-9 pr-3 py-2 text-xs text-stone-200 placeholder:text-stone-600 focus:outline-none focus:border-stone-600 transition-colors"
          />
        </div>

        {/* Status filter tabs */}
        <div className="flex gap-1">
          {FILTER_TABS.map((t) => {
            const count = t.key === "all" ? counts.total : counts[t.key];
            return (
              <button
                key={t.key}
                onClick={() => setStatusFilter(t.key)}
                className={cn(
                  "rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors",
                  statusFilter === t.key
                    ? "bg-stone-700 text-stone-100"
                    : "bg-stone-900/50 text-stone-500 hover:bg-stone-800 hover:text-stone-300",
                )}
              >
                {t.label} ({count})
              </button>
            );
          })}
        </div>

        {/* Low stock toggle */}
        <label className="flex items-center gap-2 cursor-pointer select-none shrink-0">
          <button
            role="switch"
            aria-checked={lowStockOnly}
            onClick={() => setLowStockOnly(!lowStockOnly)}
            className={cn(
              "relative h-5 w-9 rounded-full transition-colors",
              lowStockOnly ? "bg-amber-500" : "bg-stone-700",
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform",
                lowStockOnly && "translate-x-4",
              )}
            />
          </button>
          <span className="text-[11px] text-stone-400">Low stock only</span>
        </label>

        {/* Refresh + MICROS sync + timestamp */}
        <div className="flex items-center gap-2 sm:ml-auto shrink-0">
          {lastFetched && (
            <span className="text-[10px] text-stone-600 font-mono">
              Updated {lastFetched.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}

          <button
            onClick={syncFromMicros}
            disabled={syncing}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
              syncing
                ? "border-orange-800/40 text-orange-700 cursor-wait"
                : "border-orange-800/60 text-orange-400 hover:bg-orange-900/20 hover:text-orange-300",
            )}
          >
            <svg
              className={cn("h-3.5 w-3.5", syncing && "animate-spin")}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
            </svg>
            {syncing ? "Syncing…" : "Sync MICROS"}
          </button>
          <button
            onClick={fetchData}
            disabled={refreshing}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border border-stone-800/60 px-3 py-1.5 text-xs font-medium transition-colors",
              refreshing
                ? "text-stone-600 cursor-wait"
                : "text-stone-400 hover:bg-stone-800 hover:text-stone-200",
            )}
          >
            <svg
              className={cn("h-3.5 w-3.5", refreshing && "animate-spin")}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {/* ── MICROS sync result banner ──────────────────────────────────── */}
      {syncMsg && (
        <div className={cn(
          "rounded-lg px-4 py-2 text-xs font-medium",
          syncMsg.startsWith("✓")
            ? "bg-emerald-950/30 text-emerald-400 border border-emerald-800/30"
            : "bg-red-950/30 text-red-400 border border-red-800/30",
        )}>
          {syncMsg}
        </div>
      )}

      {/* ── Table ──────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-stone-800/40 bg-stone-900/50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-stone-800/30 text-stone-500">
                <th className="text-left px-4 py-2.5 font-semibold">Item Name</th>
                <th className="text-right px-4 py-2.5 font-semibold">Stock on Hand</th>
                <th className="text-left px-4 py-2.5 font-semibold">Unit</th>
                <th className="text-right px-4 py-2.5 font-semibold">Min Level</th>
                <th className="text-right px-4 py-2.5 font-semibold">Par Level</th>
                <th className="text-center px-4 py-2.5 font-semibold">Status</th>
                <th className="text-right px-4 py-2.5 font-semibold">Last Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-800/30">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-stone-600">
                    {search || statusFilter !== "all"
                      ? "No items match your filters"
                      : "No inventory items found"}
                  </td>
                </tr>
              ) : (
                filtered.map((item) => {
                  const badge = STATUS_BADGE[item.status];
                  return (
                    <tr
                      key={item.id}
                      className={cn(
                        "hover:bg-stone-800/30 transition-colors",
                        item.status === "critical" && "bg-red-950/10",
                      )}
                    >
                      <td className="px-4 py-3 font-medium text-stone-200">
                        {item.item_name}
                        <span className="ml-2 text-[10px] text-stone-600 capitalize">{item.category}</span>
                      </td>
                      <td className={cn(
                        "px-4 py-3 text-right font-semibold tabular-nums",
                        item.status === "critical" ? "text-red-400"
                          : item.status === "running_low" ? "text-amber-400"
                          : "text-stone-300"
                      )}>
                        {item.stock_on_hand}
                      </td>
                      <td className="px-4 py-3 text-stone-500">{item.unit}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-stone-500">{item.min_level}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-stone-500">{item.par_level}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", badge.cls)}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-stone-600 font-mono text-[10px]">
                        {formatTimestamp(item.last_updated)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Footer context ─────────────────────────────────────────────── */}
      <p className="text-[10px] text-stone-600 px-1">
        Showing {filtered.length} of {counts.total} items
        {lowStockOnly && " · low stock filter active"}
      </p>
    </div>
  );
}

// ── Helper components ────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  color,
  dotColor,
}: {
  label: string;
  value: number;
  color?: string;
  dotColor?: string;
}) {
  return (
    <div className="rounded-xl border border-stone-800/40 bg-stone-900/50 px-4 py-3">
      <div className="flex items-center gap-1.5 mb-1">
        {dotColor && <span className={cn("h-1.5 w-1.5 rounded-full", dotColor)} />}
        <p className="text-[10px] uppercase tracking-wide text-stone-500 font-semibold">{label}</p>
      </div>
      <p className={cn("text-2xl font-bold tabular-nums", color ?? "text-stone-100")}>{value}</p>
    </div>
  );
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  return d.toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
}
