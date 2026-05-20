/**
 * SalesSyncButton — Trigger MICROS POS sync + auto-refresh every 15 min.
 *
 * Client component rendered inside the live-data strip or
 * manual-upload prompt. Calls POST /api/micros/sync then
 * reloads the page to pick up fresh data.
 *
 * Also sets a 15-minute interval to auto-sync in the background
 * while the dashboard tab is open.
 */

"use client";

import { useEffect, useCallback, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

const SYNC_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

interface Props {
  /** Whether MICROS is configured and enabled */
  microsConfigured: boolean;
  /** Compact mode for inline display */
  compact?: boolean;
}

export default function SalesSyncButton({ microsConfigured, compact }: Props) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [lastResult, setLastResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const triggerSync = useCallback(async (silent = false) => {
    if (!microsConfigured) return;
    setSyncing(true);
    if (!silent) setLastResult(null);

    try {
      const res = await fetch("/api/micros/sync", { method: "POST" });
      const body = await res.json().catch(() => ({}));

      if (res.ok) {
        if (!silent) setLastResult({ ok: true, msg: body.message ?? "Synced" });
        router.refresh();
      } else {
        if (!silent) setLastResult({ ok: false, msg: body.message ?? `Sync failed (${res.status})` });
      }
    } catch {
      if (!silent) setLastResult({ ok: false, msg: "Network error" });
    } finally {
      setSyncing(false);
    }
  }, [microsConfigured, router]);

  // Auto-sync every 15 minutes
  useEffect(() => {
    if (!microsConfigured) return;

    intervalRef.current = setInterval(() => {
      triggerSync(true); // silent auto-sync
    }, SYNC_INTERVAL_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [microsConfigured, triggerSync]);

  if (!microsConfigured) return null;

  if (compact) {
    return (
      <>
        <span className="text-stone-500 dark:text-stone-400">·</span>
        <button
          onClick={() => triggerSync(false)}
          disabled={syncing}
          className={cn(
            "text-[11px] font-medium transition-colors",
            syncing
              ? "text-stone-500 dark:text-stone-400 cursor-not-allowed"
              : "text-stone-500 hover:text-stone-800 dark:hover:text-stone-200",
          )}
        >
          {syncing ? "Syncing…" : "↻ Sync"}
        </button>
        {lastResult && (
          <span className={cn(
            "text-[10px]",
            lastResult.ok ? "text-emerald-600" : "text-red-500",
          )}>
            {lastResult.msg}
          </span>
        )}
      </>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => triggerSync(false)}
        disabled={syncing}
        className={cn(
          "rounded px-3 py-1 text-[11px] font-semibold transition-colors",
          syncing
            ? "bg-stone-200 text-stone-500 dark:text-stone-400 cursor-not-allowed"
            : "bg-stone-800 dark:bg-stone-200 text-white dark:text-stone-800 hover:bg-stone-700 dark:hover:bg-stone-300",
        )}
      >
        {syncing ? "Syncing…" : "↻ Sync POS"}
      </button>
      {lastResult && (
        <span className={cn(
          "text-[10px]",
          lastResult.ok ? "text-emerald-600" : "text-red-500",
        )}>
          {lastResult.msg}
        </span>
      )}
    </div>
  );
}
