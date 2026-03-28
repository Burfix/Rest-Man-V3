/**
 * DataHealthWarning — Structured data health warning.
 *
 * Replaces abstract "low confidence" signals with specific:
 * - What data sources are stale
 * - Impact on brain decisions
 * - What to do about it
 *
 * Includes a Sync All button and per-source freshness breakdown.
 */

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import type { EvaluateOperationsOutput } from "@/services/decision-engine";

type Props = {
  health: EvaluateOperationsOutput["dataHealth"];
};

const STATUS_META = {
  good: {
    bg: "border-emerald-800/30 bg-emerald-950/20",
    dot: "bg-emerald-400",
    label: "All Systems Current",
    icon: "✓",
    desc: "All data sources are fresh. Decisions are fully informed.",
  },
  warning: {
    bg: "border-amber-800/30 bg-amber-950/20",
    dot: "bg-amber-400 animate-pulse",
    label: "Partial Data Gaps",
    icon: "⚠",
    desc: "Some data sources are delayed. Affected decisions are marked with lower confidence.",
  },
  stale: {
    bg: "border-red-800/30 bg-red-950/20",
    dot: "bg-red-400 animate-pulse",
    label: "Critical Data Gaps",
    icon: "✕",
    desc: "Key data sources are stale. Operating score and decisions may not reflect reality.",
  },
};

const TONE_STYLES: Record<string, { dot: string; text: string }> = {
  positive: { dot: "bg-emerald-400", text: "text-emerald-400" },
  warning: { dot: "bg-amber-400", text: "text-amber-400" },
  critical: { dot: "bg-red-400", text: "text-red-400" },
};

const SOURCE_REMEDIATION: Record<string, string> = {
  Sales: "Sales data syncs from MICROS via the BI API. Check MICROS connection.",
  Labour: "Labour syncs from MICROS time cards. Ensure crew are clocking in.",
  "Daily Ops": "Daily ops come from the daily upload form. Complete today's form.",
  Inventory: "Inventory requires Oracle IM module. Manual counts available.",
  Compliance: "Compliance updates during inspections. Schedule next inspection.",
  Maintenance: "Maintenance updates when tasks are logged. Check maintenance queue.",
  Forecast: "Forecast pulls from Google Calendar + historical sales.",
};

async function syncAll(): Promise<{ ok: number; failed: number }> {
  const endpoints = [
    { url: "/api/micros/sync",        method: "POST" },
    { url: "/api/micros/labour-sync", method: "POST", body: JSON.stringify({ mode: "delta" }) },
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

export default function DataHealthWarning({ health }: Props) {
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ ok: number; failed: number } | null>(null);
  const router = useRouter();
  const meta = STATUS_META[health.status];

  // Count issues
  const staleCount = health.details.filter((d) => d.tone === "critical" || d.tone === "warning").length;

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await syncAll();
      setSyncResult(result);
      // Brief pause so the user can read the result before the panel re-renders
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
      router.refresh();
    } finally {
      setSyncing(false);
    }
  };

  // If everything is good, show minimal indicator
  if (health.status === "good") {
    return (
      <div className={cn("rounded-xl border px-4 py-3", meta.bg)}>
        <div className="flex items-center gap-2">
          <span className={cn("h-2 w-2 rounded-full", meta.dot)} />
          <span className="text-xs font-semibold text-emerald-400">{meta.label}</span>
          <span className="text-[10px] text-stone-500 ml-auto">{health.summary}</span>
        </div>
        {syncResult && (
          <div className="mt-1.5 text-[11px] text-emerald-500">
            ✓ Sync complete — {syncResult.ok} source{syncResult.ok !== 1 ? "s" : ""} updated
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={cn("rounded-xl border px-4 py-4 space-y-3", meta.bg)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={cn("h-2.5 w-2.5 rounded-full", meta.dot)} />
          <span className={cn(
            "text-sm font-bold",
            health.status === "stale" ? "text-red-400" : "text-amber-400",
          )}>
            {meta.label}
          </span>
          <span className="text-[10px] text-stone-500 font-mono">
            {staleCount} source{staleCount !== 1 ? "s" : ""} affected
          </span>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className={cn(
            "rounded-md px-3 py-1.5 text-[11px] font-semibold transition-colors",
            "bg-orange-600/80 text-white hover:bg-orange-500/90",
            syncing && "opacity-50 cursor-not-allowed",
          )}
        >
          {syncing ? "Syncing…" : "Sync All"}
        </button>
      </div>

      {/* Impact statement */}
      <p className="text-xs text-stone-400 leading-relaxed">{meta.desc}</p>

      {/* Per-source breakdown */}
      <div className="space-y-1.5">
        {health.details.map((d) => {
          const tone = TONE_STYLES[d.tone] ?? { dot: "bg-stone-600", text: "text-stone-400" };
          const remedy = SOURCE_REMEDIATION[d.source];
          const isIssue = d.tone === "critical" || d.tone === "warning";

          return (
            <div
              key={d.source}
              className={cn(
                "rounded-lg px-3 py-2 border",
                isIssue ? "border-stone-800/50 bg-stone-900/50" : "border-transparent",
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={cn("h-1.5 w-1.5 rounded-full", tone.dot)} />
                  <span className="text-xs text-stone-300 font-medium">{d.source}</span>
                </div>
                <span className={cn("text-[11px] font-mono", tone.text)}>
                  {d.label}
                </span>
              </div>
              {isIssue && remedy && (
                <p className="mt-1 ml-3.5 text-[10px] text-stone-500 leading-snug">
                  → {remedy}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Sync result */}
      {syncResult && (
        <div className="text-[11px] text-stone-500 pt-1 border-t border-stone-800/30">
          Synced: {syncResult.ok} ok, {syncResult.failed} failed
        </div>
      )}
    </div>
  );
}
