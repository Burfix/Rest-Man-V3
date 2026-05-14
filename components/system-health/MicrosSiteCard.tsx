/**
 * MicrosSiteCard — per-site health card for the MICROS mission control.
 *
 * Shows: status dot, health gauge, last sync, data age, sales/labour synced today,
 *        latency, failures 24h/7d, and manual sync controls.
 */
"use client";

import React, { useState } from "react";
import type { MicrosSiteHealth } from "@/lib/system-health/micros-health-types";
import MicrosHealthGauge      from "@/components/system-health/MicrosHealthGauge";
import MicrosSyncControls     from "@/components/system-health/MicrosSyncControls";
import MicrosSyncLogsDrawer   from "@/components/system-health/MicrosSyncLogsDrawer";

interface Props {
  site: MicrosSiteHealth;
}

const SEVERITY_BORDER = {
  healthy:  "border-emerald-800/40",
  warning:  "border-amber-800/40",
  critical: "border-red-700/50",
} as const;

const STATUS_DOT = {
  connected:    "bg-emerald-500",
  disconnected: "bg-red-500",
  error:        "bg-red-500",
  pending:      "bg-yellow-500",
  syncing:      "bg-blue-500",
} as const;

function formatAge(minutes: number | null): string {
  if (minutes == null) return "Never";
  if (minutes < 60)    return `${Math.round(minutes)}m ago`;
  if (minutes < 1440)  return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1440)}d ago`;
}

function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

export default function MicrosSiteCard({ site }: Props) {
  const [logsOpen, setLogsOpen] = useState(false);
  const severity                = site.health.severity;
  const severityBorder          = SEVERITY_BORDER[severity];
  const dotColor                = STATUS_DOT[site.connectionStatus as keyof typeof STATUS_DOT] ?? "bg-slate-500";

  return (
    <>
      <div className={`rounded-xl border bg-slate-900/60 p-4 flex flex-col gap-3 ${severityBorder}`}>
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`flex-none w-2.5 h-2.5 rounded-full ${dotColor}`} />
            <div className="min-w-0">
              <h3 className="text-slate-100 font-semibold truncate">{site.siteName}</h3>
              <p className="text-xs text-slate-500">{site.locationKey} · {site.locationRef}</p>
            </div>
          </div>
          <MicrosHealthGauge score={site.health.score} severity={severity} size={56} />
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-xs">
          <Metric label="Last Sync"     value={site.lastSyncAt ? new Date(site.lastSyncAt).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" }) : "—"} />
          <Metric label="Data Age"      value={formatAge(site.dataAgeMinutes)} warn={site.dataAgeMinutes != null && site.dataAgeMinutes > 120} />
          <Metric label="Latency"       value={formatDuration(site.lastDurationMs)} />
          <Metric label="Sales Today"   value={site.salesSyncedToday?.toLocaleString() ?? "—"} />
          <Metric label="Labour Today"  value={site.labourSyncedToday?.toLocaleString() ?? "—"} />
          <Metric label="Sync Count"    value={site.syncCountToday?.toString() ?? "—"} />
          <Metric label="Failures 24h"  value={site.failures24h?.toString() ?? "0"} warn={(site.failures24h ?? 0) > 0} />
          <Metric label="Failures 7d"   value={site.failures7d?.toString() ?? "0"} warn={(site.failures7d ?? 0) > 3} />
          <Metric label="Avg Latency"   value={formatDuration(site.avgDurationMs)} />
        </div>

        {/* Last error */}
        {site.lastSyncError && (
          <p className="text-xs text-red-400 bg-red-950/30 rounded p-2 leading-snug truncate" title={site.lastSyncError}>
            {site.lastSyncError}
          </p>
        )}

        {/* Controls */}
        <MicrosSyncControls
          locationKey={site.locationKey ?? ""}
          connectionId={site.connectionId}
          onLogsClick={() => setLogsOpen(true)}
        />
      </div>

      {logsOpen && (
        <MicrosSyncLogsDrawer
          connectionId={site.connectionId}
          siteName={site.siteName}
          onClose={() => setLogsOpen(false)}
        />
      )}
    </>
  );
}

function Metric({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <span className="text-slate-500 block">{label}</span>
      <span className={warn ? "text-amber-400 font-semibold" : "text-slate-200"}>{value}</span>
    </div>
  );
}
