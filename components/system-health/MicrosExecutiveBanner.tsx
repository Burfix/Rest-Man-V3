/**
 * MicrosExecutiveBanner — top-level summary bar for the MICROS mission control.
 * Shows: Sites Healthy X/Y | Issues X | Records synced today | Avg latency | Worst site
 */
"use client";

import React from "react";
import type { MicrosHealthSummary } from "@/lib/system-health/micros-health-types";

interface Props {
  summary: MicrosHealthSummary;
  asOf: string;
}

const severityBg = {
  healthy:  "bg-emerald-950/50 border-emerald-800/40",
  warning:  "bg-amber-950/50   border-amber-800/40",
  critical: "bg-red-950/50     border-red-800/40",
} as const;

const severityText = {
  healthy:  "text-emerald-400",
  warning:  "text-amber-400",
  critical: "text-red-400",
} as const;

export default function MicrosExecutiveBanner({ summary, asOf }: Props) {
  const bg   = severityBg[summary.overallSeverity];
  const text = severityText[summary.overallSeverity];

  return (
    <div className={`rounded-xl border p-4 flex flex-wrap gap-6 items-center justify-between ${bg}`}>
      <div className="flex gap-6 flex-wrap">
        <Stat
          label="Sites Healthy"
          value={`${summary.healthySites}/${summary.totalSites}`}
          color={summary.criticalSites > 0 ? "text-red-400" : summary.warningSites > 0 ? "text-amber-400" : "text-emerald-400"}
        />
        <Stat label="Issues" value={String(summary.criticalSites + summary.warningSites)} color={text} />
        <Stat label="Synced Today" value={summary.totalSyncedToday.toLocaleString()} color="text-slate-300" />
        <Stat
          label="Avg Latency"
          value={summary.avgLatencyMs ? `${(summary.avgLatencyMs / 1000).toFixed(1)}s` : "—"}
          color="text-slate-300"
        />
        {summary.worstSite && (
          <Stat label="Worst Site" value={summary.worstSite} color="text-amber-400" />
        )}
      </div>
      <span className="text-xs text-slate-500">
        Updated {new Date(asOf).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}
      </span>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-slate-500 uppercase tracking-wider">{label}</span>
      <span className={`text-lg font-bold ${color}`}>{value}</span>
    </div>
  );
}
