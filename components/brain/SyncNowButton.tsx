"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import type { CommandCenterSyncResponse } from "@/lib/command-center/types";

type SyncPhase = "idle" | "syncing" | "done" | "error";

type Props = {
  siteId: string;
};

export default function SyncNowButton({ siteId }: Props) {
  const router = useRouter();
  const [phase, setPhase] = useState<SyncPhase>("idle");
  const [toast, setToast] = useState<{ message: string; kind: "ok" | "warn" | "error" } | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  function showToast(message: string, kind: "ok" | "warn" | "error") {
    setToast({ message, kind });
    setTimeout(() => setToast(null), 7000);
  }

  async function handleSync() {
    if (phase !== "idle") return;
    setToast(null);
    setPhase("syncing");

    try {
      const res = await fetch("/api/command-center/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId }),
      });

      const data = await res.json() as CommandCenterSyncResponse;
      setLastSyncedAt(data.syncedAt ?? new Date().toISOString());

      if (!data.state) {
        router.refresh();
      }

      setPhase("done");
      setTimeout(() => setPhase("idle"), 2000);

      if (data.syncStatus === "success") {
        showToast("Synced — all data and scores updated", "ok");
      } else if (data.syncStatus === "partial") {
        showToast(`Partial sync — ${data.warnings.join(", ")}`, "warn");
      } else {
        showToast(`Sync failed — ${data.errors[0] ?? "unknown error"}`, "error");
        setPhase("error");
        setTimeout(() => setPhase("idle"), 3000);
      }
    } catch {
      setPhase("error");
      showToast("Sync failed — network error", "error");
      setTimeout(() => setPhase("idle"), 3000);
      router.refresh();
    }
  }

  const label =
    phase === "syncing" ? "SYNCING…" :
    phase === "done"    ? "SYNCED ✓" :
    phase === "error"   ? "FAILED — RETRY" :
    "SYNC NOW";

  function freshnessLabel(): { text: string; stale: boolean } {
    if (!lastSyncedAt) return { text: "", stale: false };
    const mins = Math.round((Date.now() - new Date(lastSyncedAt).getTime()) / 60_000);
    if (mins < 1) return { text: "Just synced", stale: false };
    if (mins < 15) return { text: `${mins}m ago`, stale: false };
    return { text: `${mins}m ago`, stale: true };
  }

  const freshness = freshnessLabel();

  const toastCls =
    toast?.kind === "error"
      ? "bg-red-100 dark:bg-red-900/60 border-red-300 dark:border-red-700 text-red-800 dark:text-red-200"
      : toast?.kind === "warn"
      ? "bg-amber-100 dark:bg-amber-900/60 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200"
      : "bg-emerald-100 dark:bg-emerald-900/60 border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-200";

  return (
    <div className="relative w-fit">
      <div className="flex items-center gap-2">
        {freshness.text && (
          <div className="flex items-center gap-1">
            <span className={cn("w-1.5 h-1.5 rounded-full", freshness.stale ? "bg-amber-400" : "bg-emerald-400")} />
            <span className="text-[9px] font-mono text-stone-500 dark:text-stone-500">{freshness.text}</span>
          </div>
        )}
        <button
          onClick={handleSync}
          disabled={phase !== "idle"}
          className={cn(
            "text-[9px] font-mono font-semibold uppercase tracking-[0.15em] border px-2 py-0.5 transition-colors w-fit disabled:opacity-50 disabled:cursor-not-allowed",
            phase === "done"
              ? "text-emerald-600 dark:text-emerald-400 border-emerald-300 dark:border-emerald-700"
              : phase === "error"
              ? "text-red-600 dark:text-red-400 border-red-300 dark:border-red-700"
              : "text-stone-600 dark:text-stone-500 border-[#e2e2e0] dark:border-[#2a2a2a] hover:text-[#0a0a0a] dark:hover:text-stone-300 hover:border-stone-400 dark:hover:border-stone-600",
          )}
        >
          {label}
        </button>
      </div>
      {toast && (
        <div className={`absolute top-full mt-1 left-0 z-50 whitespace-nowrap rounded border px-2 py-1 text-[9px] font-mono ${toastCls}`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}
