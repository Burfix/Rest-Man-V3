/**
 * DataHealthWarning — Structured data health warning.
 *
 * Terminal-style [SYNC ALL] button. Amber warning colors.
 * Compact, war-room aesthetic.
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
    label: "ALL SYSTEMS CURRENT",
    desc: "All data sources are fresh. Decisions are fully informed.",
  },
  warning: {
    bg: "border-amber-800/30 bg-amber-950/10",
    dot: "bg-amber-400 animate-pulse",
    label: "PARTIAL DATA GAPS",
    desc: "Some data sources are delayed. Affected decisions are marked with lower confidence.",
  },
  stale: {
    bg: "border-red-800/30 bg-red-950/10",
    dot: "bg-red-400 animate-pulse",
    label: "CRITICAL DATA GAPS",
    desc: "Key data sources are stale. Operating score and decisions may not reflect reality.",
  },
};

const TONE_STYLES: Record<string, { dot: string; text: string }> = {
  positive: { dot: "bg-emerald-400", text: "text-emerald-400" },
  warning: { dot: "bg-amber-400", text: "text-amber-400" },
  critical: { dot: "bg-red-400", text: "text-red-400" },
  neutral: { dot: "bg-stone-600", text: "text-stone-500" },
};

const SOURCE_REMEDIATION: Record<string, string> = {
  Sales: "Sales data syncs from MICROS via the BI API. Check MICROS connection.",
  Labour: "Labour syncs from MICROS time cards. Ensure crew are clocking in.",
  "Daily Ops": "Daily ops come from the daily upload form. Complete today's form.",
  Compliance: "Compliance updates during inspections. Schedule next inspection.",
  Maintenance: "Maintenance updates when tasks are logged. Check maintenance queue.",
  Forecast: "Forecast pulls from Google Calendar + historical sales.",
};

interface SyncAllResult {
  ok: number;
  failed: number;
  errors: string[];
}

async function syncAll(): Promise<SyncAllResult> {
  const endpoints = [
    { label: "Sales",  url: "/api/micros/sync",        method: "POST" },
    { label: "Labour", url: "/api/micros/labour-sync",  method: "POST", body: JSON.stringify({ mode: "delta" }) },
  ];

  const results = await Promise.allSettled(
    endpoints.map(({ url, method, body }) =>
      fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ?? "{}",
      }),
    ),
  );

  let ok = 0;
  let failed = 0;
  const errors: string[] = [];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const label = endpoints[i].label;
    if (r.status === "rejected") {
      failed++;
      errors.push(`${label}: ${r.reason}`);
    } else if (!r.value.ok) {
      failed++;
      const text = await r.value.text().catch(() => "");
      errors.push(`${label}: HTTP ${r.value.status} — ${text.slice(0, 120)}`);
    } else {
      try {
        const json = await r.value.json();
        if (json.ok === false) {
          failed++;
          errors.push(`${label}: ${json.message || "Sync returned failure"}`);
        } else {
          ok++;
        }
      } catch {
        ok++;
      }
    }
  }
  return { ok, failed, errors };
}

export default function DataHealthWarning({ health }: Props) {
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncAllResult | null>(null);
  const router = useRouter();
  const meta = STATUS_META[health.status];

  const staleCount = health.details.filter((d) => d.tone === "critical" || d.tone === "warning").length;

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await syncAll();
      setSyncResult(result);
      if (result.ok > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, 3000));
        router.refresh();
      }
    } finally {
      setSyncing(false);
    }
  };

  if (health.status === "good") {
    return (
      <div className={cn("rounded border px-4 py-2.5", meta.bg)}>
        <div className="flex items-center gap-2">
          <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", meta.dot)} />
          <span className="font-mono text-[10px] font-semibold text-emerald-500 uppercase tracking-wider">
            {meta.label}
          </span>
          <span className="text-[10px] text-stone-600 font-mono ml-auto">{health.summary}</span>
        </div>
        {syncResult && (
          <div className={cn(
            "mt-1 text-[10px] font-mono",
            syncResult.failed > 0 ? "text-red-400" : "text-emerald-500",
          )}>
            {syncResult.failed > 0
              ? `[FAIL] ${syncResult.ok} ok, ${syncResult.failed} failed`
              : `[OK] ${syncResult.ok} source${syncResult.ok !== 1 ? "s" : ""} updated`}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={cn("rounded border px-4 py-3 space-y-2.5", meta.bg)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={cn("h-2 w-2 rounded-full shrink-0", meta.dot)} />
          <span className={cn(
            "font-mono text-[11px] font-bold uppercase tracking-wider",
            health.status === "stale" ? "text-red-400" : "text-amber-400",
          )}>
            {meta.label}
          </span>
          <span className="text-[10px] text-stone-600 font-mono">
            {staleCount} source{staleCount !== 1 ? "s" : ""}
          </span>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className={cn(
            "font-mono text-[11px] px-2 py-1 border transition-colors",
            "border-amber-700/40 text-amber-500 hover:border-amber-400 hover:text-amber-300",
            syncing && "opacity-40 cursor-not-allowed",
          )}
        >
          {syncing ? "[ SYNCING... ]" : "[ SYNC ALL ]"}
        </button>
      </div>

      {/* Impact statement */}
      <p className="text-[10px] text-stone-500 leading-snug">{meta.desc}</p>

      {/* Per-source breakdown */}
      <div className="space-y-1">
        {health.details.map((d) => {
          const tone = TONE_STYLES[d.tone] ?? { dot: "bg-stone-600", text: "text-stone-500 dark:text-stone-400" };
          const remedy = SOURCE_REMEDIATION[d.source];
          const isIssue = d.tone === "critical" || d.tone === "warning";

          return (
            <div
              key={d.source}
              className={cn(
                "px-2.5 py-1.5 border",
                isIssue ? "border-stone-200 dark:border-stone-800/50 bg-stone-50 dark:bg-stone-900/50" : "border-transparent",
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", tone.dot)} />
                  <span className="text-[11px] text-stone-500 dark:text-stone-400 font-medium">{d.source}</span>
                </div>
                <span className={cn("text-[10px] font-mono", tone.text)}>
                  {d.label}
                </span>
              </div>
              {isIssue && remedy && (
                <p className="mt-0.5 ml-3.5 text-[9px] text-stone-600 leading-snug">
                  → {remedy}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Sync result */}
      {syncResult && (
        <div className={cn(
          "text-[10px] font-mono pt-2 border-t border-stone-200 dark:border-stone-800/30",
          syncResult.failed > 0 ? "text-red-400" : "text-emerald-500",
        )}>
          {syncResult.failed > 0
            ? `[FAIL] ${syncResult.ok} ok, ${syncResult.failed} failed`
            : `[OK] ${syncResult.ok} source${syncResult.ok !== 1 ? "s" : ""} synced`}
          {syncResult.errors.length > 0 && (
            <div className="mt-1 text-[9px] text-red-400/80 space-y-0.5 break-all">
              {syncResult.errors.map((e, i) => <div key={i}>{e}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
