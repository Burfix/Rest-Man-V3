/**
 * DataHealthIndicator — Compact data freshness summary.
 *
 * Replaces scattered freshness pills with one summarised status:
 * Good / Some delays / Stale — with expandable detail per source.
 * Includes a "Sync All" button to trigger all available data syncs.
 */

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import type { EvaluateOperationsOutput } from "@/services/decision-engine";

type Props = {
  health: EvaluateOperationsOutput["dataHealth"];
};

const STATUS_STYLES = {
  good:    { bg: "bg-emerald-500/10", text: "text-emerald-400", dot: "bg-emerald-400", label: "All data current" },
  warning: { bg: "bg-amber-500/10",   text: "text-amber-400",   dot: "bg-amber-400",   label: "Some delays" },
  stale:   { bg: "bg-red-500/10",     text: "text-red-400",     dot: "bg-red-400",     label: "Stale data" },
};

const TONE_DOT: Record<string, string> = {
  positive: "bg-emerald-400",
  warning: "bg-amber-400",
  critical: "bg-red-400",
};

async function syncAll(): Promise<{ ok: number; failed: number }> {
  const endpoints = [
    { url: "/api/micros/sync", method: "POST" },
    { url: "/api/micros/labour-sync", method: "POST", body: JSON.stringify({ mode: "delta" }) },
    { url: "/api/micros/inventory-sync", method: "POST" },
    { url: "/api/forecast/briefing", method: "GET" },
    { url: "/api/ops/operating-score", method: "GET" },
  ];

  const results = await Promise.allSettled(
    endpoints.map(({ url, method, body }) =>
      fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body,
      }),
    ),
  );

  let ok = 0;
  let failed = 0;
  for (const r of results) {
    if (r.status === "fulfilled" && r.value.ok) ok++;
    else failed++;
  }
  return { ok, failed };
}

export default function DataHealthIndicator({ health }: Props) {
  const [open, setOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ ok: number; failed: number } | null>(null);
  const router = useRouter();
  const cfg = STATUS_STYLES[health.status];

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await syncAll();
      setSyncResult(result);
      // Refresh the page to pick up fresh data
      router.refresh();
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-2">
      <h2 className="text-xs uppercase tracking-widest text-stone-500 font-medium px-1">
        Data Health
      </h2>
      <div className="rounded-xl border border-stone-800/40 bg-stone-900/50">
        <button
          onClick={() => setOpen(!open)}
          className="w-full flex items-center justify-between px-4 py-3 text-left"
        >
          <div className="flex items-center gap-2">
            <span className={cn("h-2 w-2 rounded-full", cfg.dot)} />
            <span className={cn("text-sm font-semibold", cfg.text)}>
              {cfg.label}
            </span>
          </div>
          <span className="text-stone-600 text-xs">{open ? "▲" : "▼"}</span>
        </button>

        {/* Summary */}
        <p className="px-4 pb-2 text-[11px] text-stone-500 leading-snug -mt-1">
          {health.summary}
        </p>

        {/* Expandable details */}
        {open && (
          <div className="border-t border-stone-800/40 px-4 py-2 space-y-1.5">
            {health.details.map((d) => (
              <div key={d.source} className="flex items-center justify-between text-xs">
                <span className="text-stone-400">{d.source}</span>
                <div className="flex items-center gap-1.5">
                  <span className={cn("h-1.5 w-1.5 rounded-full", TONE_DOT[d.tone] ?? "bg-stone-600")} />
                  <span className="text-stone-300 font-mono text-[11px]">{d.label}</span>
                </div>
              </div>
            ))}

            {/* Sync All button */}
            <div className="pt-2 border-t border-stone-800/30">
              <button
                onClick={handleSync}
                disabled={syncing}
                className={cn(
                  "w-full rounded-lg px-3 py-2 text-xs font-medium transition-colors",
                  "flex items-center justify-center gap-2",
                  syncing
                    ? "bg-stone-800 text-stone-500 cursor-wait"
                    : "bg-stone-800 text-stone-200 hover:bg-stone-700 active:bg-stone-600",
                )}
              >
                <svg
                  className={cn("h-3.5 w-3.5", syncing && "animate-spin")}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                {syncing ? "Syncing all sources…" : "Sync all data sources"}
              </button>
              {syncResult && !syncing && (
                <p className={cn(
                  "text-[10px] mt-1.5 text-center",
                  syncResult.failed > 0 ? "text-amber-400" : "text-emerald-400",
                )}>
                  {syncResult.ok} synced{syncResult.failed > 0 ? `, ${syncResult.failed} failed` : " — all good"}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
