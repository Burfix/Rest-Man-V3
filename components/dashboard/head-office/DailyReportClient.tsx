"use client";

/**
 * DailyReportClient
 *
 * Daily operations report viewer for Head Office.
 * Fetches today's daily ops data + AI narrative and renders:
 *   - Group summary tiles
 *   - Per-store completion breakdown
 *   - AI-generated narrative report
 *   - Export controls
 */

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────────

interface StoreSummary {
  total: number;
  completed: number;
  in_progress: number;
  blocked: number;
  escalated: number;
  missed: number;
  not_started: number;
}

interface StoreTask {
  action: string;
  status: string;
  priority: string;
  department: string;
  due_time: string | null;
  started_at: string | null;
  completed_at: string | null;
  duration_minutes: number | null;
  started_by: string | null;
  start_comment: string | null;
  completion_comment: string | null;
  blocker_reason: string | null;
  escalated_to: string | null;
  sla: string | null;
}

interface StoreData {
  store: string;
  tasks: StoreTask[];
  summary: StoreSummary;
}

interface DailyReport {
  date: string;
  groupSummary: {
    date: string;
    stores_reporting: number;
    total_tasks: number;
    completed: number;
    in_progress: number;
    blocked: number;
    escalated: number;
    missed: number;
    not_started: number;
  };
  stores: StoreData[];
  narrative: string;
  generatedAt: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function statusColor(status: string): string {
  switch (status) {
    case "completed":
      return "text-emerald-400";
    case "started":
    case "in_progress":
      return "text-blue-400";
    case "blocked":
    case "delayed":
      return "text-red-400";
    case "escalated":
      return "text-amber-400";
    case "missed":
      return "text-red-500";
    default:
      return "text-stone-500";
  }
}

function statusBadge(status: string): string {
  switch (status) {
    case "completed":
      return "bg-emerald-950/60 text-emerald-300 border-emerald-800/40";
    case "started":
    case "in_progress":
      return "bg-blue-950/60 text-blue-300 border-blue-800/40";
    case "blocked":
    case "delayed":
      return "bg-red-950/60 text-red-300 border-red-800/40";
    case "escalated":
      return "bg-amber-950/60 text-amber-300 border-amber-800/40";
    case "missed":
      return "bg-red-950/80 text-red-200 border-red-800/50";
    default:
      return "bg-stone-800 text-stone-400 border-stone-700";
  }
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function DailyReportClient() {
  const [report, setReport] = useState<DailyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedStore, setExpandedStore] = useState<string | null>(null);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/reports/daily-ops", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Failed to generate report");
      setReport(data as DailyReport);
    } catch (e: any) {
      setError(e.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const handleExportJSON = () => {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `daily-ops-report-${report.date}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Loading / Error ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="animate-spin h-8 w-8 border-2 border-stone-400 border-t-transparent rounded-full" />
        <p className="ml-3 text-sm text-stone-400">Generating daily report…</p>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-3">
        <p className="text-sm text-red-400">{error ?? "No report data"}</p>
        <button
          onClick={fetchReport}
          className="text-xs bg-stone-800 hover:bg-stone-700 text-white px-4 py-2 rounded-lg transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  const g = report.groupSummary;
  const completionRate = g.total_tasks > 0 ? Math.round((g.completed / g.total_tasks) * 100) : 0;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-stone-100">
            Daily Operations Report — {report.date}
          </h1>
          <p className="text-xs text-stone-400 mt-0.5">
            {g.stores_reporting} store{g.stores_reporting !== 1 ? "s" : ""} reporting
            {" · "}Generated {new Date(report.generatedAt).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchReport}
            className="text-xs bg-stone-800 hover:bg-stone-700 text-stone-200 px-3 py-1.5 rounded-lg transition-colors"
          >
            ↻ Refresh
          </button>
          <button
            onClick={handleExportJSON}
            className="text-xs bg-stone-800 hover:bg-stone-700 text-stone-200 px-3 py-1.5 rounded-lg transition-colors"
          >
            ⬇ Export JSON
          </button>
        </div>
      </div>

      {/* Group Summary Tiles */}
      <section className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <Tile label="Completion" value={`${completionRate}%`} valueClass={completionRate >= 80 ? "text-emerald-400" : completionRate >= 50 ? "text-amber-400" : "text-red-400"} />
        <Tile label="Total Tasks" value={String(g.total_tasks)} />
        <Tile label="Completed" value={String(g.completed)} valueClass="text-emerald-400" />
        <Tile label="In Progress" value={String(g.in_progress)} valueClass="text-blue-400" />
        <Tile label="Blocked" value={String(g.blocked)} valueClass={g.blocked > 0 ? "text-red-400" : ""} />
        <Tile label="Escalated" value={String(g.escalated)} valueClass={g.escalated > 0 ? "text-amber-400" : ""} />
        <Tile label="Missed" value={String(g.missed)} valueClass={g.missed > 0 ? "text-red-500" : ""} />
      </section>

      {/* AI Narrative */}
      {report.narrative && (
        <Section title="Report Narrative">
          <div className="prose prose-invert prose-sm max-w-none text-stone-300 leading-relaxed whitespace-pre-wrap">
            {report.narrative}
          </div>
        </Section>
      )}

      {/* Store Breakdown */}
      <Section title="Store Breakdown">
        <div className="space-y-2">
          {report.stores.map((store) => {
            const rate = store.summary.total > 0
              ? Math.round((store.summary.completed / store.summary.total) * 100)
              : 0;
            const isExpanded = expandedStore === store.store;
            const hasIssues = store.summary.blocked > 0 || store.summary.escalated > 0 || store.summary.missed > 0;

            return (
              <div key={store.store} className="rounded-lg border border-stone-800 overflow-hidden">
                {/* Store header row */}
                <button
                  onClick={() => setExpandedStore(isExpanded ? null : store.store)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-stone-800/40 transition-colors text-left"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-semibold text-stone-200">{store.store}</span>
                    {hasIssues && <span className="h-1.5 w-1.5 rounded-full bg-red-500" />}
                  </div>
                  <div className="flex items-center gap-4 text-[11px]">
                    <span className={cn("font-bold", rate >= 80 ? "text-emerald-400" : rate >= 50 ? "text-amber-400" : "text-red-400")}>
                      {rate}%
                    </span>
                    <span className="text-stone-500">
                      {store.summary.completed}/{store.summary.total}
                    </span>
                    {store.summary.blocked > 0 && <span className="text-red-400">{store.summary.blocked} blocked</span>}
                    {store.summary.escalated > 0 && <span className="text-amber-400">{store.summary.escalated} escalated</span>}
                    {store.summary.missed > 0 && <span className="text-red-500">{store.summary.missed} missed</span>}
                    <span className="text-stone-600">{isExpanded ? "▲" : "▼"}</span>
                  </div>
                </button>

                {/* Expanded task list */}
                {isExpanded && (
                  <div className="border-t border-stone-800 bg-stone-900/50">
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-stone-800/50 text-stone-500">
                            <th className="px-4 py-2 text-left font-semibold text-[11px] uppercase tracking-wide">Task</th>
                            <th className="px-3 py-2 text-left font-semibold text-[11px] uppercase tracking-wide">Status</th>
                            <th className="px-3 py-2 text-left font-semibold text-[11px] uppercase tracking-wide">Executed By</th>
                            <th className="px-3 py-2 text-left font-semibold text-[11px] uppercase tracking-wide">Due</th>
                            <th className="px-3 py-2 text-right font-semibold text-[11px] uppercase tracking-wide">Duration</th>
                            <th className="px-3 py-2 text-left font-semibold text-[11px] uppercase tracking-wide">Notes</th>
                          </tr>
                        </thead>
                        <tbody>
                          {store.tasks.map((task, i) => (
                            <tr key={i} className="border-b border-stone-800/30">
                              <td className="px-4 py-2 text-stone-200 font-medium">{task.action}</td>
                              <td className="px-3 py-2">
                                <span className={cn("text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border", statusBadge(task.status))}>
                                  {task.status.replace("_", " ")}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-stone-400">{task.started_by ?? "—"}</td>
                              <td className="px-3 py-2 text-stone-400">{task.due_time ?? "—"}</td>
                              <td className="px-3 py-2 text-right text-stone-400">
                                {task.duration_minutes != null ? `${task.duration_minutes}m` : "—"}
                              </td>
                              <td className="px-3 py-2 text-stone-500 max-w-[200px] truncate">
                                {task.blocker_reason
                                  ? <span className="text-red-400">Blocked: {task.blocker_reason}</span>
                                  : task.completion_comment ?? task.start_comment ?? "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Section>
    </div>
  );
}

// ── Subcomponents ────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-stone-800 bg-stone-900 overflow-hidden">
      <div className="border-b border-stone-800 px-5 py-3">
        <h2 className="text-xs font-bold uppercase tracking-widest text-stone-300">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function Tile({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="bg-stone-800/60 rounded-lg px-3.5 py-3">
      <div className="text-[11px] text-stone-400">{label}</div>
      <div className={cn("text-lg font-bold text-stone-100 mt-0.5", valueClass)}>{value}</div>
    </div>
  );
}
