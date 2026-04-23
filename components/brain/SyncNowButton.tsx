"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const TRADING_START_HOUR = 8;
const TRADING_END_HOUR = 23;

function isDuringTradingHours(): boolean {
  const h = new Date().getHours();
  return h >= TRADING_START_HOUR && h < TRADING_END_HOUR;
}

export default function SyncNowButton() {
  const router = useRouter();
  const [inflight, setInflight] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  async function handleSync() {
    if (inflight) return;
    setInflight(true);
    setToast(null);
    try {
      const [salesRes, labourRes] = await Promise.allSettled([
        fetch("/api/micros/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sync_type: "intraday_sales", mode: "delta" }),
        }).then((r) => r.json()),
        fetch("/api/micros/labour-sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sync_type: "labour", mode: "delta" }),
        }).then((r) => r.json()),
      ]);

      const anyEmpty =
        (salesRes.status === "fulfilled" && salesRes.value?.outcome === "empty") ||
        (labourRes.status === "fulfilled" && labourRes.value?.outcome === "empty");

      if (anyEmpty && isDuringTradingHours()) {
        setToast("Sync returned no new data — POS may not have posted yet.");
        setTimeout(() => setToast(null), 6000);
      }

      router.refresh();
    } finally {
      setInflight(false);
    }
  }

  return (
    <div className="relative w-fit">
      <button
        onClick={handleSync}
        disabled={inflight}
        className="text-[9px] font-mono font-semibold uppercase tracking-[0.15em] text-stone-600 dark:text-stone-500 border border-[#e2e2e0] dark:border-[#2a2a2a] px-2 py-0.5 hover:text-[#0a0a0a] dark:hover:text-stone-300 hover:border-stone-400 dark:hover:border-stone-600 transition-colors w-fit disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {inflight ? "SYNCING…" : "SYNC NOW"}
      </button>
      {toast && (
        <div className="absolute top-full mt-1 left-0 z-50 whitespace-nowrap rounded bg-amber-100 dark:bg-amber-900/60 border border-amber-300 dark:border-amber-700 px-2 py-1 text-[9px] font-mono text-amber-800 dark:text-amber-200">
          {toast}
        </div>
      )}
    </div>
  );
}
