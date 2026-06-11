"use client";

import { useState } from "react";

export default function ScoreBreakdownSyncButton({ siteId }: { siteId: string }) {
  const [phase, setPhase] = useState<"idle" | "syncing" | "done" | "error">("idle");

  async function handleSync() {
    if (phase !== "idle") return;
    setPhase("syncing");
    try {
      const res = await fetch("/api/command-center/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId }),
      });
      const data = await res.json();
      setPhase(data?.ok === false ? "error" : "done");
    } catch {
      setPhase("error");
    }
    setTimeout(() => setPhase("idle"), 2500);
  }

  const label =
    phase === "syncing" ? "SYNCING…" :
    phase === "done"    ? "SYNCED ✓" :
    phase === "error"   ? "FAILED"   :
    "SYNC NOW";

  return (
    <button
      onClick={handleSync}
      disabled={phase === "syncing"}
      className="text-[9px] font-mono font-semibold uppercase tracking-[0.15em] text-stone-600 dark:text-stone-500 border border-[#e2e2e0] dark:border-[#2a2a2a] px-2 py-0.5 hover:text-[#0a0a0a] dark:hover:text-stone-300 hover:border-stone-400 dark:hover:border-stone-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {label}
    </button>
  );
}
