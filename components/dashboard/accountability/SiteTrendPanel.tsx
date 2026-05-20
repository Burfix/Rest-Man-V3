"use client";

import { useEffect, useState, useCallback } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Cell,
} from "recharts";

// ── Types ─────────────────────────────────────────────────────────────────────

type TrendDay = {
  date: string;
  displayDate: string;
  score: number;
  grade: string;
  completionRate: number;
  onTimeRate: number;
  tasksAssigned: number;
  tasksCompleted: number;
};

type TrendData = {
  site: { id: string; name: string };
  trend: TrendDay[];
  summary: {
    avgScore: number;
    bestDay: { date: string; score: number };
    worstDay: { date: string; score: number };
    totalDays: number;
  };
};

type DutyAvg = {
  action_name: string;
  department: string;
  priority: string;
  avg_minutes: number;
  min_minutes: number;
  max_minutes: number;
  total_completions: number;
  late_start_count: number;
  avg_minutes_late: number;
};

type LateDuty = {
  task_date: string;
  action_name: string;
  department: string;
  due_time: string;
  started_at: string;
  minutes_late: number;
  time_to_complete: number;
  site_name: string;
};

type DutyReport = {
  avgByDuty: DutyAvg[];
  lateDuties: LateDuty[];
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function gradeColor(grade: string): string {
  switch (grade) {
    case "A": return "#22c55e";
    case "B": return "#3b82f6";
    case "C": return "#eab308";
    case "D": return "#f97316";
    default:  return "#ef4444";
  }
}

function gradeFromScore(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 65) return "C";
  if (score >= 50) return "D";
  return "F";
}

function gradeBadgeClass(grade: string): string {
  switch (grade) {
    case "A": return "bg-green-950/60 text-green-400 border border-green-900";
    case "B": return "bg-blue-950/60 text-blue-400 border border-blue-900";
    case "C": return "bg-yellow-950/60 text-yellow-400 border border-yellow-900";
    case "D": return "bg-orange-950/60 text-orange-400 border border-orange-900";
    default:  return "bg-red-950/60 text-red-400 border border-red-900";
  }
}

function shortDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-ZA", { day: "2-digit", month: "short" });
}

function formatLate(mins: number): string {
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${mins}m`;
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="grid grid-cols-4 gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-14 bg-[#1a1a1a] rounded-sm" />
        ))}
      </div>
      <div className="h-52 bg-[#1a1a1a] rounded-sm" />
    </div>
  );
}

function DutySkeleton() {
  return (
    <div className="space-y-2 animate-pulse">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-8 bg-[#1a1a1a] rounded-sm" />
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SiteTrendPanel({
  siteId,
  siteName,
  userId,
  userName,
  onClose,
}: {
  siteId: string;
  siteName: string;
  userId: string;
  userName: string;
  onClose: () => void;
}) {
  const [data, setData]         = useState<TrendData | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [dutyReport, setDutyReport]       = useState<DutyReport | null>(null);
  const [dutyLoading, setDutyLoading]     = useState(true);
  const [dutyError, setDutyError]         = useState<string | null>(null);

  // Fetch trend data
  useEffect(() => {
    setLoading(true);
    setError(null);
    setData(null);

    fetch(`/api/accountability/site-trend?siteId=${encodeURIComponent(siteId)}&days=30`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => { setData(d); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [siteId]);

  // Fetch duty report
  useEffect(() => {
    if (!userId) return;
    setDutyLoading(true);
    setDutyError(null);
    setDutyReport(null);

    fetch(`/api/accountability/duty-report?userId=${encodeURIComponent(userId)}&siteId=${encodeURIComponent(siteId)}&days=30`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => { setDutyReport(d); setDutyLoading(false); })
      .catch((e) => { setDutyError(e.message); setDutyLoading(false); });
  }, [userId, siteId]);

  // Escape key to close
  const handleKey = useCallback(
    (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); },
    [onClose],
  );
  useEffect(() => {
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [handleKey]);

  const trend = data?.trend ?? [];
  const summary = data?.summary;
  const avgGrade = summary ? gradeFromScore(summary.avgScore) : "—";

  // Only label every 5th date to avoid crowding
  const xTickFormatter = (label: string, index: number) =>
    index % 5 === 0 ? label : "";

  return (
    <>
      {/* Panel */}
      <div
        className="fixed top-0 right-0 h-full w-full sm:w-[480px] bg-[#0a0a0a] border-l border-[#1a1a1a] z-50 flex flex-col shadow-2xl"
        style={{ animation: "slideInRight 0.2s ease-out" }}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-4 border-b border-[#1a1a1a] shrink-0">
          <div>
            <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-stone-500 mb-0.5">
              GM Drill-Down
            </p>
            <h2 className="text-sm font-semibold text-stone-100 leading-tight">
              {userName}
            </h2>
            <p className="text-[10px] text-stone-500 mt-0.5 font-mono">{siteName} · 30-day performance</p>
          </div>
          <button
            onClick={onClose}
            className="mt-0.5 text-stone-500 hover:text-stone-200 transition-colors text-xl leading-none font-light"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loading && <Skeleton />}

          {error && (
            <div className="bg-red-950/30 border border-red-900 rounded-sm p-3">
              <p className="text-xs text-red-400 font-mono">Error: {error}</p>
            </div>
          )}

          {!loading && !error && data && (
            <>
              {/* Summary row */}
              <div className="grid grid-cols-4 gap-2">
                {/* Avg Score */}
                <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-sm p-3 col-span-1">
                  <p className="text-[8px] font-mono uppercase tracking-widest text-stone-500 mb-1">
                    Avg Score
                  </p>
                  <p
                    className="text-xl font-mono font-bold"
                    style={{ color: gradeColor(avgGrade) }}
                  >
                    {summary?.avgScore ?? "—"}
                  </p>
                  <span
                    className={`mt-1 inline-block text-[8px] font-bold px-1.5 py-0.5 rounded-sm ${gradeBadgeClass(avgGrade)}`}
                  >
                    Grade {avgGrade}
                  </span>
                </div>

                {/* Best Day */}
                <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-sm p-3">
                  <p className="text-[8px] font-mono uppercase tracking-widest text-stone-500 mb-1">
                    Best Day
                  </p>
                  <p className="text-xl font-mono font-bold text-green-400">
                    {summary?.bestDay.score ?? "—"}
                  </p>
                  {summary?.bestDay.date && (
                    <p className="text-[8px] font-mono text-stone-500 mt-0.5">
                      {shortDate(summary.bestDay.date)}
                    </p>
                  )}
                </div>

                {/* Worst Day */}
                <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-sm p-3">
                  <p className="text-[8px] font-mono uppercase tracking-widest text-stone-500 mb-1">
                    Worst Day
                  </p>
                  <p className="text-xl font-mono font-bold text-red-400">
                    {summary?.worstDay.score ?? "—"}
                  </p>
                  {summary?.worstDay.date && (
                    <p className="text-[8px] font-mono text-stone-500 mt-0.5">
                      {shortDate(summary.worstDay.date)}
                    </p>
                  )}
                </div>

                {/* Days tracked */}
                <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-sm p-3">
                  <p className="text-[8px] font-mono uppercase tracking-widest text-stone-500 mb-1">
                    Days
                  </p>
                  <p className="text-xl font-mono font-bold text-stone-300">
                    {summary?.totalDays ?? 0}
                  </p>
                  <p className="text-[8px] font-mono text-stone-500 mt-0.5">tracked</p>
                </div>
              </div>

              {/* Bar chart */}
              {trend.length === 0 ? (
                <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-sm p-6 text-center">
                  <p className="text-xs text-stone-500">No score data for this period.</p>
                </div>
              ) : (
                <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-sm p-4">
                  {/* Legend */}
                  <div className="flex items-center gap-3 mb-3 flex-wrap">
                    {[
                      { color: "#22c55e", label: "A (90+)" },
                      { color: "#3b82f6", label: "B (80+)" },
                      { color: "#eab308", label: "C (65+)" },
                      { color: "#f97316", label: "D (50+)" },
                      { color: "#ef4444", label: "F (<50)" },
                    ].map((l) => (
                      <div key={l.label} className="flex items-center gap-1">
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ backgroundColor: l.color }}
                        />
                        <span className="text-[8px] font-mono text-stone-500">{l.label}</span>
                      </div>
                    ))}
                  </div>

                  <div className="h-52">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={trend}
                        margin={{ top: 4, right: 4, left: -24, bottom: 0 }}
                      >
                        <CartesianGrid
                          strokeDasharray="3 3"
                          vertical={false}
                          stroke="#292524"
                          strokeOpacity={0.4}
                        />
                        <XAxis
                          dataKey="date"
                          tickFormatter={(v, i) => xTickFormatter(shortDate(v), i)}
                          tick={{ fontSize: 9, fill: "#78716c" }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis
                          domain={[0, 100]}
                          ticks={[0, 25, 50, 65, 75, 100]}
                          tick={{ fontSize: 9, fill: "#78716c" }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <ReferenceLine
                          y={65}
                          stroke="#ef4444"
                          strokeDasharray="4 4"
                          strokeOpacity={0.5}
                          label={{
                            value: "min C",
                            position: "insideTopRight",
                            fontSize: 8,
                            fill: "#7f1d1d",
                          }}
                        />
                        <Tooltip
                          cursor={{ fill: "rgba(255,255,255,0.03)" }}
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const d = payload[0].payload as TrendDay;
                            return (
                              <div className="bg-[#1c1917] border border-[#292524] rounded-lg px-3 py-2 text-[11px] text-stone-300 space-y-0.5">
                                <p className="font-semibold text-stone-100">
                                  {d.displayDate}
                                </p>
                                <p>
                                  Score:{" "}
                                  <span
                                    className="font-mono font-bold"
                                    style={{ color: gradeColor(d.grade) }}
                                  >
                                    {d.score}
                                  </span>{" "}
                                  <span className="text-stone-500">(Grade {d.grade})</span>
                                </p>
                                <p>
                                  Completion:{" "}
                                  <span className="font-mono">{d.completionRate}%</span>
                                </p>
                                <p>
                                  On Time:{" "}
                                  <span className="font-mono">{d.onTimeRate}%</span>
                                </p>
                                <p className="text-stone-500">
                                  Tasks: {d.tasksCompleted}/{d.tasksAssigned}
                                </p>
                              </div>
                            );
                          }}
                        />
                        <Bar dataKey="score" radius={[2, 2, 0, 0]} maxBarSize={20}>
                          {trend.map((entry, i) => (
                            <Cell
                              key={i}
                              fill={gradeColor(entry.grade)}
                              fillOpacity={0.8}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* ── Duty Performance ─────────────────────────────────── */}
              <div className="border-t border-[#1a1a1a] pt-4 space-y-4">
                <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-stone-500">
                  Duty Performance — Last 30 Days
                </p>

                {dutyLoading && <DutySkeleton />}

                {dutyError && (
                  <div className="bg-red-950/30 border border-red-900 rounded-sm p-3">
                    <p className="text-xs text-red-400 font-mono">Error: {dutyError}</p>
                  </div>
                )}

                {!dutyLoading && !dutyError && dutyReport && (
                  <>
                    {/* Section 1: Avg Time Per Duty */}
                    {dutyReport.avgByDuty.length === 0 ? (
                      <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-sm p-4 text-center">
                        <p className="text-xs text-stone-500">No duty data for this period.</p>
                      </div>
                    ) : (
                      <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-sm overflow-hidden">
                        <p className="text-[9px] font-mono uppercase tracking-widest text-stone-500 px-3 pt-3 pb-2 border-b border-[#1a1a1a]">
                          Avg Time Per Duty
                        </p>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-[#141414]">
                                <th className="text-left px-3 py-2 text-[9px] font-mono uppercase tracking-widest text-stone-500">Duty</th>
                                <th className="text-left px-3 py-2 text-[9px] font-mono uppercase tracking-widest text-stone-500">Dept</th>
                                <th className="text-right px-3 py-2 text-[9px] font-mono uppercase tracking-widest text-stone-500">Avg</th>
                                <th className="text-right px-3 py-2 text-[9px] font-mono uppercase tracking-widest text-stone-500">Best</th>
                                <th className="text-right px-3 py-2 text-[9px] font-mono uppercase tracking-widest text-stone-500">Worst</th>
                                <th className="text-right px-3 py-2 text-[9px] font-mono uppercase tracking-widest text-stone-500">Late</th>
                              </tr>
                            </thead>
                            <tbody>
                              {dutyReport.avgByDuty.map((row, i) => (
                                <tr key={i} className="border-b border-[#141414] hover:bg-[#141414]">
                                  <td className="px-3 py-2 text-stone-300 max-w-[120px] truncate">{row.action_name}</td>
                                  <td className="px-3 py-2 text-stone-500">{row.department}</td>
                                  <td className={`px-3 py-2 text-right font-mono font-semibold ${
                                    row.avg_minutes > 120 ? "text-red-400" :
                                    row.avg_minutes > 60  ? "text-orange-400" :
                                    "text-stone-300"
                                  }`}>
                                    {row.avg_minutes}m
                                  </td>
                                  <td className="px-3 py-2 text-right font-mono text-green-400">{row.min_minutes}m</td>
                                  <td className="px-3 py-2 text-right font-mono text-stone-500">{row.max_minutes}m</td>
                                  <td className="px-3 py-2 text-right">
                                    {row.late_start_count > 0 ? (
                                      <span className="inline-block bg-red-950/60 border border-red-900 text-red-400 text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-sm">
                                        {row.late_start_count}×
                                      </span>
                                    ) : (
                                      <span className="text-stone-600 font-mono">—</span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Section 2: Late Starts */}
                    {dutyReport.lateDuties.length > 0 && (
                      <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-sm overflow-hidden">
                        <p className="text-[9px] font-mono uppercase tracking-widest text-stone-500 px-3 pt-3 pb-2 border-b border-[#1a1a1a]">
                          ⚠ {dutyReport.lateDuties.length} {dutyReport.lateDuties.length === 1 ? "duty" : "duties"} started after due time
                        </p>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-[#141414]">
                                <th className="text-left px-3 py-2 text-[9px] font-mono uppercase tracking-widest text-stone-500">Date</th>
                                <th className="text-left px-3 py-2 text-[9px] font-mono uppercase tracking-widest text-stone-500">Duty</th>
                                <th className="text-right px-3 py-2 text-[9px] font-mono uppercase tracking-widest text-stone-500">Due</th>
                                <th className="text-right px-3 py-2 text-[9px] font-mono uppercase tracking-widest text-stone-500">Started</th>
                                <th className="text-right px-3 py-2 text-[9px] font-mono uppercase tracking-widest text-stone-500">Late By</th>
                                <th className="text-right px-3 py-2 text-[9px] font-mono uppercase tracking-widest text-stone-500">Took</th>
                              </tr>
                            </thead>
                            <tbody>
                              {dutyReport.lateDuties.map((row, i) => {
                                const rowColor = row.minutes_late > 120 ? "text-red-400" :
                                                 row.minutes_late >= 30  ? "text-orange-400" :
                                                 "text-stone-300";
                                return (
                                  <tr key={i} className="border-b border-[#141414] hover:bg-[#141414]">
                                    <td className={`px-3 py-2 font-mono ${rowColor}`}>{shortDate(row.task_date)}</td>
                                    <td className={`px-3 py-2 max-w-[110px] truncate ${rowColor}`}>{row.action_name}</td>
                                    <td className="px-3 py-2 text-right font-mono text-stone-500">{row.due_time}</td>
                                    <td className={`px-3 py-2 text-right font-mono ${rowColor}`}>{row.started_at}</td>
                                    <td className={`px-3 py-2 text-right font-mono font-bold ${rowColor}`}>{formatLate(row.minutes_late)}</td>
                                    <td className="px-3 py-2 text-right font-mono text-stone-500">{row.time_to_complete}m</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Slide-in animation */}
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to   { transform: translateX(0); }
        }
      `}</style>
    </>
  );
}
