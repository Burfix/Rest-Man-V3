/**
 * components/dashboard/labour/LabourDashboardClient.tsx
 *
 * Client component for the labour dashboard. Renders KPI cards,
 * alert badges, role table, category chart, and CSV upload.
 */
"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import type { LabourDashboardSummary } from "@/types/labour";
import type { DataProvenance } from "@/lib/types/data-provenance";
import LabourKpiCards from "./LabourKpiCards";
import LabourAlerts from "./LabourAlerts";
import LabourByRoleTable from "./LabourByRoleTable";
import LabourByCategoryChart from "./LabourByCategoryChart";
import LabourCsvUpload from "./LabourCsvUpload";
import LabourSyncButton from "./LabourSyncButton";

interface Props {
  summary: LabourDashboardSummary | null;
  loadError: string | null;
  /** Full data provenance — source, freshness, locRef, siteId. */
  provenance: DataProvenance;
}

export default function LabourDashboardClient({
  summary,
  loadError,
  provenance,
}: Props) {
  const { source, fetchedAt, isStale: provenanceStale, locRef, siteId } = provenance;
  const useMock      = source === "mock";
  const noConnection = source === "no_connection";
  const [syncing, setSyncing] = useState(false);
  const [syncTimeDisplay, setSyncTimeDisplay] = useState<{ stale: string; full: string } | null>(null);
  const resolvedSyncAt = summary?.lastSyncAt ?? fetchedAt;
  useEffect(() => {
    if (resolvedSyncAt) {
      setSyncTimeDisplay({
        stale: new Date(resolvedSyncAt).toLocaleTimeString(),
        full: new Date(resolvedSyncAt).toLocaleString(),
      });
    }
  }, [resolvedSyncAt]);

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

  // ── No MICROS connection for this site ───────────────────────────
  if (noConnection) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-900 p-8 text-center">
          <p className="text-lg font-semibold text-stone-700 dark:text-stone-300">
            No POS Connection for This Site
          </p>
          <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
            This site has no Oracle MICROS connection configured. Contact your administrator
            to set up MICROS integration, or upload labour data as a CSV below.
          </p>
          <p className="mt-2 text-xs text-stone-400 dark:text-stone-600 font-mono">
            site: {provenance.siteId}
          </p>
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
      {/* Stale data warning — driven by authoritative summary.isStale flag */}
      {summary.isStale && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-4 py-2.5 flex items-center justify-between">
          <p className="text-sm text-amber-700 dark:text-amber-400">
            Labour data may be stale — last synced{" "}
            {resolvedSyncAt ? (syncTimeDisplay?.stale ?? "…") : "never"}
          </p>
          <LabourSyncButton syncing={syncing} onSync={setSyncing} mode="delta" compact />
        </div>
      )}

      {/* Data provenance banner */}
      {source === "mock" && (
        <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 px-4 py-2 text-xs text-blue-700 dark:text-blue-400">
          Showing mock data — development only
        </div>
      )}
      {source === "stale_fallback" && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-4 py-2 text-xs text-amber-700 dark:text-amber-400">
          Stale fallback{provenance.reason ? ` — ${provenance.reason}` : ""}
        </div>
      )}
      {source === "manual_upload" && (
        <div className="flex items-center gap-2 text-xs text-stone-400 dark:text-stone-600">
          <span className="inline-flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-stone-400" />
            Manual upload
          </span>
          {fetchedAt && <><span>·</span><span className="font-mono">{new Date(fetchedAt).toLocaleString()}</span></>}
        </div>
      )}
      {(source === "live_micros" || source === "cached") && (
        <div className="flex items-center gap-2 text-xs text-stone-400 dark:text-stone-600">
          <span className="inline-flex items-center gap-1">
            <span className={cn(
              "h-1.5 w-1.5 rounded-full",
              provenanceStale ? "bg-amber-400" : "bg-emerald-500"
            )} />
            {source === "cached" ? "Cached" : "Live MICROS"}
          </span>
          {(locRef ?? summary.locRef) && (
            <><span>·</span><span className="font-mono">loc: {locRef ?? summary.locRef}</span></>
          )}
          <span>·</span>
          <span className="font-mono">site: {siteId.slice(-8)}</span>
          {fetchedAt && (
            <><span>·</span><span title={new Date(fetchedAt).toLocaleString()}>
              {provenanceStale ? "stale" : "synced"} {syncTimeDisplay?.stale ?? "…"}
            </span></>
          )}
        </div>
      )}

      {/* Alerts */}
      <LabourAlerts alerts={summary.alerts} />

      {/* KPI Cards */}
      <LabourKpiCards summary={summary} />

      {/* Sync controls */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-stone-500 dark:text-stone-500">
          {resolvedSyncAt
            ? `Last synced: ${syncTimeDisplay?.full ?? "…"}`
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
