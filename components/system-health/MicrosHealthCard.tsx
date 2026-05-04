"use client";

import { useState } from "react";
import type { MicrosHealth } from "@/lib/system-health/types";

interface MicrosHealthCardProps {
  micros: MicrosHealth;
}

function formatTs(iso: string | null): string {
  if (!iso) return "Never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 60)  return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString("en-ZA");
}

interface SyncActionButtonProps {
  label: string;
  jobType: string;
}

function SyncActionButton({ label, jobType }: SyncActionButtonProps) {
  const [state, setState] = useState<"idle" | "loading" | "success" | "error">("idle");

  async function handleClick() {
    setState("loading");
    try {
      const res = await fetch("/api/system-health/jobs/run", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ jobType }),
      });
      if (!res.ok) throw new Error("Request failed");
      setState("success");
      setTimeout(() => setState("idle"), 3000);
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 3000);
    }
  }

  const labels = { idle: label, loading: "Queuing…", success: "Queued", error: "Failed" };
  const colors = {
    idle:    "bg-zinc-800 dark:bg-zinc-700 hover:bg-zinc-700 dark:hover:bg-zinc-600 text-zinc-100",
    loading: "bg-zinc-600 text-zinc-400 cursor-not-allowed",
    success: "bg-emerald-700 text-emerald-100",
    error:   "bg-red-700 text-red-100",
  };

  return (
    <button
      onClick={handleClick}
      disabled={state === "loading"}
      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${colors[state]}`}
    >
      {labels[state]}
    </button>
  );
}

export default function MicrosHealthCard({ micros }: MicrosHealthCardProps) {
  const statusColor = micros.connected
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-red-600 dark:text-red-400";

  const rows = [
    { label: "Connection",      value: micros.connected ? "Connected" : "Not connected" },
    { label: "Location ref",    value: micros.locationRef ?? "—" },
    { label: "Server URL",      value: micros.serverUrl ? new URL(micros.serverUrl).hostname : "—" },
    { label: "Last sales sync", value: formatTs(micros.lastSalesSync) },
    { label: "Last labour sync", value: formatTs(micros.lastLabourSync) },
    { label: "Last inv. sync",  value: formatTs(micros.lastInventorySync) },
  ];

  return (
    <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
      <div className="border-b border-zinc-200 dark:border-zinc-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              MICROS Integration Health
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              POS connection status and last sync timestamps.
            </p>
          </div>
          <span className={`text-xs font-semibold ${statusColor}`}>
            {micros.connected ? "● Connected" : "● Disconnected"}
          </span>
        </div>
      </div>

      <div className="px-6 py-4 space-y-3">
        {rows.map(row => (
          <div key={row.label} className="flex items-center justify-between text-sm">
            <span className="text-zinc-500 dark:text-zinc-400">{row.label}</span>
            <span className="font-mono text-xs text-zinc-700 dark:text-zinc-300 max-w-[60%] text-right truncate">
              {row.value}
            </span>
          </div>
        ))}

        {micros.lastError && (
          <div className="mt-3 rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/20 px-3 py-2">
            <p className="text-xs font-medium text-red-700 dark:text-red-400">Last error</p>
            <p className="mt-0.5 text-xs text-red-600 dark:text-red-400 font-mono break-all">
              {micros.lastError}
            </p>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="border-t border-zinc-100 dark:border-zinc-800 px-6 py-4">
        <p className="mb-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">
          Manual Sync
        </p>
        <div className="flex flex-wrap gap-2">
          <SyncActionButton label="Sync Sales"     jobType="sales_sync" />
          <SyncActionButton label="Sync Labour"    jobType="labour_sync" />
          <SyncActionButton label="Sync Inventory" jobType="inventory_sync" />
        </div>
        <p className="mt-2 text-xs text-zinc-400">
          Jobs are queued and run within 3 minutes via the scheduler.
        </p>
      </div>
    </section>
  );
}
