/**
 * components/dashboard/labour/LabourSyncButton.tsx
 *
 * "Sync Now" triggers a delta sync immediately.
 * "Backfill…" opens a date-picker dialog to enqueue a historical backfill.
 * The word "Full Sync" must never appear in this UI.
 */
"use client";

import { cn } from "@/lib/utils";
import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  syncing: boolean;
  onSync: (syncing: boolean) => void;
  mode: "full" | "delta";
  compact?: boolean;
}

export default function LabourSyncButton({
  syncing,
  onSync,
  mode,
  compact,
}: Props) {
  const router = useRouter();
  const [showBackfill, setShowBackfill] = useState(false);
  const [backfillDate, setBackfillDate] = useState(
    () => new Date().toISOString().slice(0, 10),
  );

  async function handleDeltaSync() {
    if (syncing) return;
    onSync(true);
    try {
      await fetch("/api/micros/labour-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sync_type: "labour", mode: "delta" }),
      });
      router.refresh();
    } finally {
      onSync(false);
    }
  }

  async function handleBackfill() {
    if (syncing) return;
    setShowBackfill(false);
    onSync(true);
    try {
      await fetch("/api/micros/labour-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sync_type: "labour",
          mode: "backfill",
          business_date: backfillDate,
        }),
      });
      router.refresh();
    } finally {
      onSync(false);
    }
  }

  if (mode === "delta") {
    return (
      <button
        onClick={handleDeltaSync}
        disabled={syncing}
        className={cn(
          "rounded-md text-xs font-medium transition-colors disabled:opacity-50",
          compact ? "px-2.5 py-1" : "px-3 py-1.5",
          "bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600",
        )}
      >
        {syncing ? "Syncing…" : "Sync Now"}
      </button>
    );
  }

  // mode === "full" → shown as "Backfill…" with date picker dialog
  return (
    <>
      <button
        onClick={() => setShowBackfill(true)}
        disabled={syncing}
        className={cn(
          "rounded-md text-xs font-medium transition-colors disabled:opacity-50",
          compact ? "px-2.5 py-1" : "px-3 py-1.5",
          "bg-stone-200 text-stone-700 hover:bg-stone-300 dark:bg-stone-700 dark:text-stone-300 dark:hover:bg-stone-600",
        )}
      >
        {syncing ? "Syncing…" : "Backfill…"}
      </button>

      {showBackfill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 p-6 shadow-xl w-80 space-y-4">
            <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-200">
              Backfill Labour Data
            </h3>
            <div className="space-y-1">
              <label className="text-xs text-stone-500 dark:text-stone-400">
                Business Date
              </label>
              <input
                type="date"
                value={backfillDate}
                onChange={(e) => setBackfillDate(e.target.value)}
                className="w-full rounded border border-stone-300 dark:border-stone-600 bg-transparent px-2 py-1 text-sm text-stone-800 dark:text-stone-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowBackfill(false)}
                className="rounded px-3 py-1.5 text-xs text-stone-600 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800"
              >
                Cancel
              </button>
              <button
                onClick={handleBackfill}
                className="rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700"
              >
                Run Backfill
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
