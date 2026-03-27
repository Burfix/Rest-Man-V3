/**
 * SyncHealthCard — Shows per-type sync status (healthy/stale/failed/never).
 *
 * Fetches from GET /api/sync/status and displays a compact health overview
 * with per-type pills and a manual sync trigger button.
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";

interface TypeStatus {
  status: "healthy" | "stale" | "failed" | "never";
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastRunStatus: string | null;
  durationMs: number | null;
  error: string | null;
  freshnessMinutes: number | null;
}

interface SyncStatusResponse {
  site: { id: string; name: string };
  types: Record<string, TypeStatus>;
}

const STATUS_CONFIG = {
  healthy: { dot: "bg-emerald-400", text: "text-emerald-400", label: "Healthy" },
  stale: { dot: "bg-amber-400", text: "text-amber-400", label: "Stale" },
  failed: { dot: "bg-red-400", text: "text-red-400", label: "Failed" },
  never: { dot: "bg-zinc-500", text: "text-zinc-400", label: "Never synced" },
};

const TYPE_LABELS: Record<string, string> = {
  sales: "Sales",
  labour: "Labour",
  inventory: "Inventory",
};

function formatAgo(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function SyncHealthCard() {
  const [data, setData] = useState<SyncStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/sync/status");
      if (res.ok) {
        setData(await res.json());
      }
    } catch {
      // Silent fail — card just stays in loading state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    // Refresh every 2 minutes
    const interval = setInterval(fetchStatus, 120_000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const triggerSync = async (syncType: string) => {
    setSyncing(syncType);
    try {
      await fetch("/api/sync/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ syncType }),
      });
      // Refresh status after sync
      await fetchStatus();
    } catch {
      // Will show in next status refresh
    } finally {
      setSyncing(null);
    }
  };

  // Overall status
  const overallStatus = (() => {
    if (!data) return "never";
    const statuses = Object.values(data.types).map((t) => t.status);
    if (statuses.includes("failed")) return "failed";
    if (statuses.includes("stale")) return "stale";
    if (statuses.every((s) => s === "never")) return "never";
    return "healthy";
  })();

  const cfg = STATUS_CONFIG[overallStatus as keyof typeof STATUS_CONFIG];

  if (loading) {
    return (
      <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4 animate-pulse">
        <div className="h-5 w-32 bg-white/5 rounded" />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between"
      >
        <div className="flex items-center gap-2">
          <span className={cn("h-2 w-2 rounded-full", cfg.dot)} />
          <span className="text-sm font-medium text-white/90">Sync Health</span>
          <span className={cn("text-xs", cfg.text)}>{cfg.label}</span>
        </div>
        <svg
          className={cn(
            "h-4 w-4 text-white/40 transition-transform",
            expanded && "rotate-180",
          )}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expanded detail */}
      {expanded && data && (
        <div className="mt-3 space-y-2 border-t border-white/5 pt-3">
          {Object.entries(data.types).map(([type, info]) => {
            const tc = STATUS_CONFIG[info.status];
            return (
              <div
                key={type}
                className="flex items-center justify-between text-sm"
              >
                <div className="flex items-center gap-2">
                  <span className={cn("h-1.5 w-1.5 rounded-full", tc.dot)} />
                  <span className="text-white/70">{TYPE_LABELS[type] ?? type}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className={cn("text-xs", tc.text)}>
                    {info.status === "never"
                      ? "—"
                      : formatAgo(info.freshnessMinutes)}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      triggerSync(type);
                    }}
                    disabled={syncing === type}
                    className={cn(
                      "rounded px-2 py-0.5 text-xs font-medium transition-colors",
                      syncing === type
                        ? "bg-white/5 text-white/30 cursor-not-allowed"
                        : "bg-white/5 text-white/60 hover:bg-white/10 hover:text-white/90",
                    )}
                  >
                    {syncing === type ? "Syncing…" : "Sync"}
                  </button>
                </div>
              </div>
            );
          })}

          {/* Error detail */}
          {Object.entries(data.types)
            .filter(([, info]) => info.error)
            .map(([type, info]) => (
              <div
                key={`err-${type}`}
                className="mt-1 rounded bg-red-500/10 px-2 py-1 text-xs text-red-400"
              >
                {TYPE_LABELS[type]}: {info.error}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
