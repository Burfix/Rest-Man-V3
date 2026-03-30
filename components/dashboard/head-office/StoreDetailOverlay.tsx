"use client";

import { useEffect } from "react";
import { cn } from "@/lib/utils";

// ── Shared types (matches DailyReportClient) ────────────────────────────────

export interface TaskData {
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
  evidence_urls: string[];
  sla: string | null;
  sla_met: boolean | null;
}

export interface MaintenanceIssue {
  title: string;
  priority: string;
  status: string;
  impact: string | null;
  reported: string;
}

export interface ComplianceOverdueItem {
  name: string;
  category: string;
  due: string;
  critical: boolean;
}

export interface NegativeReview {
  platform: string;
  rating: number;
  reviewer: string;
  text: string;
  date: string;
}

export interface StoreData {
  store: string;
  siteId: string;
  city: string;
  tasks: TaskData[];
  summary: {
    total: number;
    completed: number;
    in_progress: number;
    blocked: number;
    escalated: number;
    missed: number;
    not_started: number;
    overdue: number;
    completion_pct: number;
    avg_duration: number | null;
    blocker_reasons: string[];
  };
  financials: {
    sales_net_vat: number | null;
    revenue_target: number | null;
    revenue_gap_pct: number | null;
    labour_pct: number | null;
    target_labour_pct: number;
    operating_score: number | null;
    score_grade: string | null;
  };
  maintenance: { open_count: number; urgent_count: number; issues: MaintenanceIssue[] };
  compliance: { total: number; expired: number; due_soon: number; overdue_items: ComplianceOverdueItem[] };
  reviews: { total_7d: number; negative_count: number; flagged_count: number; avg_rating: number | null; negative_unanswered: NegativeReview[] };
  actions: { open_count: number; overdue_count: number };
  riskLevel: "green" | "yellow" | "red";
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtZAR(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `R${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1_000) return `R${Math.round(n / 1_000).toLocaleString()}k`;
  return `R${Math.round(n).toLocaleString()}`;
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" });
  } catch { return "—"; }
}

function riskBadge(level: "green" | "yellow" | "red") {
  const map = {
    green: { bg: "bg-emerald-950/60 text-emerald-300 border-emerald-800/40 print:bg-emerald-100 print:text-emerald-800 print:border-emerald-300", label: "On Track" },
    yellow: { bg: "bg-amber-950/60 text-amber-300 border-amber-800/40 print:bg-amber-100 print:text-amber-800 print:border-amber-300", label: "Attention" },
    red: { bg: "bg-red-950/60 text-red-300 border-red-800/40 print:bg-red-100 print:text-red-800 print:border-red-300", label: "At Risk" },
  };
  return map[level];
}

function statusBadge(status: string) {
  switch (status) {
    case "completed": return "bg-emerald-950/60 text-emerald-300 border-emerald-800/40 print:bg-emerald-100 print:text-emerald-800";
    case "started": case "in_progress": return "bg-blue-950/60 text-blue-300 border-blue-800/40 print:bg-blue-100 print:text-blue-800";
    case "blocked": case "delayed": return "bg-red-950/60 text-red-300 border-red-800/40 print:bg-red-100 print:text-red-800";
    case "escalated": return "bg-amber-950/60 text-amber-300 border-amber-800/40 print:bg-amber-100 print:text-amber-800";
    case "missed": return "bg-red-950/80 text-red-200 border-red-800/50 print:bg-red-100 print:text-red-800";
    default: return "bg-stone-800 text-stone-400 border-stone-700 print:bg-stone-200 print:text-stone-700";
  }
}

function pctColor(pct: number): string {
  if (pct >= 90) return "text-emerald-400 print:text-emerald-700";
  if (pct >= 70) return "text-amber-400 print:text-amber-700";
  return "text-red-400 print:text-red-700";
}

// ── Component ────────────────────────────────────────────────────────────────

interface Props {
  store: StoreData;
  reportDate: string;
  onClose: () => void;
}

export default function StoreDetailOverlay({ store, reportDate, onClose }: Props) {
  const risk = riskBadge(store.riskLevel);
  const s = store.summary;
  const f = store.financials;

  // Escape to close
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  // Lock body scroll
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  const incompleteTasks = store.tasks.filter((t) => t.status !== "completed");

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 overflow-y-auto print:static print:bg-white print:overflow-visible"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl my-6 mx-4 rounded-xl bg-stone-950 border border-stone-800 shadow-2xl print:my-0 print:mx-0 print:shadow-none print:border-none print:rounded-none print:max-w-none print:bg-white"
        onClick={(e) => e.stopPropagation()}
        id="store-detail-print"
      >
        {/* ── Header ────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-800 print:border-stone-300">
          <div>
            <h2 className="text-lg font-bold text-stone-100 print:text-stone-900">{store.store}</h2>
            <p className="text-xs text-stone-400 print:text-stone-600">{store.city} · Daily Report · {reportDate}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className={cn("text-[10px] font-bold uppercase px-2 py-1 rounded border", risk.bg)}>{risk.label}</span>
            <button onClick={() => window.print()} className="text-xs bg-stone-800 hover:bg-stone-700 text-stone-200 px-3 py-1.5 rounded-lg print:hidden">Print</button>
            <button onClick={onClose} className="text-xs bg-stone-800 hover:bg-stone-700 text-stone-200 px-3 py-1.5 rounded-lg print:hidden">Close</button>
          </div>
        </div>

        <div className="p-6 space-y-5 print:p-4 print:space-y-3">
          {/* ── KPI Tiles ───────────────────────────────────────────────── */}
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2 print:grid-cols-6">
            <KPI label="Duties" value={`${s.completion_pct}%`} sub={`${s.completed}/${s.total}`} cls={pctColor(s.completion_pct)} />
            <KPI label="Blocked" value={String(s.blocked)} cls={s.blocked > 0 ? "text-red-400 print:text-red-700" : ""} />
            <KPI label="Overdue" value={String(s.overdue)} cls={s.overdue > 0 ? "text-red-400 print:text-red-700" : ""} />
            <KPI label="Revenue" value={fmtZAR(f.sales_net_vat)} sub={f.revenue_target ? `Target: ${fmtZAR(f.revenue_target)}` : undefined} />
            <KPI label="Labour %" value={f.labour_pct != null ? `${f.labour_pct}%` : "—"} sub={`Target: ${f.target_labour_pct}%`} cls={f.labour_pct != null ? (f.labour_pct <= f.target_labour_pct ? "text-emerald-400 print:text-emerald-700" : "text-red-400 print:text-red-700") : ""} />
            <KPI label="Score" value={`${f.operating_score ?? "—"}`} sub={f.score_grade ?? undefined} />
          </div>

          {/* ── Duties Table ────────────────────────────────────────────── */}
          <div>
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-stone-400 print:text-stone-600 mb-2">
              Daily Duties {incompleteTasks.length < store.tasks.length && `(${incompleteTasks.length} incomplete of ${store.tasks.length})`}
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] print:text-[9px]">
                <thead>
                  <tr className="border-b border-stone-800 print:border-stone-300 text-stone-500 print:text-stone-600">
                    <th className="px-2 py-1.5 text-left font-semibold">Task</th>
                    <th className="px-2 py-1.5 text-center font-semibold">Status</th>
                    <th className="px-2 py-1.5 text-left font-semibold">By</th>
                    <th className="px-2 py-1.5 text-left font-semibold">Started</th>
                    <th className="px-2 py-1.5 text-left font-semibold">Done</th>
                    <th className="px-2 py-1.5 text-right font-semibold">Mins</th>
                    <th className="px-2 py-1.5 text-center font-semibold">SLA</th>
                    <th className="px-2 py-1.5 text-left font-semibold">Blocker / Comment</th>
                  </tr>
                </thead>
                <tbody>
                  {store.tasks.map((t, i) => (
                    <tr key={i} className={cn("border-b border-stone-800/30 print:border-stone-200", t.status === "blocked" || t.status === "missed" ? "bg-red-950/10 print:bg-red-50" : "")}>
                      <td className="px-2 py-1.5 text-stone-200 print:text-stone-800 font-medium">{t.action}</td>
                      <td className="px-2 py-1.5 text-center">
                        <span className={cn("text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border", statusBadge(t.status))}>
                          {t.status.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-stone-400 print:text-stone-600">{t.started_by ?? "—"}</td>
                      <td className="px-2 py-1.5 text-stone-400 print:text-stone-600">{fmtTime(t.started_at)}</td>
                      <td className="px-2 py-1.5 text-stone-400 print:text-stone-600">{fmtTime(t.completed_at)}</td>
                      <td className="px-2 py-1.5 text-right text-stone-400 print:text-stone-600">{t.duration_minutes ?? "—"}</td>
                      <td className="px-2 py-1.5 text-center">
                        {t.sla_met === true ? <span className="text-emerald-400 print:text-emerald-700 font-bold">Met</span> :
                         t.sla_met === false ? <span className="text-red-400 print:text-red-700 font-bold">Missed</span> :
                         <span className="text-stone-600">—</span>}
                      </td>
                      <td className="px-2 py-1.5 text-stone-500 print:text-stone-600 max-w-[180px] truncate print:max-w-none print:whitespace-normal">
                        {t.blocker_reason ? <span className="text-red-400 print:text-red-700">{t.blocker_reason}</span> : (t.completion_comment || t.start_comment || "—")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Two-column: Maintenance + Compliance ─────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 print:grid-cols-2">
            {/* Maintenance */}
            <div>
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-stone-400 print:text-stone-600 mb-2">
                Maintenance ({store.maintenance.open_count} open)
              </h3>
              {store.maintenance.issues.length === 0 ? (
                <p className="text-xs text-stone-600">No open issues.</p>
              ) : (
                <div className="space-y-1.5">
                  {store.maintenance.issues.map((issue, i) => (
                    <div key={i} className="flex items-center justify-between text-[11px] print:text-[9px] rounded-lg border border-stone-800 print:border-stone-300 px-3 py-1.5">
                      <div className="flex items-center gap-2">
                        <span className={cn("h-2 w-2 rounded-full shrink-0", issue.priority === "urgent" || issue.priority === "critical" ? "bg-red-500" : issue.priority === "high" ? "bg-amber-400" : "bg-stone-500")} />
                        <span className="text-stone-300 print:text-stone-700">{issue.title}</span>
                      </div>
                      <span className={cn("text-[9px] font-bold uppercase", issue.priority === "urgent" || issue.priority === "critical" ? "text-red-400 print:text-red-700" : "text-stone-500")}>{issue.priority}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Compliance */}
            <div>
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-stone-400 print:text-stone-600 mb-2">
                Compliance ({store.compliance.expired} overdue)
              </h3>
              {store.compliance.overdue_items.length === 0 ? (
                <p className="text-xs text-stone-600">No overdue items.</p>
              ) : (
                <div className="space-y-1.5">
                  {store.compliance.overdue_items.map((item, i) => (
                    <div key={i} className={cn("flex items-center justify-between text-[11px] print:text-[9px] rounded-lg border px-3 py-1.5", item.critical ? "border-red-800/50 bg-red-950/10 print:border-red-300 print:bg-red-50" : "border-stone-800 print:border-stone-300")}>
                      <span className="text-stone-300 print:text-stone-700">{item.name}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-stone-500 text-[9px]">{item.category}</span>
                        <span className="text-red-400 print:text-red-700 text-[9px]">Due: {item.due}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── Two-column: Reviews + Actions ────────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 print:grid-cols-2">
            {/* Reviews */}
            <div>
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-stone-400 print:text-stone-600 mb-2">
                Guest Reviews (7d)
              </h3>
              <div className="flex items-center gap-4 text-xs mb-2">
                <span className="text-stone-400 print:text-stone-600">Total: <strong className="text-stone-200 print:text-stone-800">{store.reviews.total_7d}</strong></span>
                <span className="text-stone-400 print:text-stone-600">Avg: <strong className={cn(store.reviews.avg_rating != null ? (store.reviews.avg_rating >= 4 ? "text-emerald-400 print:text-emerald-700" : "text-red-400 print:text-red-700") : "text-stone-600")}>{store.reviews.avg_rating ?? "—"}</strong></span>
                <span className="text-stone-400 print:text-stone-600">Negative: <strong className={cn(store.reviews.negative_count > 0 ? "text-red-400 print:text-red-700" : "text-stone-600")}>{store.reviews.negative_count}</strong></span>
              </div>
              {store.reviews.negative_unanswered.length > 0 && (
                <div className="space-y-1.5">
                  {store.reviews.negative_unanswered.slice(0, 3).map((rev, i) => (
                    <div key={i} className="rounded-lg border border-stone-800 print:border-stone-300 px-3 py-2 bg-red-950/10 print:bg-red-50">
                      <div className="flex items-center justify-between text-[10px] mb-1">
                        <span className="text-stone-400 print:text-stone-600">{rev.reviewer} · {rev.platform}</span>
                        <span className="text-red-400 print:text-red-700 font-bold">{rev.rating}/5</span>
                      </div>
                      <p className="text-[10px] text-stone-500 print:text-stone-600 line-clamp-2">{rev.text}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Actions */}
            <div>
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-stone-400 print:text-stone-600 mb-2">
                Actions
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-stone-800/60 print:bg-stone-100 rounded-lg px-3 py-2.5">
                  <div className="text-[10px] text-stone-400 print:text-stone-600">Open</div>
                  <div className={cn("text-lg font-bold mt-0.5", store.actions.open_count > 0 ? "text-amber-400 print:text-amber-700" : "text-stone-600")}>{store.actions.open_count}</div>
                </div>
                <div className="bg-stone-800/60 print:bg-stone-100 rounded-lg px-3 py-2.5">
                  <div className="text-[10px] text-stone-400 print:text-stone-600">Overdue</div>
                  <div className={cn("text-lg font-bold mt-0.5", store.actions.overdue_count > 0 ? "text-red-400 print:text-red-700" : "text-stone-600")}>{store.actions.overdue_count}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function KPI({ label, value, sub, cls }: { label: string; value: string; sub?: string; cls?: string }) {
  return (
    <div className="bg-stone-800/60 print:bg-stone-100 rounded-lg px-3 py-2">
      <div className="text-[10px] text-stone-400 print:text-stone-600">{label}</div>
      <div className={cn("text-base font-bold text-stone-100 print:text-stone-900 mt-0.5 leading-tight", cls)}>{value}</div>
      {sub && <div className="text-[9px] text-stone-500 print:text-stone-500 mt-0.5">{sub}</div>}
    </div>
  );
}
