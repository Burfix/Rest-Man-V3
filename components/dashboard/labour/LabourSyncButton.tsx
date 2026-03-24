/**
 * components/dashboard/labour/LabourSyncButton.tsx
 *
 * Triggers labour sync via the API route.
 */
"use client";

import { cn } from "@/lib/utils";

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
  async function handleSync() {
    if (syncing) return;
    onSync(true);
    try {
      await fetch("/api/micros/labour-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      // Reload page to show fresh data
      window.location.reload();
    } catch {
      onSync(false);
    }
  }

  const label = mode === "full" ? "Full Sync" : "Sync Now";

  return (
    <button
      onClick={handleSync}
      disabled={syncing}
      className={cn(
        "rounded-md text-xs font-medium transition-colors disabled:opacity-50",
        compact
          ? "px-2.5 py-1"
          : "px-3 py-1.5",
        mode === "full"
          ? "bg-stone-200 text-stone-700 hover:bg-stone-300 dark:bg-stone-700 dark:text-stone-300 dark:hover:bg-stone-600"
          : "bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600",
      )}
    >
      {syncing ? "Syncing…" : label}
    </button>
  );
}
