/**
 * components/dashboard/labour/LabourDashboardClient.tsx
 *
 * Client component for the labour dashboard. Renders KPI cards,
 * alert badges, role table, category chart, and CSV upload.
 */
"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { LabourDashboardSummary } from "@/types/labour";
import LabourKpiCards from "./LabourKpiCards";
import LabourAlerts from "./LabourAlerts";
import LabourByRoleTable from "./LabourByRoleTable";
import LabourByCategoryChart from "./LabourByCategoryChart";
import LabourCsvUpload from "./LabourCsvUpload";
import LabourSyncButton from "./LabourSyncButton";

interface Props {
  summary: LabourDashboardSummary | null;
  loadError: string | null;
  useMock: boolean;
}

export default function LabourDashboardClient({
  summary,
  loadError,
  useMock,
}: Props) {
  const [syncing, setSyncing] = useState(false);

  // ── Error state ──────────────────────────────────────────────────
  if (loadError && !summary) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-800 p-4">
          <p className="text-sm font-medium text-red-700 dark:text-red-400">
            Failed to load labour data
          </p>
          <p className="mt-1 text-xs text-red-600 dark:text-red-500">{loadError}</p>
        </div>
        <LabourCsvUpload />
      </div>
    );
  }

  // ── Empty state ──────────────────────────────────────────────────
  if (!summary) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-900 p-8 text-center">
          <p className="text-lg font-semibold text-stone-700 dark:text-stone-300">
            No Labour Data Yet
          </p>
          <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
            Connect Oracle MICROS or upload a CSV to get started.
          </p>
          <div className="mt-4 flex justify-center gap-3">
            <LabourSyncButton syncing={syncing} onSync={setSyncing} mode="full" />
          </div>
        </div>
        <LabourCsvUpload />
      </div>
    );
  }

  // ── Data loaded ──────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Stale data warning */}
      {summary.isStale && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-4 py-2.5 flex items-center justify-between">
          <p className="text-sm text-amber-700 dark:text-amber-400">
            Labour data may be stale — last synced{" "}
            {summary.lastSyncAt
              ? new Date(summary.lastSyncAt).toLocaleTimeString()
              : "never"}
          </p>
          <LabourSyncButton syncing={syncing} onSync={setSyncing} mode="delta" compact />
        </div>
      )}

      {useMock && (
        <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 px-4 py-2 text-xs text-blue-700 dark:text-blue-400">
          Showing mock data for development
        </div>
      )}

      {/* Alerts */}
      <LabourAlerts alerts={summary.alerts} />

      {/* KPI Cards */}
      <LabourKpiCards summary={summary} />

      {/* Sync controls */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-stone-500 dark:text-stone-500">
          {summary.lastSyncAt
            ? `Last synced: ${new Date(summary.lastSyncAt).toLocaleString()}`
            : "Not yet synced"}
        </p>
        <div className="flex gap-2">
          <LabourSyncButton syncing={syncing} onSync={setSyncing} mode="delta" />
          <LabourSyncButton syncing={syncing} onSync={setSyncing} mode="full" />
        </div>
      </div>

      {/* Two-column: Role table + Category chart */}
      <div className="grid gap-6 lg:grid-cols-2">
        <LabourByRoleTable roles={summary.byRole} />
        <LabourByCategoryChart categories={summary.byCategory} totalPay={summary.totalLabourCost} />
      </div>

      {/* CSV upload fallback */}
      <LabourCsvUpload />
    </div>
  );
}
