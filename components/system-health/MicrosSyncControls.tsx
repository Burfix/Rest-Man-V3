/**
 * MicrosSyncControls — manual action buttons for a single site / location.
 * Fires POST /api/system-health/micros/sync or /api/system-health/micros/backfill.
 */
"use client";

import React, { useState } from "react";

interface Props {
  locationKey: string;
  connectionId: string;
  onLogsClick: () => void;
}

type ActionState = "idle" | "running" | "done" | "error";

export default function MicrosSyncControls({ locationKey, connectionId, onLogsClick }: Props) {
  const [state, setState] = useState<ActionState>("idle");
  const [msg,   setMsg]   = useState<string>("");
  const [backfillOpen, setBackfillOpen] = useState(false);
  const [fromDate, setFromDate]         = useState("");
  const [toDate,   setToDate]           = useState("");

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
  const minus7 = new Date(Date.now() - 7 * 86400000).toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });

  async function runSync(syncType: string) {
    setState("running");
    setMsg("");
    try {
      const r = await fetch("/api/system-health/micros/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationKey, syncType }),
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error ?? r.statusText);
      const records = (json.result?.salesChecks ?? 0) + (json.result?.labourTimecards ?? 0);
      setMsg(`✓ Synced ${records} records in ${json.duration}ms`);
      setState("done");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Unknown error");
      setState("error");
    }
  }

  async function runBackfill() {
    if (!fromDate || !toDate) return;
    setState("running");
    setMsg("");
    try {
      const r = await fetch("/api/system-health/micros/backfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationKey, fromDate, toDate }),
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error ?? r.statusText);
      setMsg(`✓ Backfill: ${json.ok} succeeded, ${json.failed} failed`);
      setState("done");
      setBackfillOpen(false);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Unknown error");
      setState("error");
    }
  }

  const running = state === "running";

  return (
    <div className="mt-3 flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        <Btn onClick={() => runSync("full")}         disabled={running} label="Sync Now"      variant="primary" />
        <Btn onClick={() => runSync("sales_only")}   disabled={running} label="Sales Only"    variant="secondary" />
        <Btn onClick={() => runSync("labour_only")}  disabled={running} label="Labour Only"   variant="secondary" />
        <Btn onClick={() => { setFromDate(minus7); setToDate(today); setBackfillOpen(true); }}
             disabled={running} label="Backfill 7d" variant="secondary" />
        <Btn onClick={() => setBackfillOpen(true)}   disabled={running} label="Backfill Range" variant="secondary" />
        <Btn onClick={onLogsClick}                   disabled={running} label="View Logs"      variant="ghost" />
      </div>

      {backfillOpen && (
        <div className="flex flex-wrap items-center gap-2 bg-slate-800/50 rounded-lg p-2.5 text-xs">
          <label className="text-slate-400">From</label>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
            className="bg-slate-700 text-slate-200 rounded px-2 py-1 text-xs" />
          <label className="text-slate-400">To</label>
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
            className="bg-slate-700 text-slate-200 rounded px-2 py-1 text-xs" />
          <button
            onClick={runBackfill} disabled={running || !fromDate || !toDate}
            className="bg-blue-600 hover:bg-blue-500 text-white rounded px-3 py-1 text-xs font-medium disabled:opacity-40"
          >
            {running ? "Running…" : "Run"}
          </button>
          <button onClick={() => setBackfillOpen(false)} className="text-slate-400 hover:text-slate-200">✕</button>
        </div>
      )}

      {msg && (
        <p className={`text-xs ${state === "error" ? "text-red-400" : "text-emerald-400"}`}>{msg}</p>
      )}
    </div>
  );
}

function Btn({ onClick, disabled, label, variant }: {
  onClick: () => void;
  disabled: boolean;
  label: string;
  variant: "primary" | "secondary" | "ghost";
}) {
  const cls = {
    primary:   "bg-blue-600 hover:bg-blue-500 text-white",
    secondary: "bg-slate-700 hover:bg-slate-600 text-slate-200",
    ghost:     "bg-transparent hover:bg-slate-700 text-slate-400 border border-slate-700",
  }[variant];

  return (
    <button
      onClick={onClick} disabled={disabled}
      className={`rounded px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-40 ${cls}`}
    >
      {label}
    </button>
  );
}
