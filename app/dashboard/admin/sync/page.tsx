"use client";

/**
 * app/dashboard/admin/sync/page.tsx
 *
 * Admin Sync Management — Internal Operations Page
 *
 * Panels:
 * 1. Live Status  — sync_health_monitor view (per site × sync_type)
 * 2. Data Gaps    — last 30 days × every site × sync_type, colored green/amber/red
 * 3. Queue        — sync_backfill_queue: pending / running / failed + retry
 * 4. Suspicious   — suspicious_sync_runs timeline + one-click retry
 * 5. Backfill     — compose: sites, date range, sync types → queue
 *
 * Access: super_admin only.
 */

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface HealthRow {
  connection_id: string;
  location_name: string;
  sync_type: string;
  last_synced_at: string | null;
  token_expires_at: string | null;
  consecutive_failures: number;
  is_overdue: boolean;
  next_due_at: string | null;
}

interface GapRow {
  connection_id: string;
  location_name: string;
  sync_type: string;
  business_date: string;
  status: "missing" | "empty" | "stale";
}

interface QueueRow {
  id: string;
  connection_id: string;
  sync_type: string;
  business_date: string;
  status: "pending" | "running" | "failed" | "complete";
  attempts: number;
  last_error: string | null;
  created_at: string;
}

interface SuspiciousRow {
  connection_id: string;
  sync_type: string;
  business_date: string;
  run_id: string;
  note: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function humanizeAge(isoStr: string | null): string {
  if (!isoStr) return "never";
  const diff = Date.now() - new Date(isoStr).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function daysUntil(isoStr: string | null): number | null {
  if (!isoStr) return null;
  const diff = new Date(isoStr).getTime() - Date.now();
  return Math.max(0, Math.floor(diff / (24 * 60 * 60 * 1000)));
}

async function fetchView<T>(view: string): Promise<T[]> {
  const res = await fetch(`/api/admin/sync?view=${view}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch ${view}`);
  const json = await res.json() as Record<string, T[]>;
  return (json[view] ?? []) as T[];
}

async function postAction(body: unknown): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("/api/admin/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<{ ok: boolean; error?: string }>;
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminSyncPage() {
  const [activeTab, setActiveTab] = useState<"health" | "gaps" | "queue" | "suspicious" | "backfill">("health");
  const [health, setHealth] = useState<HealthRow[]>([]);
  const [gaps, setGaps] = useState<GapRow[]>([]);
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [suspicious, setSuspicious] = useState<SuspiciousRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  // Backfill compose state
  const [bfConnectionId, setBfConnectionId] = useState("");
  const [bfSyncType, setBfSyncType] = useState("intraday_sales");
  const [bfDateFrom, setBfDateFrom] = useState("");
  const [bfDateTo, setBfDateTo] = useState("");
  const [bfPriority, setBfPriority] = useState(5);

  const loadTab = useCallback(async (tab: typeof activeTab) => {
    setLoading(true);
    try {
      if (tab === "health") setHealth(await fetchView<HealthRow>("health"));
      else if (tab === "gaps") setGaps(await fetchView<GapRow>("gaps"));
      else if (tab === "queue") setQueue(await fetchView<QueueRow>("queue"));
      else if (tab === "suspicious") setSuspicious(await fetchView<SuspiciousRow>("suspicious"));
    } catch (err) {
      showToast(`Failed to load ${tab}: ${String(err)}`, false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTab(activeTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  function showToast(msg: string, ok: boolean) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 5000);
  }

  async function handleRetryFailed() {
    const failedIds = queue.filter((q) => q.status === "failed").map((q) => q.id);
    if (failedIds.length === 0) { showToast("No failed items to retry", false); return; }
    const res = await postAction({ action: "retry_failed", queue_ids: failedIds });
    showToast(res.ok ? `Requeued ${failedIds.length} failed items` : (res.error ?? "Error"), res.ok);
    if (res.ok) void loadTab("queue");
  }

  async function handleRetryDate(row: SuspiciousRow) {
    const res = await postAction({
      action: "enqueue_dates",
      connection_id: row.connection_id,
      sync_type: row.sync_type,
      dates: [row.business_date],
      priority: 8,
    });
    showToast(res.ok ? `Queued retry for ${row.business_date}` : (res.error ?? "Error"), res.ok);
  }

  async function handleEnqueueGaps() {
    const res = await postAction({ action: "enqueue_gaps", lookback_days: 30 });
    showToast(res.ok ? "Enqueued missing sync gaps from last 30 days" : (res.error ?? "Error"), res.ok);
  }

  async function handleBackfillSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!bfConnectionId || !bfDateFrom || !bfDateTo) {
      showToast("Fill in connection ID, date from, and date to", false);
      return;
    }
    // Generate date list
    const dates: string[] = [];
    const cur = new Date(bfDateFrom);
    const end = new Date(bfDateTo);
    while (cur <= end && dates.length < 60) {
      dates.push(cur.toISOString().slice(0, 10));
      cur.setDate(cur.getDate() + 1);
    }
    const res = await postAction({
      action: "enqueue_dates",
      connection_id: bfConnectionId,
      sync_type: bfSyncType,
      dates,
      priority: bfPriority,
    });
    showToast(res.ok ? `Queued ${dates.length} dates for backfill` : (res.error ?? "Error"), res.ok);
  }

  const tabs = [
    { id: "health" as const, label: "Live Status" },
    { id: "gaps" as const, label: "Data Gaps" },
    { id: "queue" as const, label: "Queue" },
    { id: "suspicious" as const, label: "Suspicious" },
    { id: "backfill" as const, label: "Backfill" },
  ];

  return (
    <div className="space-y-6 p-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-stone-900 dark:text-stone-100 font-mono">
            Sync Management
          </h1>
          <p className="text-sm text-stone-500 mt-0.5">
            Operational view of all sync schedules, gaps, and queue state
          </p>
        </div>
        <button
          onClick={() => void loadTab(activeTab)}
          className="text-xs font-mono px-3 py-1.5 border border-stone-200 dark:border-stone-700 rounded hover:bg-stone-50 dark:hover:bg-stone-800 transition-colors"
        >
          ↻ Refresh
        </button>
      </div>

      {/* Toast */}
      {toast && (
        <div className={cn(
          "fixed bottom-4 right-4 z-50 px-4 py-2 rounded text-sm font-mono shadow-lg",
          toast.ok
            ? "bg-emerald-900 text-emerald-100 border border-emerald-700"
            : "bg-red-900 text-red-100 border border-red-700",
        )}>
          {toast.msg}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-stone-200 dark:border-stone-700">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={cn(
              "px-4 py-2 text-sm font-mono border-b-2 transition-colors",
              activeTab === t.id
                ? "border-stone-900 dark:border-stone-100 text-stone-900 dark:text-stone-100"
                : "border-transparent text-stone-500 hover:text-stone-700 dark:hover:text-stone-300",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="text-sm text-stone-500 font-mono animate-pulse">Loading…</div>
      )}

      {/* ── Health Panel ──────────────────────────────────────────────── */}
      {activeTab === "health" && !loading && (
        <div className="space-y-2">
          <div className="flex gap-2 items-center justify-between">
            <p className="text-xs text-stone-500 font-mono">{health.length} connections monitored</p>
            <button onClick={() => void handleEnqueueGaps()} className="text-xs font-mono px-3 py-1 bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 rounded hover:opacity-80">
              + Enqueue Missing Gaps
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="text-left text-stone-500 border-b border-stone-200 dark:border-stone-700">
                  <th className="py-2 pr-4">Location</th>
                  <th className="py-2 pr-4">Sync Type</th>
                  <th className="py-2 pr-4">Last Synced</th>
                  <th className="py-2 pr-4">Token Expires</th>
                  <th className="py-2 pr-4">Failures</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {health.map((row) => {
                  const tokenDays = daysUntil(row.token_expires_at);
                  return (
                    <tr key={`${row.connection_id}-${row.sync_type}`} className="border-b border-stone-100 dark:border-stone-800 hover:bg-stone-50 dark:hover:bg-stone-800/50">
                      <td className="py-1.5 pr-4 text-stone-700 dark:text-stone-300">{row.location_name}</td>
                      <td className="py-1.5 pr-4 text-stone-500">{row.sync_type}</td>
                      <td className="py-1.5 pr-4" title={row.last_synced_at ?? "never"}>
                        {humanizeAge(row.last_synced_at)}
                      </td>
                      <td className={cn("py-1.5 pr-4", tokenDays !== null && tokenDays <= 3 ? "text-red-500 font-bold" : tokenDays !== null && tokenDays <= 7 ? "text-amber-500" : "text-stone-500")}>
                        {tokenDays !== null ? `${tokenDays}d` : "—"}
                      </td>
                      <td className={cn("py-1.5 pr-4", row.consecutive_failures >= 3 ? "text-red-500 font-bold" : row.consecutive_failures > 0 ? "text-amber-500" : "text-stone-500")}>
                        {row.consecutive_failures}
                      </td>
                      <td className="py-1.5">
                        <span className={cn("px-2 py-0.5 rounded text-[10px] font-bold uppercase", row.is_overdue ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300" : "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300")}>
                          {row.is_overdue ? "OVERDUE" : "OK"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {health.length === 0 && (
                  <tr><td colSpan={6} className="py-8 text-center text-stone-400">No connections found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Gaps Panel ────────────────────────────────────────────────── */}
      {activeTab === "gaps" && !loading && (
        <div className="space-y-2">
          <p className="text-xs text-stone-500 font-mono">{gaps.length} missing data points in last 30 days</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="text-left text-stone-500 border-b border-stone-200 dark:border-stone-700">
                  <th className="py-2 pr-4">Date</th>
                  <th className="py-2 pr-4">Location</th>
                  <th className="py-2 pr-4">Sync Type</th>
                  <th className="py-2">Gap Type</th>
                </tr>
              </thead>
              <tbody>
                {gaps.map((row, i) => (
                  <tr key={i} className="border-b border-stone-100 dark:border-stone-800">
                    <td className="py-1.5 pr-4">{row.business_date}</td>
                    <td className="py-1.5 pr-4 text-stone-500">{row.location_name}</td>
                    <td className="py-1.5 pr-4 text-stone-500">{row.sync_type}</td>
                    <td className="py-1.5">
                      <span className={cn(
                        "px-2 py-0.5 rounded text-[10px] font-bold uppercase",
                        row.status === "missing" ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300" :
                        row.status === "empty" ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300" :
                        "bg-stone-100 dark:bg-stone-800 text-stone-500",
                      )}>
                        {row.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {gaps.length === 0 && (
                  <tr><td colSpan={4} className="py-8 text-center text-emerald-500">✓ No data gaps in last 30 days</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Queue Panel ───────────────────────────────────────────────── */}
      {activeTab === "queue" && !loading && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-stone-500 font-mono">{queue.length} queue items</p>
            <button onClick={() => void handleRetryFailed()} className="text-xs font-mono px-3 py-1 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded hover:opacity-80">
              Retry All Failed
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="text-left text-stone-500 border-b border-stone-200 dark:border-stone-700">
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">Type</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Attempts</th>
                  <th className="py-2">Error</th>
                </tr>
              </thead>
              <tbody>
                {queue.map((row) => (
                  <tr key={row.id} className="border-b border-stone-100 dark:border-stone-800">
                    <td className="py-1.5 pr-3">{row.business_date}</td>
                    <td className="py-1.5 pr-3 text-stone-500">{row.sync_type}</td>
                    <td className="py-1.5 pr-3">
                      <span className={cn(
                        "px-1.5 py-0.5 rounded text-[10px] font-bold uppercase",
                        row.status === "pending" ? "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400" :
                        row.status === "running" ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300" :
                        row.status === "failed" ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300" :
                        "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300",
                      )}>
                        {row.status}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 text-stone-500">{row.attempts}</td>
                    <td className="py-1.5 text-stone-400 max-w-xs truncate">{row.last_error ?? "—"}</td>
                  </tr>
                ))}
                {queue.length === 0 && (
                  <tr><td colSpan={5} className="py-8 text-center text-stone-400">Queue is empty</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Suspicious Panel ──────────────────────────────────────────── */}
      {activeTab === "suspicious" && !loading && (
        <div className="space-y-2">
          <p className="text-xs text-stone-500 font-mono">{suspicious.length} suspicious runs</p>
          <div className="space-y-2">
            {suspicious.map((row, i) => (
              <div key={i} className="flex items-center justify-between px-4 py-2 border border-amber-200 dark:border-amber-800/50 rounded bg-amber-50 dark:bg-amber-900/10">
                <div className="text-xs font-mono">
                  <span className="text-amber-700 dark:text-amber-300 font-bold">{row.business_date}</span>
                  <span className="text-stone-500 ml-2">{row.sync_type}</span>
                  {row.note && <span className="text-stone-400 ml-2">— {row.note}</span>}
                </div>
                <button
                  onClick={() => void handleRetryDate(row)}
                  className="text-[10px] font-mono px-2 py-1 bg-amber-800 text-amber-100 rounded hover:bg-amber-700 transition-colors"
                >
                  Retry
                </button>
              </div>
            ))}
            {suspicious.length === 0 && (
              <div className="py-8 text-center text-emerald-500 text-sm font-mono">✓ No suspicious runs detected</div>
            )}
          </div>
        </div>
      )}

      {/* ── Backfill Composer ─────────────────────────────────────────── */}
      {activeTab === "backfill" && (
        <form onSubmit={(e) => void handleBackfillSubmit(e)} className="space-y-4 max-w-lg">
          <p className="text-xs text-stone-500 font-mono">
            Queue a targeted backfill for a specific connection, date range, and sync type.
          </p>
          <div className="space-y-3">
            <label className="block">
              <span className="text-xs font-mono text-stone-600 dark:text-stone-400">Connection ID (UUID)</span>
              <input
                type="text"
                value={bfConnectionId}
                onChange={(e) => setBfConnectionId(e.target.value)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                className="mt-1 w-full text-xs font-mono px-3 py-2 border border-stone-200 dark:border-stone-700 rounded bg-transparent focus:outline-none focus:ring-1 focus:ring-stone-400"
              />
            </label>
            <label className="block">
              <span className="text-xs font-mono text-stone-600 dark:text-stone-400">Sync Type</span>
              <select
                value={bfSyncType}
                onChange={(e) => setBfSyncType(e.target.value)}
                className="mt-1 w-full text-xs font-mono px-3 py-2 border border-stone-200 dark:border-stone-700 rounded bg-transparent focus:outline-none focus:ring-1 focus:ring-stone-400"
              >
                {["intraday_sales", "daily_sales", "guest_checks", "intervals", "labour"].map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>
            <div className="flex gap-3">
              <label className="block flex-1">
                <span className="text-xs font-mono text-stone-600 dark:text-stone-400">From</span>
                <input
                  type="date"
                  value={bfDateFrom}
                  onChange={(e) => setBfDateFrom(e.target.value)}
                  className="mt-1 w-full text-xs font-mono px-3 py-2 border border-stone-200 dark:border-stone-700 rounded bg-transparent focus:outline-none focus:ring-1 focus:ring-stone-400"
                />
              </label>
              <label className="block flex-1">
                <span className="text-xs font-mono text-stone-600 dark:text-stone-400">To</span>
                <input
                  type="date"
                  value={bfDateTo}
                  onChange={(e) => setBfDateTo(e.target.value)}
                  className="mt-1 w-full text-xs font-mono px-3 py-2 border border-stone-200 dark:border-stone-700 rounded bg-transparent focus:outline-none focus:ring-1 focus:ring-stone-400"
                />
              </label>
            </div>
            <label className="block">
              <span className="text-xs font-mono text-stone-600 dark:text-stone-400">Priority (0=low, 10=urgent)</span>
              <input
                type="number"
                min={0}
                max={10}
                value={bfPriority}
                onChange={(e) => setBfPriority(parseInt(e.target.value, 10))}
                className="mt-1 w-24 text-xs font-mono px-3 py-2 border border-stone-200 dark:border-stone-700 rounded bg-transparent focus:outline-none focus:ring-1 focus:ring-stone-400"
              />
            </label>
          </div>
          <button
            type="submit"
            className="px-4 py-2 text-xs font-mono font-bold bg-stone-900 dark:bg-stone-100 text-stone-100 dark:text-stone-900 rounded hover:opacity-80 transition-opacity"
          >
            Queue Backfill
          </button>
        </form>
      )}
    </div>
  );
}
