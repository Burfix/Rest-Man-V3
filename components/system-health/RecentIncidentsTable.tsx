"use client";

import { Fragment, useState } from "react";
import { StatusBadge } from "./StatusBadge";
import type { SystemIncident } from "@/lib/system-health/types";

interface RecentIncidentsTableProps {
  incidents: SystemIncident[];
}

function formatTs(iso: string): string {
  return new Date(iso).toLocaleString("en-ZA", {
    month:  "short",
    day:    "numeric",
    hour:   "2-digit",
    minute: "2-digit",
  });
}

// ── Action buttons ─────────────────────────────────────────────────────────────

function AcknowledgeButton({
  incidentId,
  onAcknowledged,
}: {
  incidentId: string;
  onAcknowledged: () => void;
}) {
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");

  async function handle() {
    setState("loading");
    try {
      const res = await fetch(`/api/incidents/${incidentId}/acknowledge`, { method: "POST" });
      if (res.ok) { setState("done"); onAcknowledged(); }
      else setState("idle");
    } catch {
      setState("idle");
    }
  }

  if (state === "done") return null;

  return (
    <button
      onClick={handle}
      disabled={state === "loading"}
      className="rounded px-2.5 py-1 text-xs font-medium bg-indigo-50 dark:bg-indigo-950/40 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/60 transition-colors disabled:opacity-50"
    >
      {state === "loading" ? "…" : "Ack"}
    </button>
  );
}

function ResolveButton({
  incidentId,
  onResolved,
}: {
  incidentId: string;
  onResolved: () => void;
}) {
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");

  async function handle() {
    setState("loading");
    try {
      const res = await fetch(`/api/incidents/${incidentId}/resolve`, { method: "POST" });
      if (res.ok) { setState("done"); onResolved(); }
      else setState("idle");
    } catch {
      setState("idle");
    }
  }

  if (state === "done") return null;

  return (
    <button
      onClick={handle}
      disabled={state === "loading"}
      className="rounded px-2.5 py-1 text-xs font-medium bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-300 transition-colors disabled:opacity-50"
    >
      {state === "loading" ? "…" : "Resolve"}
    </button>
  );
}

const ESCALATION_NEXT: Record<string, string> = {
  normal:   "elevated",
  elevated: "urgent",
};

const ESCALATION_BADGE_CLASSES: Record<string, string> = {
  elevated: "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800/60",
  urgent:   "bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800/60",
};

function EscalateButton({
  incidentId,
  escalationLevel,
  onEscalated,
}: {
  incidentId:      string;
  escalationLevel: string;
  onEscalated:     (level: string) => void;
}) {
  const nextLevel = ESCALATION_NEXT[escalationLevel];
  const [state, setState] = useState<"idle" | "loading">("idle");

  if (!nextLevel) return null; // already at "urgent"

  async function handle() {
    setState("loading");
    try {
      const res = await fetch(`/api/incidents/${incidentId}/escalate`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ escalationLevel: nextLevel }),
      });
      if (res.ok) onEscalated(nextLevel);
    } finally {
      setState("idle");
    }
  }

  return (
    <button
      onClick={handle}
      disabled={state === "loading"}
      className="rounded px-2.5 py-1 text-xs font-medium bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-900/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800/60 transition-colors disabled:opacity-50"
    >
      {state === "loading" ? "…" : `↑ ${nextLevel}`}
    </button>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function RecentIncidentsTable({
  incidents: initialIncidents,
}: RecentIncidentsTableProps) {
  const [incidents, setIncidents] = useState(initialIncidents);

  // Notes editor state: which rows have the textarea expanded, and their draft text
  const [notesOpen, setNotesOpen]     = useState<Set<string>>(new Set());
  const [notesDraft, setNotesDraft]   = useState<Record<string, string>>({});
  const [notesSaving, setNotesSaving] = useState<Set<string>>(new Set());

  function markAcknowledged(id: string) {
    setIncidents(prev =>
      prev.map(inc =>
        inc.id === id
          ? { ...inc, status: "acknowledged" as const, acknowledgedAt: new Date().toISOString() }
          : inc,
      ),
    );
  }

  function markResolved(id: string) {
    setIncidents(prev =>
      prev.map(inc =>
        inc.id === id
          ? { ...inc, status: "resolved" as const, resolvedAt: new Date().toISOString() }
          : inc,
      ),
    );
  }

  function markEscalated(id: string, level: string) {
    setIncidents(prev =>
      prev.map(inc =>
        inc.id === id
          ? { ...inc, escalationLevel: level as "normal" | "elevated" | "urgent" }
          : inc,
      ),
    );
  }

  function toggleNotes(id: string, currentNotes: string | null | undefined) {
    setNotesOpen(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        setNotesDraft(d => ({ ...d, [id]: d[id] ?? currentNotes ?? "" }));
      }
      return next;
    });
  }

  async function saveNotes(id: string) {
    const notes = notesDraft[id] ?? "";
    setNotesSaving(prev => new Set(prev).add(id));
    try {
      await fetch(`/api/incidents/${id}/notes`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ notes }),
      });
      setIncidents(prev =>
        prev.map(inc => (inc.id === id ? { ...inc, operatorNotes: notes } : inc)),
      );
      setNotesOpen(prev => { const next = new Set(prev); next.delete(id); return next; });
    } finally {
      setNotesSaving(prev => { const next = new Set(prev); next.delete(id); return next; });
    }
  }

  const unresolvedCount = incidents.filter(i => i.status !== "resolved").length;

  return (
    <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
      <div className="border-b border-zinc-200 dark:border-zinc-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Recent Incidents</h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              Platform events logged by the system or operators.
            </p>
          </div>
          {unresolvedCount > 0 && (
            <span className="rounded-full bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/60 px-2 py-0.5 text-xs font-semibold text-red-700 dark:text-red-400">
              {unresolvedCount} unresolved
            </span>
          )}
        </div>
      </div>

      {incidents.length === 0 ? (
        <div className="px-6 py-10 text-center">
          <p className="text-sm text-zinc-500">No incidents recorded.</p>
          <p className="mt-1 text-xs text-zinc-400">System has been operating without logged incidents.</p>
        </div>
      ) : (
        <>
          {/* ── Desktop table ── */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 dark:border-zinc-800">
                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wide">Time</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wide">Severity</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wide">Source</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wide">Summary</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wide">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {incidents.map(incident => (
                  <Fragment key={incident.id}>
                    <tr className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors">
                      <td className="px-6 py-3 text-xs text-zinc-500 dark:text-zinc-400 font-mono whitespace-nowrap">
                        {formatTs(incident.createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={incident.severity} />
                      </td>
                      <td className="px-4 py-3 text-xs text-zinc-500 dark:text-zinc-400">
                        {incident.source}
                      </td>
                      <td className="px-4 py-3 text-xs text-zinc-700 dark:text-zinc-300 max-w-xs">
                        {incident.summary}
                        {incident.operatorNotes && !notesOpen.has(incident.id) && (
                          <p className="mt-1 text-zinc-400 truncate italic">{incident.operatorNotes}</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <StatusBadge status={incident.status} dot={false} />
                          {incident.escalationLevel && incident.escalationLevel !== "normal" && (
                            <span
                              className={`rounded-full border px-1.5 py-0 text-[10px] font-semibold ${ESCALATION_BADGE_CLASSES[incident.escalationLevel] ?? ""}`}
                            >
                              {incident.escalationLevel}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-3">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {incident.status === "open" && (
                            <AcknowledgeButton
                              incidentId={incident.id}
                              onAcknowledged={() => markAcknowledged(incident.id)}
                            />
                          )}
                          {incident.status !== "resolved" && (
                            <ResolveButton
                              incidentId={incident.id}
                              onResolved={() => markResolved(incident.id)}
                            />
                          )}
                          {incident.status !== "resolved" && (
                            <EscalateButton
                              incidentId={incident.id}
                              escalationLevel={incident.escalationLevel ?? "normal"}
                              onEscalated={level => markEscalated(incident.id, level)}
                            />
                          )}
                          {incident.status !== "resolved" && (
                            <button
                              onClick={() => toggleNotes(incident.id, incident.operatorNotes)}
                              className="rounded px-2.5 py-1 text-xs font-medium bg-zinc-50 dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-500 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700 transition-colors"
                            >
                              {notesOpen.has(incident.id) ? "Close" : "Notes"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {/* Inline notes editor row */}
                    {notesOpen.has(incident.id) && (
                      <tr className="bg-zinc-50 dark:bg-zinc-800/60">
                        <td colSpan={6} className="px-6 py-3">
                          <div className="flex flex-col gap-2">
                            <textarea
                              value={notesDraft[incident.id] ?? ""}
                              onChange={e =>
                                setNotesDraft(d => ({ ...d, [incident.id]: e.target.value }))
                              }
                              maxLength={2000}
                              rows={3}
                              placeholder="Add operator notes…"
                              className="w-full rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-xs text-zinc-700 dark:text-zinc-300 placeholder-zinc-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 resize-y"
                            />
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => saveNotes(incident.id)}
                                disabled={notesSaving.has(incident.id)}
                                className="rounded px-2.5 py-1 text-xs font-medium bg-indigo-600 hover:bg-indigo-700 text-white transition-colors disabled:opacity-50"
                              >
                                {notesSaving.has(incident.id) ? "Saving…" : "Save notes"}
                              </button>
                              <button
                                onClick={() => toggleNotes(incident.id, undefined)}
                                className="rounded px-2.5 py-1 text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Mobile cards ── */}
          <div className="sm:hidden divide-y divide-zinc-100 dark:divide-zinc-800">
            {incidents.map(incident => (
              <div key={incident.id} className="px-4 py-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <StatusBadge status={incident.severity} />
                    <StatusBadge status={incident.status} dot={false} />
                    {incident.escalationLevel && incident.escalationLevel !== "normal" && (
                      <span
                        className={`rounded-full border px-1.5 py-0 text-[10px] font-semibold ${ESCALATION_BADGE_CLASSES[incident.escalationLevel] ?? ""}`}
                      >
                        {incident.escalationLevel}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-zinc-400 font-mono">{formatTs(incident.createdAt)}</span>
                </div>
                <p className="text-xs text-zinc-700 dark:text-zinc-300">{incident.summary}</p>
                <p className="text-xs text-zinc-400">{incident.source}</p>
                {incident.operatorNotes && !notesOpen.has(incident.id) && (
                  <p className="text-xs text-zinc-400 italic">{incident.operatorNotes}</p>
                )}
                <div className="flex items-center gap-1.5 flex-wrap pt-1">
                  {incident.status === "open" && (
                    <AcknowledgeButton
                      incidentId={incident.id}
                      onAcknowledged={() => markAcknowledged(incident.id)}
                    />
                  )}
                  {incident.status !== "resolved" && (
                    <ResolveButton
                      incidentId={incident.id}
                      onResolved={() => markResolved(incident.id)}
                    />
                  )}
                  {incident.status !== "resolved" && (
                    <EscalateButton
                      incidentId={incident.id}
                      escalationLevel={incident.escalationLevel ?? "normal"}
                      onEscalated={level => markEscalated(incident.id, level)}
                    />
                  )}
                  {incident.status !== "resolved" && (
                    <button
                      onClick={() => toggleNotes(incident.id, incident.operatorNotes)}
                      className="rounded px-2.5 py-1 text-xs font-medium bg-zinc-50 dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-500 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700 transition-colors"
                    >
                      {notesOpen.has(incident.id) ? "Close" : "Notes"}
                    </button>
                  )}
                </div>
                {notesOpen.has(incident.id) && (
                  <div className="flex flex-col gap-2 pt-1">
                    <textarea
                      value={notesDraft[incident.id] ?? ""}
                      onChange={e =>
                        setNotesDraft(d => ({ ...d, [incident.id]: e.target.value }))
                      }
                      maxLength={2000}
                      rows={3}
                      placeholder="Add operator notes…"
                      className="w-full rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-xs text-zinc-700 dark:text-zinc-300 placeholder-zinc-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 resize-y"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => saveNotes(incident.id)}
                        disabled={notesSaving.has(incident.id)}
                        className="rounded px-2.5 py-1 text-xs font-medium bg-indigo-600 hover:bg-indigo-700 text-white transition-colors disabled:opacity-50"
                      >
                        {notesSaving.has(incident.id) ? "Saving…" : "Save notes"}
                      </button>
                      <button
                        onClick={() => toggleNotes(incident.id, undefined)}
                        className="rounded px-2.5 py-1 text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
