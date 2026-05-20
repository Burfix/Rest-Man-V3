/**
 * MicrosSyncLogsDrawer — slide-in panel showing recent sync logs for a connection.
 */
"use client";

import React, { useEffect, useState } from "react";

interface SyncLog {
  id: string;
  created_at: string;
  sync_type: string;
  business_date: string;
  status: string;
  duration_ms: number | null;
  sales_records: number | null;
  labour_records: number | null;
  error_message: string | null;
}

interface Props {
  connectionId: string;
  siteName: string;
  onClose: () => void;
}

const STATUS_COLOR: Record<string, string> = {
  success: "text-emerald-400",
  partial: "text-amber-400",
  error:   "text-red-400",
};

export default function MicrosSyncLogsDrawer({ connectionId, siteName, onClose }: Props) {
  const [logs,    setLogs]    = useState<SyncLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/system-health/micros/logs?connectionId=${encodeURIComponent(connectionId)}&limit=50`)
      .then((r) => r.json())
      .then((j) => setLogs(j.logs ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [connectionId]);

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/60 z-40" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full w-full max-w-xl bg-slate-900 border-l border-slate-700 z-50 flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <div>
            <h2 className="text-slate-100 font-semibold">Sync Logs</h2>
            <p className="text-xs text-slate-400">{siteName}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-100 text-xl leading-none">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading && <p className="text-slate-400 text-sm">Loading…</p>}
          {error   && <p className="text-red-400 text-sm">{error}</p>}
          {!loading && !error && logs.length === 0 && (
            <p className="text-slate-500 text-sm">No logs yet.</p>
          )}
          {logs.map((log) => (
            <div key={log.id} className="border-b border-slate-800 py-2.5">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-semibold uppercase ${STATUS_COLOR[log.status] ?? "text-slate-400"}`}>
                    {log.status}
                  </span>
                  <span className="text-xs text-slate-300">{log.business_date}</span>
                  <span className="text-xs text-slate-500">{log.sync_type}</span>
                </div>
                <span className="text-xs text-slate-500">
                  {new Date(log.created_at).toLocaleString("en-ZA", { dateStyle: "short", timeStyle: "short" })}
                </span>
              </div>
              <div className="flex gap-4 mt-1 text-xs text-slate-400">
                {log.sales_records  != null && <span>Sales: {log.sales_records}</span>}
                {log.labour_records != null && <span>Labour: {log.labour_records}</span>}
                {log.duration_ms    != null && <span>{(log.duration_ms / 1000).toFixed(1)}s</span>}
              </div>
              {log.error_message && (
                <p className="mt-1 text-xs text-red-400 bg-red-950/30 rounded p-1.5">{log.error_message}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
