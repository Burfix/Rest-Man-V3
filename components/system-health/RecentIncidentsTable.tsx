"use client";

import { useState } from "react";
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

function ResolveButton({ incidentId, onResolved }: { incidentId: string; onResolved: () => void }) {
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");

  async function handleResolve() {
    setState("loading");
    try {
      await fetch(`/api/system-health/incidents/${incidentId}/resolve`, { method: "POST" });
      setState("done");
      onResolved();
    } catch {
      setState("idle");
    }
  }

  if (state === "done") return null;

  return (
    <button
      onClick={handleResolve}
      disabled={state === "loading"}
      className="rounded px-2.5 py-1 text-xs font-medium bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-300 transition-colors disabled:opacity-50"
    >
      {state === "loading" ? "…" : "Resolve"}
    </button>
  );
}

export default function RecentIncidentsTable({ incidents: initialIncidents }: RecentIncidentsTableProps) {
  const [incidents, setIncidents] = useState(initialIncidents);

  function markResolved(id: string) {
    setIncidents(prev =>
      prev.map(inc =>
        inc.id === id
          ? { ...inc, status: "resolved" as const, resolvedAt: new Date().toISOString() }
          : inc,
      ),
    );
  }

  const openCount = incidents.filter(i => i.status !== "resolved").length;

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
          {openCount > 0 && (
            <span className="rounded-full bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/60 px-2 py-0.5 text-xs font-semibold text-red-700 dark:text-red-400">
              {openCount} open
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
          {/* Desktop */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 dark:border-zinc-800">
                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wide">Time</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wide">Severity</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wide">Source</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wide">Summary</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wide">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wide"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {incidents.map(incident => (
                  <tr key={incident.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors">
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
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={incident.status} dot={false} />
                    </td>
                    <td className="px-6 py-3">
                      {incident.status !== "resolved" && (
                        <ResolveButton
                          incidentId={incident.id}
                          onResolved={() => markResolved(incident.id)}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile */}
          <div className="sm:hidden divide-y divide-zinc-100 dark:divide-zinc-800">
            {incidents.map(incident => (
              <div key={incident.id} className="px-4 py-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <StatusBadge status={incident.severity} />
                    <StatusBadge status={incident.status} dot={false} />
                  </div>
                  <span className="text-xs text-zinc-400 font-mono">{formatTs(incident.createdAt)}</span>
                </div>
                <p className="text-xs text-zinc-700 dark:text-zinc-300">{incident.summary}</p>
                <p className="text-xs text-zinc-400">{incident.source}</p>
                {incident.status !== "resolved" && (
                  <ResolveButton
                    incidentId={incident.id}
                    onResolved={() => markResolved(incident.id)}
                  />
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
