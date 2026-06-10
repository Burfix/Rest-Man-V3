"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CommandCenterState, CommandCenterSyncResponse } from "@/lib/command-center/types";

type SyncPhase = "idle" | "syncing" | "done" | "error";

type Props = {
  siteId: string;
  freshnessMinutes?: number;
  onStateUpdate?: (state: CommandCenterState) => void;
  onSyncComplete?: (response: CommandCenterSyncResponse) => void;
};

function freshnessLabel(syncedAt: string | null, fallbackMinutes?: number): { text: string; stale: boolean } {
  if (syncedAt) {
    const ts = new Date(syncedAt);
    const mins = Math.max(0, Math.floor((Date.now() - ts.getTime()) / 60000));
    const time = ts.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false });
    return { text: `Synced ${time}`, stale: mins > 15 };
  }

  if (fallbackMinutes == null) {
    return { text: "Status unknown", stale: true };
  }
  if (fallbackMinutes === 0) {
    return { text: "Just synced", stale: false };
  }
  if (fallbackMinutes < 60) {
    return { text: `Synced ${fallbackMinutes}m ago`, stale: fallbackMinutes > 15 };
  }
  const hours = Math.round(fallbackMinutes / 60);
  return { text: `Synced ${hours}h ago`, stale: true };
}

export default function SyncNowButton({ siteId, freshnessMinutes, onStateUpdate, onSyncComplete }: Props) {
  const router = useRouter();
  const [phase, setPhase] = useState<SyncPhase>("idle");
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; kind: "ok" | "warn" | "error" } | null>(null);

  function showToast(message: string, kind: "ok" | "warn" | "error") {
    setToast({ message, kind });
    setTimeout(() => setToast(null), 7000);
  }

  async function handleSync() {
    if (phase !== "idle") return;
    setToast(null);
    setPhase("syncing");

    let payload: CommandCenterSyncResponse | null = null;
    try {
      const response = await fetch("/api/command-center/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId }),
      });

      payload = await response.json() as CommandCenterSyncResponse;
    } catch {
      payload = {
        ok: false,
        syncStatus: "failed",
        syncedAt: new Date().toISOString(),
        siteId,
        modules: {
          sales: { ok: false, message: "Network error" },
          labour: { ok: false, message: "Network error" },
          brain: { ok: false, message: "Network error" },
          state: { ok: false, message: "Network error" },
        },
        warnings: [],
        errors: ["Request failed. Check your network and retry."],
      };
    }

    if (!payload) return;

    setSyncedAt(payload.syncedAt);
    
    // Only update state if sync was successful OR if partial sync didn't lose core revenue/labour data
    const shouldUpdateState = payload.syncStatus === "success" || 
      (payload.syncStatus === "partial" && payload.modules.sales?.ok && payload.modules.labour?.ok);
    
    if (shouldUpdateState && payload.state) {
      onStateUpdate?.(payload.state);
    }
    onSyncComplete?.(payload);
    if (!payload.state && !onSyncComplete) {
      router.refresh();
    }

    if (payload.syncStatus === "success") {
      showToast("Synced — all data and scores updated", "ok");
      setPhase("done");
      setTimeout(() => setPhase("idle"), 2000);
      return;
    }

    if (payload.syncStatus === "partial") {
      const warningText = payload.warnings.length > 0
        ? payload.warnings.join(", ")
        : "one or more modules did not refresh";
      showToast(`Partial sync — ${warningText}`, "warn");
      setPhase("done");
      setTimeout(() => setPhase("idle"), 2000);
      return;
    }

    showToast(`Sync failed — ${payload.errors[0] ?? "unknown error"}`, "error");
    setPhase("error");
  }

  const label =
    phase === "syncing" ? "SYNCING…" :
    phase === "done" ? "SYNCED ✓" :
    phase === "error" ? "FAILED — RETRY" :
    "SYNC NOW";

  const toastCls =
    toast?.kind === "error"
      ? "bg-red-100 dark:bg-red-900/60 border-red-300 dark:border-red-700 text-red-800 dark:text-red-200"
      : toast?.kind === "warn"
      ? "bg-amber-100 dark:bg-amber-900/60 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200"
      : "bg-emerald-100 dark:bg-emerald-900/60 border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-200";

  const freshness = freshnessLabel(syncedAt, freshnessMinutes);

  return (
    <div className="relative w-fit space-y-1">
      <div className="flex items-center gap-1.5">
        <span
          className={
            freshness.stale
              ? "w-2 h-2 rounded-full shrink-0 bg-amber-400"
              : "w-2 h-2 rounded-full shrink-0 bg-emerald-400"
          }
        />
        <span className="text-[10px] font-mono text-stone-500 dark:text-stone-500">{freshness.text}</span>
      </div>

      <button
        onClick={handleSync}
        disabled={phase === "syncing"}
        className="text-[9px] font-mono font-semibold uppercase tracking-[0.15em] text-stone-600 dark:text-stone-500 border border-[#e2e2e0] dark:border-[#2a2a2a] px-2 py-0.5 hover:text-[#0a0a0a] dark:hover:text-stone-300 hover:border-stone-400 dark:hover:border-stone-600 transition-colors w-fit disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {label}
      </button>

      {toast && (
        <div className={`absolute top-full mt-1 left-0 z-50 whitespace-nowrap rounded border px-2 py-1 text-[9px] font-mono ${toastCls}`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}
