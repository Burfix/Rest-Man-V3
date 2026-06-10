"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type SyncPhase = "idle" | "syncing_pos" | "refreshing" | "done" | "error";

type SyncSectionResult = {
  section: "sales" | "labour";
  ok: boolean;
  outcome: "success" | "empty" | "failed" | "error";
  message?: string;
};

function normalise(
  section: "sales" | "labour",
  result: PromiseSettledResult<Record<string, unknown>>,
): SyncSectionResult {
  if (result.status === "rejected") {
    return { section, ok: false, outcome: "error", message: "Network error" };
  }
  const v = result.value;
  if (!v.ok) {
    return {
      section,
      ok: false,
      outcome: "failed",
      message: typeof v.message === "string" ? v.message : "Sync failed",
    };
  }
  if (v.outcome === "empty") return { section, ok: true, outcome: "empty" };
  if (v.outcome === "success") return { section, ok: true, outcome: "success" };
  if (section === "labour") {
    const upserted = typeof v.timecardsUpserted === "number" ? v.timecardsUpserted : null;
    return { section, ok: true, outcome: upserted === 0 ? "empty" : "success" };
  }
  return { section, ok: true, outcome: "success" };
}

function toastMessage(results: SyncSectionResult[], brainOk: boolean): string {
  const failed = results.filter((r) => r.outcome === "failed" || r.outcome === "error");
  const allEmpty = results.every((r) => r.outcome === "empty");
  if (failed.length > 0) {
    const sections = failed.map((r) => r.section).join(" & ");
    const msg = failed[0]?.message ?? "Check MICROS connection";
    return `${sections} sync failed — ${msg}`;
  }
  if (allEmpty) return "No new POS data yet — scores refreshed from existing data";
  if (!brainOk) return "POS data synced — score will refresh on next page load";
  return "Synced — score updated";
}

export default function SyncNowButton() {
  const router = useRouter();
  const [phase, setPhase] = useState<SyncPhase>("idle");
  const [toast, setToast] = useState<{ message: string; kind: "ok" | "warn" | "error" } | null>(null);

  function showToast(message: string, kind: "ok" | "warn" | "error") {
    setToast({ message, kind });
    setTimeout(() => setToast(null), 7000);
  }

  async function handleSync() {
    if (phase !== "idle") return;
    setToast(null);

    setPhase("syncing_pos");
    const [salesSettled, labourSettled] = await Promise.allSettled([
      fetch("/api/micros/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sync_type: "intraday_sales", mode: "delta" }),
      }).then((r) => r.json() as Promise<Record<string, unknown>>),
      fetch("/api/micros/labour-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sync_type: "labour", mode: "delta" }),
      }).then((r) => r.json() as Promise<Record<string, unknown>>),
    ]);

    const results: SyncSectionResult[] = [
      normalise("sales", salesSettled),
      normalise("labour", labourSettled),
    ];

    setPhase("refreshing");
    let brainOk = false;
    try {
      const brainRes = await fetch("/api/brain/invalidate", { method: "POST" });
      const brainJson = await brainRes.json() as Record<string, unknown>;
      brainOk = brainJson.ok === true;
    } catch {
      // non-fatal
    }

    router.refresh();
    setPhase("done");

    const anyHardFailure = results.some((r) => r.outcome === "failed" || r.outcome === "error");
    showToast(toastMessage(results, brainOk), anyHardFailure ? "error" : brainOk ? "ok" : "warn");
    setTimeout(() => setPhase("idle"), 500);
  }

  const label =
    phase === "syncing_pos" ? "SYNCING…" :
    phase === "refreshing"  ? "SCORING…" :
    "SYNC NOW";

  const toastCls =
    toast?.kind === "error"
      ? "bg-red-100 dark:bg-red-900/60 border-red-300 dark:border-red-700 text-red-800 dark:text-red-200"
      : toast?.kind === "warn"
      ? "bg-amber-100 dark:bg-amber-900/60 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200"
      : "bg-emerald-100 dark:bg-emerald-900/60 border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-200";

  return (
    <div className="relative w-fit">
      <button
        onClick={handleSync}
        disabled={phase !== "idle"}
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
