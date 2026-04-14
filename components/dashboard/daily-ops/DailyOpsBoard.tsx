"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface OpsTask {
  id: string;
  action_name: string;
  department: string;
  priority: string;
  due_time: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  duration_minutes: number | null;
  comments_start: string | null;
  comments_end: string | null;
  blocker_reason: string | null;
  escalated_to: string | null;
  evidence_urls: string[];
  assigned_to: string | null;
  sla_description: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface TeamMember {
  id: string;
  name: string;
}

interface Props {
  initialTasks: OpsTask[];
  team: TeamMember[];
  date: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  not_started: { label: "Not Started", color: "text-stone-500 dark:text-stone-400", bg: "bg-stone-500/10 border-stone-500/20", dot: "bg-stone-400" },
  started:     { label: "Started", color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20", dot: "bg-blue-400" },
  in_progress: { label: "In Progress", color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20", dot: "bg-blue-400 animate-pulse" },
  blocked:     { label: "Blocked", color: "text-red-400", bg: "bg-red-500/10 border-red-500/30", dot: "bg-red-500" },
  delayed:     { label: "Delayed", color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/30", dot: "bg-amber-500" },
  completed:   { label: "Completed", color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20", dot: "bg-emerald-400" },
  escalated:   { label: "Escalated", color: "text-red-400", bg: "bg-red-500/10 border-red-500/30", dot: "bg-red-500 animate-pulse" },
  missed:      { label: "Missed", color: "text-red-500", bg: "bg-red-500/15 border-red-500/40", dot: "bg-red-600" },
};

const PRIORITY_CONFIG: Record<string, { label: string; color: string }> = {
  critical: { label: "Critical", color: "bg-red-500/20 text-red-300 border-red-500/30" },
  high:     { label: "High", color: "bg-orange-500/20 text-orange-300 border-orange-500/30" },
  medium:   { label: "Medium", color: "bg-amber-500/20 text-amber-300 border-amber-500/30" },
  low:      { label: "Low", color: "bg-stone-500/20 text-stone-500 dark:text-stone-400 border-stone-500/30" },
};

const DEPT_CONFIG: Record<string, string> = {
  FOH: "bg-purple-500/20 text-purple-300",
  Kitchen: "bg-orange-500/20 text-orange-300",
  Admin: "bg-blue-500/20 text-blue-300",
  General: "bg-stone-500/20 text-stone-500 dark:text-stone-400",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function apiFetch(url: string, opts?: RequestInit) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

function formatTime(time: string) {
  const [h, m] = time.split(":");
  const hour = parseInt(h);
  return `${hour > 12 ? hour - 12 : hour}:${m} ${hour >= 12 ? "PM" : "AM"}`;
}

function formatTimestamp(ts: string | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" });
}

function isOverdue(task: OpsTask): boolean {
  if (task.status === "completed") return false;
  const now = new Date();
  const [h, m] = task.due_time.split(":").map(Number);
  const due = new Date();
  due.setHours(h, m, 0, 0);
  return now > due;
}

function minutesSince(ts: string): number {
  return Math.round((Date.now() - new Date(ts).getTime()) / 60000);
}

// ── Main Component ────────────────────────────────────────────────────────────

export function DailyOpsBoard({ initialTasks, team, date }: Props) {
  const [tasks, setTasks] = useState<OpsTask[]>(initialTasks);
  const [activeForm, setActiveForm] = useState<{ id: string; type: "start" | "complete" | "block" } | null>(null);
  const [formData, setFormData] = useState({ comment: "", blocker_reason: "", escalated_to: "", assigned_to: "" });
  const [saving, setSaving] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [tab, setTab] = useState<"board" | "notes" | "stats">("board");
  const [stats, setStats] = useState<any>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const router = useRouter();

  const refresh = useCallback(async () => {
    try {
      const data = await apiFetch("/api/daily-ops");
      setTasks(data.tasks);
    } catch { /* ignore */ }
  }, []);

  // Auto-poll every 30 s so all managers at the same store see live updates
  // without needing to manually refresh.
  useEffect(() => {
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  const loadStats = useCallback(async () => {
    if (stats) return;
    setLoadingStats(true);
    try {
      const data = await apiFetch("/api/daily-ops/stats");
      setStats(data);
    } catch { /* ignore */ } finally { setLoadingStats(false); }
  }, [stats]);

  // ── Actions ─────────────────────────────────────────────────────────────────

  const handleStart = async (taskId: string) => {
    setSaving(taskId);
    setFormError(null);
    try {
      const data = await apiFetch(`/api/daily-ops/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "started" }),
      });
      // Optimistically update local state from API response so the task shows
      // as started immediately, even if the background refresh fails.
      if (data?.task) {
        setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, ...data.task } : t));
      }
      refresh(); // background refresh — don't await so a slow fetch can't re-hide the update
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to start task. Please try again.");
    } finally { setSaving(null); }
  };

  const handleComplete = async (taskId: string) => {
    if (!formData.comment.trim()) return;
    setSaving(taskId);
    setFormError(null);
    try {
      const data = await apiFetch(`/api/daily-ops/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed", comments_end: formData.comment }),
      });
      if (data?.task) {
        setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, ...data.task } : t));
      }
      setActiveForm(null);
      setFormData({ comment: "", blocker_reason: "", escalated_to: "", assigned_to: "" });
      refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to complete task. Please try again.");
    } finally { setSaving(null); }
  };

  const handleBlock = async (taskId: string, status: "blocked" | "delayed" | "escalated") => {
    if (!formData.blocker_reason.trim() || !formData.escalated_to.trim()) return;
    setSaving(taskId);
    setFormError(null);
    try {
      const data = await apiFetch(`/api/daily-ops/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, blocker_reason: formData.blocker_reason, escalated_to: formData.escalated_to }),
      });
      if (data?.task) {
        setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, ...data.task } : t));
      }
      setActiveForm(null);
      setFormData({ comment: "", blocker_reason: "", escalated_to: "", assigned_to: "" });
      refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to update task. Please try again.");
    } finally { setSaving(null); }
  };

  const handleUpload = async (taskId: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    try {
      await apiFetch(`/api/daily-ops/${taskId}/upload`, { method: "POST", body: fd });
      await refresh();
    } catch { /* ignore */ }
  };

  // ── Computed ────────────────────────────────────────────────────────────────

  const teamMap = useMemo(() => new Map(team.map((m) => [m.id, m.name])), [team]);

  const summary = useMemo(() => {
    const completed = tasks.filter((t) => t.status === "completed").length;
    const blocked = tasks.filter((t) => ["blocked", "delayed", "escalated"].includes(t.status)).length;
    const overdue = tasks.filter(isOverdue).length;
    const inProgress = tasks.filter((t) => ["started", "in_progress"].includes(t.status)).length;
    const durations = tasks.filter((t) => t.duration_minutes).map((t) => t.duration_minutes!);
    const avgDuration = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
    return { completed, total: tasks.length, blocked, overdue, inProgress, avgDuration };
  }, [tasks]);

  const notesEntries = useMemo(() => {
    return tasks
      .flatMap((t) => {
        const entries: { task: string; type: string; comment: string; time: string }[] = [];
        if (t.comments_end && t.completed_at) {
          entries.push({ task: t.action_name, type: "Complete", comment: t.comments_end, time: t.completed_at });
        }
        if (t.blocker_reason) {
          entries.push({ task: t.action_name, type: "Blocker", comment: `${t.blocker_reason} → Escalated to: ${t.escalated_to}`, time: t.updated_at });
        }
        return entries;
      })
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
  }, [tasks]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-stone-900 dark:text-stone-100">Daily Operations Tracker</h1>
          <p className="text-xs text-stone-500">{new Date(date).toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
        </div>
        <button onClick={() => { refresh(); router.refresh(); }} className="rounded-lg bg-stone-100 dark:bg-stone-800 px-3 py-1.5 text-xs font-medium text-stone-600 dark:text-stone-300 hover:bg-stone-700 transition-colors">
          Refresh
        </button>
      </div>

      {/* Summary Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          { label: "Completed", value: `${summary.completed}/${summary.total}`, color: "text-emerald-400" },
          { label: "In Progress", value: summary.inProgress, color: "text-blue-400" },
          { label: "Overdue", value: summary.overdue, color: summary.overdue > 0 ? "text-red-400" : "text-stone-500" },
          { label: "Blocked", value: summary.blocked, color: summary.blocked > 0 ? "text-red-400" : "text-stone-500" },
          { label: "Avg Duration", value: summary.avgDuration ? `${summary.avgDuration}m` : "—", color: "text-stone-500 dark:text-stone-400" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900/60 px-4 py-3">
            <p className="text-[10px] font-medium uppercase tracking-wider text-stone-500">{s.label}</p>
            <p className={cn("text-2xl font-bold", s.color)}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 rounded-lg bg-stone-100 dark:bg-stone-800/50 p-1">
        {(["board", "notes", "stats"] as const).map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); if (t === "stats") loadStats(); }}
            className={cn(
              "flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors capitalize",
              tab === t ? "bg-stone-700 text-stone-100" : "text-stone-500 hover:text-stone-300"
            )}
          >
            {t === "board" ? "Operations Board" : t === "notes" ? "Manager Notes" : "Analytics"}
          </button>
        ))}
      </div>

      {/* Board Tab */}
      {tab === "board" && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
          {tasks.map((task) => {
            const sc = STATUS_CONFIG[task.status] ?? STATUS_CONFIG.not_started;
            const pc = PRIORITY_CONFIG[task.priority] ?? PRIORITY_CONFIG.medium;
            const overdue = isOverdue(task);
            const isActive = activeForm?.id === task.id;
            const isSaving = saving === task.id;

            return (
              <div
                key={task.id}
                className={cn(
                  "rounded-xl border bg-stone-50 dark:bg-stone-900/60 overflow-hidden transition-all",
                  task.status === "completed" ? "border-emerald-500/20" :
                  overdue || task.status === "blocked" || task.status === "missed" ? "border-red-500/30" :
                  task.status === "delayed" ? "border-amber-500/30" :
                  ["started", "in_progress"].includes(task.status) ? "border-blue-500/20" :
                  "border-stone-200 dark:border-stone-800"
                )}
              >
                {/* Top accent bar */}
                <div className={cn(
                  "h-1",
                  task.status === "completed" ? "bg-emerald-500" :
                  overdue || task.status === "blocked" || task.status === "missed" ? "bg-red-500" :
                  task.status === "delayed" ? "bg-amber-500" :
                  ["started", "in_progress"].includes(task.status) ? "bg-blue-500" :
                  "bg-stone-700"
                )} />

                <div className="p-4 space-y-3">
                  {/* Header row */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">{task.action_name}</h3>
                        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium border", sc.bg, sc.color)}>
                          <span className={cn("inline-block h-1.5 w-1.5 rounded-full mr-1", sc.dot)} />
                          {sc.label}
                        </span>
                        {overdue && task.status !== "completed" && (
                          <span className="rounded-full bg-red-500/20 border border-red-500/30 px-2 py-0.5 text-[10px] font-semibold text-red-400">
                            OVERDUE
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", DEPT_CONFIG[task.department] ?? DEPT_CONFIG.General)}>
                          {task.department}
                        </span>
                        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium border", pc.color)}>
                          {pc.label}
                        </span>
                        <span className="text-[10px] text-stone-500">Due {formatTime(task.due_time)}</span>
                        {task.sla_description && (
                          <span className="text-[10px] text-stone-600 italic">{task.sla_description}</span>
                        )}
                      </div>
                    </div>
                    {/* Assigned-to badge / dropdown */}
                    {task.assigned_to ? (
                      <span className="rounded-md border border-stone-300 dark:border-stone-700 bg-stone-100 dark:bg-stone-800 px-2 py-1 text-[10px] text-stone-500 dark:text-stone-400">
                        {teamMap.get(task.assigned_to) ?? "Unknown"}
                      </span>
                    ) : team.length > 0 && !["completed", "missed"].includes(task.status) && (
                      <select
                        defaultValue=""
                        onChange={async (e) => {
                          const uid = e.target.value;
                          if (!uid) return;
                          try {
                            const data = await apiFetch(`/api/daily-ops/${task.id}`, {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ status: task.status, assigned_to: uid }),
                            });
                            if (data?.task) setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, ...data.task } : t));
                          } catch { /* ignore */ }
                        }}
                        className="rounded-md border border-stone-300 dark:border-stone-700 bg-stone-100 dark:bg-stone-800 px-2 py-1 text-[10px] text-stone-500 dark:text-stone-400 cursor-pointer"
                      >
                        <option value="">Assign…</option>
                        {team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                    )}
                  </div>

                  {/* Timestamps row */}
                  {(task.started_at || task.completed_at) && (
                    <div className="flex items-center gap-4 text-[10px] text-stone-500">
                      {task.started_at && <span>Started: {formatTimestamp(task.started_at)}</span>}
                      {task.completed_at && <span>Completed: {formatTimestamp(task.completed_at)}</span>}
                      {task.duration_minutes != null && <span className="text-emerald-400">{task.duration_minutes}m duration</span>}
                      {task.started_at && !task.completed_at && (
                        <span className="text-blue-400">{minutesSince(task.started_at)}m elapsed</span>
                      )}
                    </div>
                  )}

                  {/* Blocker info */}
                  {task.blocker_reason && (
                    <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-2.5 space-y-1">
                      <p className="text-[10px] font-semibold text-red-400 uppercase">Blocker</p>
                      <p className="text-xs text-red-300">{task.blocker_reason}</p>
                      {task.escalated_to && <p className="text-[10px] text-stone-500">Escalated to: <span className="text-stone-600 dark:text-stone-300">{task.escalated_to}</span></p>}
                      {task.started_at && <p className="text-[10px] text-red-500">Blocked for {minutesSince(task.updated_at)}m</p>}
                    </div>
                  )}

                  {/* Comments */}
                  {task.comments_end && (
                    <div className="space-y-1.5 rounded-lg border border-stone-200 dark:border-stone-800 bg-stone-100 dark:bg-stone-800/30 p-2.5">
                      <div>
                        <p className="text-[10px] font-medium text-emerald-400">Completion Note</p>
                        <p className="text-xs text-stone-600 dark:text-stone-300">{task.comments_end}</p>
                      </div>
                    </div>
                  )}

                  {/* Evidence */}
                  {task.evidence_urls.length > 0 && (
                    <div className="flex gap-2 flex-wrap">
                      {task.evidence_urls.map((url, i) => (
                        <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="rounded-md border border-stone-300 dark:border-stone-700 bg-stone-100 dark:bg-stone-800 px-2 py-1 text-[10px] text-stone-500 dark:text-stone-400 hover:text-stone-200 transition-colors">
                          Evidence {i + 1}
                        </a>
                      ))}
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="flex items-center gap-2 flex-wrap border-t border-stone-200 dark:border-stone-800 pt-3">
                    {task.status === "not_started" && (
                      <button
                        onClick={() => handleStart(task.id)}
                        disabled={saving === task.id}
                        className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-40 transition-colors"
                      >
                        {saving === task.id ? "Starting…" : "Start"}
                      </button>
                    )}
                    {["started", "in_progress"].includes(task.status) && (
                      <button
                        onClick={() => { setActiveForm({ id: task.id, type: "complete" }); setFormData({ ...formData, comment: "" }); }}
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 transition-colors"
                      >
                        Complete
                      </button>
                    )}
                    {!["completed", "missed"].includes(task.status) && (
                      <>
                        <button
                          onClick={() => { setActiveForm({ id: task.id, type: "block" }); setFormData({ ...formData, blocker_reason: "", escalated_to: "" }); }}
                          className="rounded-lg bg-red-500/20 px-3 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-500/30 transition-colors"
                        >
                          Block / Delay
                        </button>
                        <label className="cursor-pointer rounded-lg bg-stone-100 dark:bg-stone-800 px-3 py-1.5 text-xs font-medium text-stone-500 dark:text-stone-400 hover:bg-stone-700 transition-colors">
                          Upload
                          <input type="file" accept="image/*,.pdf" className="hidden" onChange={(e) => { if (e.target.files?.[0]) handleUpload(task.id, e.target.files[0]); }} />
                        </label>
                      </>
                    )}
                  </div>

                  {/* Inline Forms */}
                  {isActive && activeForm.type === "complete" && (
                    <div className="rounded-lg border border-emerald-800/50 bg-stone-50 dark:bg-stone-900/80 p-3 space-y-2">
                      <p className="text-xs font-semibold text-emerald-400">Completion note — what did you find or do? <span className="text-red-400">*</span></p>
                      <textarea
                        value={formData.comment}
                        onChange={(e) => { setFormData({ ...formData, comment: e.target.value }); setFormError(null); }}
                        placeholder="e.g. Deep clean completed but kitchen extractor still needs maintenance."
                        className="w-full rounded-md border border-stone-300 dark:border-stone-700 bg-stone-100 dark:bg-stone-800 px-3 py-2 text-xs text-stone-700 dark:text-stone-200 placeholder:text-stone-600 focus:border-emerald-500 focus:outline-none"
                        rows={2}
                      />
                      {formError && <p className="text-xs text-red-400">{formError}</p>}
                      <div className="flex gap-2">
                        <button onClick={() => handleComplete(task.id)} disabled={!formData.comment.trim() || isSaving} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40 transition-colors">
                          {isSaving ? "Saving…" : "Confirm Complete"}
                        </button>
                        <button onClick={() => { setActiveForm(null); setFormError(null); }} className="rounded-lg bg-stone-100 dark:bg-stone-800 px-3 py-1 text-xs text-stone-500 dark:text-stone-400 hover:bg-stone-700 transition-colors">Cancel</button>
                      </div>
                    </div>
                  )}

                  {isActive && activeForm.type === "block" && (
                    <div className="rounded-lg border border-red-800/50 bg-stone-50 dark:bg-stone-900/80 p-3 space-y-2">
                      <p className="text-xs font-semibold text-red-400">Report Issue</p>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <select
                          value=""
                          onChange={(e) => {
                            const status = e.target.value;
                            if (status && formData.blocker_reason && formData.escalated_to) {
                              handleBlock(task.id, status as "blocked" | "delayed" | "escalated");
                            }
                          }}
                          className="hidden"
                        >
                          <option value="">Pick status</option>
                        </select>
                      </div>
                      <textarea
                        value={formData.blocker_reason}
                        onChange={(e) => setFormData({ ...formData, blocker_reason: e.target.value })}
                        placeholder="What is blocking this task?"
                        className="w-full rounded-md border border-stone-300 dark:border-stone-700 bg-stone-100 dark:bg-stone-800 px-3 py-2 text-xs text-stone-700 dark:text-stone-200 placeholder:text-stone-600 focus:border-red-500 focus:outline-none"
                        rows={2}
                      />
                      <input
                        value={formData.escalated_to}
                        onChange={(e) => setFormData({ ...formData, escalated_to: e.target.value })}
                        placeholder="Escalation contact (e.g. Head Chef, GM)"
                        className="w-full rounded-md border border-stone-300 dark:border-stone-700 bg-stone-100 dark:bg-stone-800 px-3 py-2 text-xs text-stone-700 dark:text-stone-200 placeholder:text-stone-600 focus:border-red-500 focus:outline-none"
                      />
                      {formError && <p className="text-xs text-red-400">{formError}</p>}
                      <div className="flex gap-2 flex-wrap">
                        <button onClick={() => handleBlock(task.id, "blocked")} disabled={!formData.blocker_reason.trim() || !formData.escalated_to.trim() || isSaving} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-40 transition-colors">
                          {isSaving ? "Saving…" : "Mark Blocked"}
                        </button>
                        <button onClick={() => handleBlock(task.id, "delayed")} disabled={!formData.blocker_reason.trim() || !formData.escalated_to.trim() || isSaving} className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-500 disabled:opacity-40 transition-colors">
                          Mark Delayed
                        </button>
                        <button onClick={() => handleBlock(task.id, "escalated")} disabled={!formData.blocker_reason.trim() || !formData.escalated_to.trim() || isSaving} className="rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-500 disabled:opacity-40 transition-colors">
                          Escalate
                        </button>
                        <button onClick={() => { setActiveForm(null); setFormError(null); }} className="rounded-lg bg-stone-100 dark:bg-stone-800 px-3 py-1 text-xs text-stone-500 dark:text-stone-400 hover:bg-stone-700 transition-colors">Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {tasks.length === 0 && (
            <div className="rounded-xl border border-dashed border-stone-300 dark:border-stone-700 py-12 text-center">
              <p className="text-sm text-stone-500">No tasks for today. Tasks are auto-generated from templates.</p>
            </div>
          )}
        </div>
      )}

      {/* Manager Notes Tab */}
      {tab === "notes" && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-stone-700 dark:text-stone-200">Manager Notes & Comment History</h2>
          {notesEntries.length === 0 ? (
            <div className="rounded-xl border border-dashed border-stone-300 dark:border-stone-700 py-12 text-center">
              <p className="text-sm text-stone-500">No notes yet. Comments will appear here as tasks are started and completed.</p>
            </div>
          ) : (
            <div className="divide-y divide-stone-200 dark:divide-stone-800 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900/60 overflow-hidden">
              {notesEntries.map((entry, i) => (
                <div key={i} className="px-4 py-3 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-medium",
                      entry.type === "Start" ? "bg-blue-500/20 text-blue-300" :
                      entry.type === "Complete" ? "bg-emerald-500/20 text-emerald-300" :
                      "bg-red-500/20 text-red-300"
                    )}>
                      {entry.type}
                    </span>
                    <span className="text-xs font-medium text-stone-700 dark:text-stone-200">{entry.task}</span>
                    <span className="text-[10px] text-stone-600">{formatTimestamp(entry.time)}</span>
                  </div>
                  <p className="text-xs text-stone-500 dark:text-stone-400 pl-1">{entry.comment}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Stats Tab */}
      {tab === "stats" && (
        <div className="space-y-6">
          {loadingStats ? (
            <div className="py-12 text-center text-sm text-stone-500">Loading analytics…</div>
          ) : stats ? (
            <>
              {/* Today's Stats */}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-500 mb-3">Today</h3>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    { label: "Not Started", value: stats.today.not_started, color: "text-stone-500 dark:text-stone-400" },
                    { label: "In Progress", value: stats.today.started, color: "text-blue-400" },
                    { label: "Completed", value: stats.today.completed, color: "text-emerald-400" },
                    { label: "Blocked", value: stats.today.blocked, color: stats.today.blocked > 0 ? "text-red-400" : "text-stone-500" },
                    { label: "Overdue", value: stats.today.overdue, color: stats.today.overdue > 0 ? "text-red-400" : "text-stone-500" },
                    { label: "Escalated", value: stats.today.escalated, color: stats.today.escalated > 0 ? "text-orange-400" : "text-stone-500" },
                    { label: "Missed", value: stats.today.missed, color: stats.today.missed > 0 ? "text-red-500" : "text-stone-500" },
                    { label: "Total", value: stats.today.total, color: "text-stone-600 dark:text-stone-300" },
                  ].map((s) => (
                    <div key={s.label} className="rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900/60 px-3 py-2">
                      <p className="text-[10px] font-medium uppercase tracking-wider text-stone-500">{s.label}</p>
                      <p className={cn("text-xl font-bold", s.color)}>{s.value}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Avg Completion Times */}
              {stats.avgCompletionTimes.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-500 mb-3">Avg Completion Time (30d)</h3>
                  <div className="divide-y divide-stone-200 dark:divide-stone-800 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900/60 overflow-hidden">
                    {stats.avgCompletionTimes.map((a: any) => (
                      <div key={a.action_name} className="flex items-center justify-between px-4 py-2.5">
                        <span className="text-xs text-stone-700 dark:text-stone-200">{a.action_name}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-bold text-stone-600 dark:text-stone-300">{a.avg_minutes}m</span>
                          <span className="text-[10px] text-stone-600">{a.sample_size} samples</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recurring Blockers */}
              {stats.recurringBlockers.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-500 mb-3">Recurring Blockers (30d)</h3>
                  <div className="divide-y divide-stone-200 dark:divide-stone-800 rounded-xl border border-red-500/20 bg-stone-50 dark:bg-stone-900/60 overflow-hidden">
                    {stats.recurringBlockers.map((b: any, i: number) => (
                      <div key={i} className="flex items-center justify-between px-4 py-2.5">
                        <span className="text-xs text-red-300">{b.reason}</span>
                        <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] font-medium text-red-400">{b.count}x</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Team Completion Rates */}
              {stats.teamRates.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-500 mb-3">Team Completion Rates (30d)</h3>
                  <div className="divide-y divide-stone-200 dark:divide-stone-800 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900/60 overflow-hidden">
                    {stats.teamRates.map((t: any) => (
                      <div key={t.user_id} className="flex items-center justify-between px-4 py-2.5">
                        <span className="text-xs text-stone-700 dark:text-stone-200">{t.name}</span>
                        <div className="flex items-center gap-3">
                          <div className="w-24 h-1.5 rounded-full bg-stone-100 dark:bg-stone-800 overflow-hidden">
                            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${t.rate}%` }} />
                          </div>
                          <span className="text-xs font-bold text-stone-600 dark:text-stone-300">{t.rate}%</span>
                          <span className="text-[10px] text-stone-600">{t.completed}/{t.total}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="py-12 text-center text-sm text-stone-500">Could not load analytics.</div>
          )}
        </div>
      )}
    </div>
  );
}
