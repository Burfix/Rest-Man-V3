"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ActionStatus    = "pending" | "in_progress" | "completed";
export type ImpactWeight    = "critical" | "high" | "medium" | "low";
export type ExecutionType   = "call" | "message" | "staffing" | "compliance";

export interface Action {
  id:            string;
  title:         string;
  description:   string | null;
  impact_weight: ImpactWeight;
  status:        ActionStatus;
  assigned_to:   string | null;
  source_type:   string | null;
  created_at:    string;
  started_at:    string | null;
  completed_at:  string | null;
  revenue_before:  number | null;
  revenue_after:   number | null;
  revenue_delta:   number | null;
  execution_type:  ExecutionType | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const impactConfig: Record<ImpactWeight, { label: string; badge: string }> = {
  critical: { label: "Critical", badge: "bg-red-100 text-red-700 ring-red-200" },
  high:     { label: "High",     badge: "bg-orange-100 text-orange-700 ring-orange-200" },
  medium:   { label: "Medium",   badge: "bg-amber-100 text-amber-700 ring-amber-200" },
  low:      { label: "Low",      badge: "bg-stone-100 text-stone-500 ring-stone-200" },
};

const executionConfig: Record<ExecutionType, {
  label:    string;
  icon:     string;
  btnClass: string;
  hint:     string;
}> = {
  call: {
    label:    "Call",
    icon:     "📞",
    btnClass: "border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100",
    hint:     "Open call / waiting list",
  },
  message: {
    label:    "Message",
    icon:     "💬",
    btnClass: "border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100",
    hint:     "Send message to team",
  },
  staffing: {
    label:    "Staffing",
    icon:     "👥",
    btnClass: "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100",
    hint:     "Adjust floor staffing",
  },
  compliance: {
    label:    "Compliance",
    icon:     "📋",
    btnClass: "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100",
    hint:     "Log compliance check",
  },
};

const statusConfig: Record<ActionStatus, { label: string; bar: string }> = {
  pending:     { label: "Pending",     bar: "bg-stone-300" },
  in_progress: { label: "In Progress", bar: "bg-blue-500"  },
  completed:   { label: "Completed",   bar: "bg-green-500" },
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(mins / 60);
  const days  = Math.floor(hours / 24);
  if (days  > 0)  return `${days}d ago`;
  if (hours > 0)  return `${hours}h ago`;
  if (mins  > 0)  return `${mins}m ago`;
  return "just now";
}

function resolutionTime(action: Action): string | null {
  if (!action.completed_at || !action.created_at) return null;
  const ms    = new Date(action.completed_at).getTime() - new Date(action.created_at).getTime();
  const mins  = Math.floor(ms / 60_000);
  const hours = Math.floor(mins / 60);
  if (hours > 0) return `${hours}h ${mins % 60}m`;
  return `${mins}m`;
}

// ── Quick-Action Modals ──────────────────────────────────────────────────────

function QuickActionModal({
  action,
  onClose,
}: {
  action: Action;
  onClose: () => void;
}) {
  const et = action.execution_type;
  if (!et) return null;
  const cfg = executionConfig[et];

  // Shared dismiss on overlay click
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-stone-100 px-5 py-4 flex items-center gap-3">
          <span className="text-2xl">{cfg.icon}</span>
          <div>
            <h3 className="font-semibold text-stone-900">{cfg.label} Action</h3>
            <p className="mt-0.5 text-sm text-stone-500 truncate">{action.title}</p>
          </div>
        </div>

        <div className="px-5 py-5 space-y-4">
          {et === "call" && (
            <>
              <p className="text-sm text-stone-600">
                Call the waiting list or contact a guest directly.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <a
                  href="tel:"
                  className="flex items-center justify-center gap-2 rounded-lg bg-sky-500 px-4 py-3 text-sm font-semibold text-white hover:bg-sky-600"
                >
                  📞 Dial Guest
                </a>
                <button
                  onClick={onClose}
                  className="rounded-lg border border-stone-200 px-4 py-3 text-sm font-medium text-stone-600 hover:bg-stone-50"
                >
                  Open Waiting List →
                </button>
              </div>
            </>
          )}

          {et === "message" && (
            <>
              <p className="text-sm text-stone-600">
                Send a quick message to the team about this action.
              </p>
              <textarea
                rows={3}
                placeholder="Type your message…"
                className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400 resize-none"
                autoFocus
              />
              <div className="flex gap-2 justify-end">
                <button
                  onClick={onClose}
                  className="rounded-md border border-stone-200 px-3 py-1.5 text-sm text-stone-600 hover:bg-stone-50"
                >
                  Cancel
                </button>
                <button
                  onClick={onClose}
                  className="rounded-md bg-violet-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-violet-600"
                >
                  Send via WhatsApp
                </button>
              </div>
            </>
          )}

          {et === "staffing" && (
            <>
              <p className="text-sm text-stone-600">
                Adjust floor-of-house staffing levels for this shift.
              </p>
              <div className="space-y-2">
                {(["FOH", "BOH", "Bar"] as const).map((zone) => (
                  <div key={zone} className="flex items-center justify-between rounded-lg border border-stone-200 px-4 py-2.5">
                    <span className="text-sm font-medium text-stone-700">{zone}</span>
                    <div className="flex items-center gap-3">
                      <button className="h-7 w-7 rounded-full border border-stone-300 text-stone-600 hover:bg-stone-100 text-base leading-none">&minus;</button>
                      <span className="w-4 text-center text-sm font-semibold text-stone-900">—</span>
                      <button className="h-7 w-7 rounded-full border border-stone-300 text-stone-600 hover:bg-stone-100 text-base leading-none">+</button>
                    </div>
                  </div>
                ))}
              </div>
              <button
                onClick={onClose}
                className="w-full rounded-md bg-amber-500 py-2 text-sm font-medium text-white hover:bg-amber-600"
              >
                Confirm Staffing Change
              </button>
            </>
          )}

          {et === "compliance" && (
            <>
              <p className="text-sm text-stone-600">
                Log a compliance check or acknowledge an outstanding item.
              </p>
              <div className="space-y-2">
                {["Temperature logs checked", "Cleaning schedule signed off", "Equipment inspection done"].map((item) => (
                  <label key={item} className="flex items-center gap-3 rounded-lg border border-stone-200 px-4 py-2.5 cursor-pointer hover:bg-stone-50">
                    <input type="checkbox" className="h-4 w-4 rounded border-stone-300 accent-rose-500" />
                    <span className="text-sm text-stone-700">{item}</span>
                  </label>
                ))}
              </div>
              <button
                onClick={onClose}
                className="w-full rounded-md bg-rose-500 py-2 text-sm font-medium text-white hover:bg-rose-600"
              >
                Submit Compliance Log
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Assign modal ──────────────────────────────────────────────────────────────

function AssignModal({
  action,
  onClose,
  onAssigned,
}: {
  action: Action;
  onClose: () => void;
  onAssigned: (name: string) => void;
}) {
  const [name, setName] = useState(action.assigned_to ?? "");
  const [busy, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setErr("Name is required"); return; }
    startTransition(async () => {
      const res = await fetch(`/api/actions/${action.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "assign", assigned_to: name.trim() }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error ?? "Failed to assign");
        return;
      }
      onAssigned(name.trim());
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white shadow-2xl">
        <div className="border-b border-stone-100 px-5 py-4">
          <h3 className="font-semibold text-stone-900">Assign Action</h3>
          <p className="mt-0.5 text-sm text-stone-500 truncate">{action.title}</p>
        </div>
        <form onSubmit={submit} className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1">
              Assigned to
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); setErr(null); }}
              placeholder="e.g. Floor Manager, Thami"
              className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400"
              autoFocus
            />
            {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
          </div>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-stone-200 px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
            >
              {busy ? "Saving…" : "Assign"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Action Card ───────────────────────────────────────────────────────────────

function ActionCard({
  action,
  onMutate,
}: {
  action: Action;
  onMutate: (updated: Action) => void;
}) {
  const [showAssign,  setShowAssign]  = useState(false);
  const [showQuick,   setShowQuick]   = useState(false);
  const [busy, setBusy]               = useState(false);
  const [err, setErr]                 = useState<string | null>(null);

  async function callOp(op: string) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/actions/${action.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op }),
      });
      const j = await res.json();
      if (!res.ok) { setErr(j.error ?? "Request failed"); return; }
      onMutate(j.action);
    } catch {
      setErr("Network error");
    } finally {
      setBusy(false);
    }
  }

  const impact  = impactConfig[action.impact_weight] ?? impactConfig.medium;
  const sc      = statusConfig[action.status]        ?? statusConfig.pending;
  const resTime = resolutionTime(action);

  const execCfg = action.execution_type ? executionConfig[action.execution_type] : null;

  return (
    <>
      {showAssign && (
        <AssignModal
          action={action}
          onClose={() => setShowAssign(false)}
          onAssigned={(name) => {
            onMutate({ ...action, assigned_to: name });
            setShowAssign(false);
          }}
        />
      )}
      {showQuick && (
        <QuickActionModal action={action} onClose={() => setShowQuick(false)} />
      )}

      <div
        className={`rounded-xl border bg-white shadow-sm transition-opacity ${
          action.status === "completed" ? "opacity-60" : ""
        }`}
      >
        {/* Left accent bar by impact */}
        <div
          className={`h-1 rounded-t-xl ${
            action.impact_weight === "critical" ? "bg-red-500"
            : action.impact_weight === "high"   ? "bg-orange-400"
            : action.impact_weight === "medium" ? "bg-amber-400"
            : "bg-stone-300"
          }`}
        />

        <div className="px-4 py-3 space-y-3">
          {/* Header row */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p
                className={`text-sm font-semibold leading-snug ${
                  action.status === "completed" ? "line-through text-stone-400" : "text-stone-900"
                }`}
              >
                {action.title}
              </p>
              {action.description && (
                <p className="mt-0.5 text-xs text-stone-500 line-clamp-2">{action.description}</p>
              )}
            </div>

            {/* Impact badge */}
            <span
              className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${impact.badge}`}
            >
              {impact.label}
            </span>
          </div>

          {/* Execution type chip */}
          {execCfg && (
            <div className="flex items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-500 ring-1 ring-inset ring-stone-200">
                {execCfg.icon} {execCfg.label}
              </span>
            </div>
          )}

          {/* Meta row */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500">
            <span
              className={`inline-flex items-center gap-1 font-medium ${
                action.status === "completed" ? "text-green-600"
                : action.status === "in_progress" ? "text-blue-600"
                : "text-stone-500"
              }`}
            >
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${sc.bar}`}
              />
              {sc.label}
            </span>

            {action.assigned_to ? (
              <span>👤 {action.assigned_to}</span>
            ) : (
              <span className="text-stone-400 italic">Unassigned</span>
            )}

            {action.source_type && (
              <span className="capitalize text-stone-400">{action.source_type}</span>
            )}

            <span className="ml-auto">{relativeTime(action.created_at)}</span>

            {resTime && (
              <span className="text-green-600">✓ {resTime}</span>
            )}
          </div>

          {/* Revenue impact badge — shown only on completed actions with data */}
          {action.status === "completed" && action.revenue_delta !== null && (
            <div className="flex items-center gap-1.5">
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
                  action.revenue_delta >= 0
                    ? "bg-green-50 text-green-700 ring-1 ring-inset ring-green-200"
                    : "bg-red-50 text-red-700 ring-1 ring-inset ring-red-200"
                }`}
              >
                <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                  {action.revenue_delta >= 0 ? (
                    <path fillRule="evenodd" d="M12.577 4.878a.75.75 0 01.919-.53l4.78 1.281a.75.75 0 01.531.919l-1.281 4.78a.75.75 0 01-1.449-.387l.81-3.022a19.407 19.407 0 00-5.594 5.203.75.75 0 01-1.139.093L7 10.06l-4.72 4.72a.75.75 0 01-1.06-1.061l5.25-5.25a.75.75 0 011.06 0l3.074 3.073a20.923 20.923 0 015.545-4.931l-3.042-.815a.75.75 0 01-.53-.919z" clipRule="evenodd" />
                  ) : (
                    <path fillRule="evenodd" d="M1.22 5.222a.75.75 0 011.06 0L7 9.942l3.768-3.769a.75.75 0 011.113.058 20.908 20.908 0 013.813 7.254l1.574-2.727a.75.75 0 011.3.75l-2.475 4.286a.75.75 0 01-1.025.275l-4.287-2.475a.75.75 0 01.75-1.3l2.71 1.565a19.422 19.422 0 00-3.013-6.024L7.53 11.533a.75.75 0 01-1.06 0l-5.25-5.25a.75.75 0 010-1.06z" clipRule="evenodd" />
                  )}
                </svg>
                Impact: {action.revenue_delta >= 0 ? "+" : "-"}R
                {Math.abs(action.revenue_delta).toLocaleString("en-ZA", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                {" "}{action.revenue_delta >= 0 ? "revenue recovered" : "revenue decline"}
              </span>
            </div>
          )}

          {err && (
            <p className="text-xs text-red-600">{err}</p>
          )}

          {/* Action buttons */}
          {action.status !== "completed" && (
            <div className="flex flex-wrap gap-1.5 pt-1 border-t border-stone-100">
              {/* Quick Action — shown when execution_type is set */}
              {execCfg && (
                <button
                  onClick={() => setShowQuick(true)}
                  disabled={busy}
                  title={execCfg.hint}
                  className={`flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-semibold disabled:opacity-40 transition-colors ${execCfg.btnClass}`}
                >
                  <span>{execCfg.icon}</span>
                  {execCfg.label}
                </button>
              )}

              {/* Assign */}
              <button
                onClick={() => setShowAssign(true)}
                disabled={busy}
                className="flex items-center gap-1 rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-40 transition-colors"
              >
                <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10 8a3 3 0 100-6 3 3 0 000 6zM3.465 14.493a1.23 1.23 0 00.41 1.412A9.957 9.957 0 0010 18c2.31 0 4.438-.784 6.131-2.1.43-.333.604-.903.408-1.41a7.002 7.002 0 00-13.074.003z" />
                </svg>
                Assign
              </button>

              {/* Mark In Progress */}
              {action.status === "pending" && (
                <button
                  onClick={() => callOp("start")}
                  disabled={busy}
                  className="flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-40 transition-colors"
                >
                  {busy ? (
                    <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                    </svg>
                  ) : (
                    <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M2 10a8 8 0 1116 0A8 8 0 012 10zm6.39-2.908a.75.75 0 01.766.027l3.5 2.25a.75.75 0 010 1.262l-3.5 2.25A.75.75 0 018 12.25v-4.5a.75.75 0 01.39-.658z" clipRule="evenodd"/>
                    </svg>
                  )}
                  Mark In Progress
                </button>
              )}

              {/* Complete */}
              <button
                onClick={() => callOp("complete")}
                disabled={busy}
                className="flex items-center gap-1 rounded-md border border-green-200 bg-green-50 px-2.5 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100 disabled:opacity-40 transition-colors"
              >
                {busy ? (
                  <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>
                ) : (
                  <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd"/>
                  </svg>
                )}
                Complete
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ── Add Action Form ───────────────────────────────────────────────────────────

function AddActionForm({ onCreated }: { onCreated: (a: Action) => void }) {
  const [open,      setOpen]      = useState(false);
  const [title,     setTitle]     = useState("");
  const [desc,      setDesc]      = useState("");
  const [impact,    setImpact]    = useState<ImpactWeight>("medium");
  const [who,       setWho]       = useState("");
  const [execType,  setExecType]  = useState<ExecutionType | "">("" );
  const [busy,      startT]       = useTransition();
  const [err,       setErr]       = useState<string | null>(null);

  function reset() {
    setTitle(""); setDesc(""); setImpact("medium"); setWho(""); setExecType(""); setErr(null);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setErr("Title is required"); return; }
    startT(async () => {
      const res = await fetch("/api/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title:          title.trim(),
          description:    desc.trim() || undefined,
          impact_weight:  impact,
          assigned_to:    who.trim()  || undefined,
          execution_type: execType    || undefined,
        }),
      });
      const j = await res.json();
      if (!res.ok) { setErr(j.error ?? "Failed to create"); return; }
      onCreated(j.action);
      reset();
      setOpen(false);
    });
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100 transition-colors"
      >
        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
          <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z"/>
        </svg>
        New Action
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-stone-900 mb-3">Create New Action</h3>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <input
            type="text"
            value={title}
            onChange={(e) => { setTitle(e.target.value); setErr(null); }}
            placeholder="Action title…"
            className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400"
            autoFocus
          />
        </div>
        <div>
          <textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="Description (optional)…"
            rows={2}
            className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400 resize-none"
          />
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="block text-xs font-medium text-stone-600 mb-1">Impact</label>
            <select
              value={impact}
              onChange={(e) => setImpact(e.target.value as ImpactWeight)}
              className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm focus:border-amber-400 focus:outline-none"
            >
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-xs font-medium text-stone-600 mb-1">Assign to</label>
            <input
              type="text"
              value={who}
              onChange={(e) => setWho(e.target.value)}
              placeholder="Name or role…"
              className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm focus:border-amber-400 focus:outline-none"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-stone-600 mb-1">Quick Action type <span className="text-stone-400 font-normal">(optional)</span></label>
          <div className="flex gap-1.5 flex-wrap">
            {(["call", "message", "staffing", "compliance"] as ExecutionType[]).map((t) => {
              const c = executionConfig[t];
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setExecType(execType === t ? "" : t)}
                  className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    execType === t
                      ? c.btnClass + " ring-2 ring-offset-1"
                      : "border-stone-200 bg-white text-stone-500 hover:bg-stone-50"
                  }`}
                >
                  {c.icon} {c.label}
                </button>
              );
            })}
          </div>
        </div>
        {err && <p className="text-xs text-red-600">{err}</p>}
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={() => { reset(); setOpen(false); }}
            className="rounded-md border border-stone-200 px-3 py-1.5 text-sm font-medium text-stone-600 hover:bg-stone-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-amber-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create Action"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Performance Bar ───────────────────────────────────────────────────────────

function PerformanceBar({
  pending,
  inProgress,
  completed,
}: {
  pending:    number;
  inProgress: number;
  completed:  number;
}) {
  const total = pending + inProgress + completed;
  if (total === 0) return null;

  const pctCompleted  = Math.round((completed  / total) * 100);
  const pctInProgress = Math.round((inProgress / total) * 100);
  const rate = pctCompleted;

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-stone-600 uppercase tracking-wide">
          Today&apos;s Progress
        </h3>
        <span className="text-2xl font-bold text-stone-900">{rate}%</span>
      </div>

      {/* Stacked progress bar */}
      <div className="flex h-2.5 rounded-full overflow-hidden bg-stone-100">
        {pctCompleted > 0 && (
          <div className="bg-green-500 transition-all" style={{ width: `${pctCompleted}%` }} />
        )}
        {pctInProgress > 0 && (
          <div className="bg-blue-400 transition-all" style={{ width: `${pctInProgress}%` }} />
        )}
      </div>

      <div className="mt-2 flex gap-4 text-xs text-stone-500">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
          {completed} completed
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-blue-400" />
          {inProgress} in progress
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-stone-300" />
          {pending} pending
        </span>
      </div>
    </div>
  );
}

// ── Main Board ────────────────────────────────────────────────────────────────

export default function ActionsBoard({ initial }: { initial: Action[] }) {
  const router = useRouter();
  const [actions, setActions] = useState<Action[]>(initial);
  const [filter,  setFilter]  = useState<ActionStatus | "all">("all");

  function mutateAction(updated: Action) {
    setActions((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
  }

  function addAction(a: Action) {
    setActions((prev) => [a, ...prev]);
  }

  const pending    = actions.filter((a) => a.status === "pending").length;
  const inProgress = actions.filter((a) => a.status === "in_progress").length;
  const completed  = actions.filter((a) => a.status === "completed").length;

  const filtered =
    filter === "all"
      ? actions
      : actions.filter((a) => a.status === filter);

  const sortedFiltered = [...filtered].sort((a, b) => {
    // Sort: in_progress first, then pending, then completed; within each by impact
    const order: Record<ActionStatus, number> = { in_progress: 0, pending: 1, completed: 2 };
    const impactOrder: Record<ImpactWeight, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    return impactOrder[a.impact_weight] - impactOrder[b.impact_weight];
  });

  return (
    <div className="space-y-5">
      {/* Performance bar */}
      <PerformanceBar pending={pending} inProgress={inProgress} completed={completed} />

      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Filter tabs */}
        <div className="flex gap-1 rounded-lg bg-stone-100 p-1">
          {(["all", "pending", "in_progress", "completed"] as const).map((s) => {
            const labels: Record<string, string> = {
              all: `All (${actions.length})`,
              pending: `Pending (${pending})`,
              in_progress: `In Progress (${inProgress})`,
              completed: `Completed (${completed})`,
            };
            return (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  filter === s
                    ? "bg-white text-stone-900 shadow-sm"
                    : "text-stone-500 hover:text-stone-700"
                }`}
              >
                {labels[s]}
              </button>
            );
          })}
        </div>

        <AddActionForm onCreated={addAction} />
      </div>

      {/* Action list */}
      {sortedFiltered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-stone-200 py-12 text-center text-sm text-stone-400">
          {filter === "all"
            ? "No active actions. Create one to get started."
            : `No ${filter.replace("_", " ")} actions.`}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sortedFiltered.map((a) => (
            <ActionCard key={a.id} action={a} onMutate={mutateAction} />
          ))}
        </div>
      )}
    </div>
  );
}
