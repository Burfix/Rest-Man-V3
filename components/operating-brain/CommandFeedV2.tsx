/**
 * CommandFeed — The heart of the Operating Brain.
 *
 * Each decision card includes Execute, Assign, Complete buttons
 * that create/update actions via the /api/actions endpoints.
 * Shows consequence if ignored. Feels like a control panel, not a report.
 */

"use client";

import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import type { OperatingDecision } from "@/services/decision-engine";

type ActionState = {
  id?: string;
  status: "idle" | "pending" | "in_progress" | "completed";
};

type Props = {
  decisions: OperatingDecision[];
};

const SEV_STYLES: Record<
  OperatingDecision["severity"],
  { badge: string; border: string; dot: string }
> = {
  critical: {
    badge: "bg-red-500/15 text-red-400 border-red-500/20",
    border: "border-l-red-500",
    dot: "bg-red-400 animate-pulse",
  },
  high: {
    badge: "bg-orange-500/15 text-orange-400 border-orange-500/20",
    border: "border-l-orange-400",
    dot: "bg-orange-400",
  },
  medium: {
    badge: "bg-amber-500/15 text-amber-400 border-amber-500/20",
    border: "border-l-amber-400",
    dot: "bg-amber-400",
  },
  low: {
    badge: "bg-stone-500/15 text-stone-400 border-stone-600/20",
    border: "border-l-stone-600",
    dot: "bg-stone-500",
  },
};

const CAT_LABEL: Record<OperatingDecision["category"], string> = {
  revenue: "Revenue",
  labour: "Labour",
  inventory: "Inventory",
  maintenance: "Maintenance",
  compliance: "Compliance",
  service: "Service",
  forecast: "Forecast",
};

const CAT_TO_ACTION_CAT: Record<string, string> = {
  revenue: "revenue",
  labour: "labour",
  inventory: "stock",
  maintenance: "maintenance",
  compliance: "compliance",
  service: "service",
  forecast: "revenue",
};

function ConfidencePips({ level }: { level?: "low" | "medium" | "high" }) {
  if (!level) return null;
  const fill = level === "high" ? 3 : level === "medium" ? 2 : 1;
  return (
    <span className="flex items-center gap-0.5 ml-2" title={`${level} confidence`}>
      {[1, 2, 3].map((n) => (
        <span
          key={n}
          className={cn(
            "h-1 w-3 rounded-full",
            n <= fill ? "bg-emerald-500/60" : "bg-stone-700",
          )}
        />
      ))}
    </span>
  );
}

function ImpactPill({ impact }: { impact: NonNullable<OperatingDecision["impact"]> }) {
  const styles: Record<string, string> = {
    revenue_protected: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    cost_saved: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    service_risk: "bg-red-500/10 text-red-400 border-red-500/20",
    compliance_risk: "bg-rose-500/10 text-rose-400 border-rose-500/20",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium border",
        styles[impact.type] ?? "bg-stone-800 text-stone-400",
      )}
    >
      {impact.label}
    </span>
  );
}

function ConsequenceLine({ decision }: { decision: OperatingDecision }) {
  if (!decision.impact?.value && !decision.impact?.label) return null;
  const riskValue = decision.impact?.value;
  return (
    <div className="mt-2 px-2.5 py-1.5 rounded bg-red-950/30 border border-red-900/30">
      <span className="text-[10px] uppercase tracking-wider text-red-400/80 font-medium">
        If ignored →{" "}
      </span>
      <span className="text-xs text-red-300/90">
        {riskValue
          ? `R${riskValue.toLocaleString("en-ZA")} at risk. `
          : ""}
        {decision.impact?.label}
      </span>
    </div>
  );
}

export default function CommandFeed({ decisions }: Props) {
  // Track action state per decision by decision id
  const [actionStates, setActionStates] = useState<Record<string, ActionState>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const updateState = useCallback((decId: string, patch: Partial<ActionState>) => {
    setActionStates((prev) => ({
      ...prev,
      [decId]: { ...prev[decId], ...patch },
    }));
  }, []);

  // Execute: Create an action from a decision
  const handleExecute = useCallback(
    async (d: OperatingDecision) => {
      setLoadingId(d.id);
      try {
        const res = await fetch("/api/actions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: d.title,
            description: `${d.explanation}\n\nRecommended: ${d.action}`,
            impact_weight: d.severity === "critical" ? "critical" : d.severity,
            category: CAT_TO_ACTION_CAT[d.category] || "general",
            source_type: "operating_brain",
            source_module: "command_feed",
            expected_impact: d.impact?.label,
            why_it_matters: d.impact?.value
              ? `R${d.impact.value.toLocaleString("en-ZA")} at stake`
              : d.explanation,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          updateState(d.id, { id: data.action?.id, status: "pending" });
        }
      } finally {
        setLoadingId(null);
      }
    },
    [updateState],
  );

  // Start: Move action to in_progress
  const handleStart = useCallback(
    async (d: OperatingDecision) => {
      const actionId = actionStates[d.id]?.id;
      if (!actionId) return;
      setLoadingId(d.id);
      try {
        const res = await fetch(`/api/actions/${actionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ op: "start" }),
        });
        if (res.ok) updateState(d.id, { status: "in_progress" });
      } finally {
        setLoadingId(null);
      }
    },
    [actionStates, updateState],
  );

  // Complete: Mark action as completed
  const handleComplete = useCallback(
    async (d: OperatingDecision) => {
      const actionId = actionStates[d.id]?.id;
      if (!actionId) return;
      setLoadingId(d.id);
      try {
        const res = await fetch(`/api/actions/${actionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ op: "complete" }),
        });
        if (res.ok) updateState(d.id, { status: "completed" });
      } finally {
        setLoadingId(null);
      }
    },
    [actionStates, updateState],
  );

  if (decisions.length === 0) {
    return (
      <div className="rounded-xl border border-stone-800/40 bg-stone-900/50 px-5 py-8 text-center">
        <p className="text-sm text-stone-500">No active decisions — operations are clear</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h2 className="text-xs uppercase tracking-widest text-stone-500 font-medium px-1">
        Command Feed
      </h2>
      <div className="space-y-2">
        {decisions.map((d) => {
          const sev = SEV_STYLES[d.severity];
          const state = actionStates[d.id] ?? { status: "idle" };
          const busy = loadingId === d.id;
          const isDone = state.status === "completed";

          return (
            <div
              key={d.id}
              className={cn(
                "rounded-lg border border-stone-800/40 bg-stone-900/50 border-l-[3px] px-4 py-3.5 transition-opacity",
                sev.border,
                isDone && "opacity-50",
              )}
            >
              {/* Header row */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider border",
                      sev.badge,
                    )}
                  >
                    {d.severity}
                  </span>
                  <span className="text-[10px] text-stone-500 uppercase tracking-wider">
                    {CAT_LABEL[d.category]}
                  </span>
                  {isDone && (
                    <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                      Done
                    </span>
                  )}
                </div>
                <div className="flex items-center">
                  {d.due && (
                    <span className="text-[10px] text-stone-500 font-mono">
                      Due: {d.due}
                    </span>
                  )}
                  <ConfidencePips level={d.confidence} />
                </div>
              </div>

              {/* Title */}
              <h3 className="mt-2 text-sm font-semibold text-stone-100 leading-snug">
                {d.title}
              </h3>

              {/* Explanation */}
              <p className="mt-1 text-xs text-stone-400 leading-relaxed">
                {d.explanation}
              </p>

              {/* Action */}
              <div className="mt-2.5 flex items-start gap-2">
                <span className="text-[10px] uppercase tracking-wider text-stone-500 font-medium shrink-0 mt-0.5">
                  Action
                </span>
                <span className="text-xs text-stone-300 font-medium">
                  {d.action}
                </span>
              </div>

              {/* Impact pill */}
              {d.impact && (
                <div className="mt-2 flex items-center gap-2">
                  <ImpactPill impact={d.impact} />
                </div>
              )}

              {/* Consequence line */}
              <ConsequenceLine decision={d} />

              {/* Execution buttons */}
              {!isDone && (
                <div className="mt-3 flex items-center gap-2 border-t border-stone-800/40 pt-3">
                  {state.status === "idle" && (
                    <button
                      disabled={busy}
                      onClick={() => handleExecute(d)}
                      className={cn(
                        "rounded-md px-3 py-1.5 text-[11px] font-semibold transition-colors",
                        "bg-sky-600/80 text-white hover:bg-sky-500/90",
                        busy && "opacity-50 cursor-not-allowed",
                      )}
                    >
                      {busy ? "Creating…" : "Execute"}
                    </button>
                  )}

                  {state.status === "pending" && (
                    <>
                      <button
                        disabled={busy}
                        onClick={() => handleStart(d)}
                        className={cn(
                          "rounded-md px-3 py-1.5 text-[11px] font-semibold transition-colors",
                          "bg-amber-600/80 text-white hover:bg-amber-500/90",
                          busy && "opacity-50 cursor-not-allowed",
                        )}
                      >
                        {busy ? "Starting…" : "Start"}
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => handleComplete(d)}
                        className={cn(
                          "rounded-md px-3 py-1.5 text-[11px] font-semibold transition-colors",
                          "bg-emerald-600/80 text-white hover:bg-emerald-500/90",
                          busy && "opacity-50 cursor-not-allowed",
                        )}
                      >
                        Complete
                      </button>
                    </>
                  )}

                  {state.status === "in_progress" && (
                    <button
                      disabled={busy}
                      onClick={() => handleComplete(d)}
                      className={cn(
                        "rounded-md px-3 py-1.5 text-[11px] font-semibold transition-colors",
                        "bg-emerald-600/80 text-white hover:bg-emerald-500/90",
                        busy && "opacity-50 cursor-not-allowed",
                      )}
                    >
                      {busy ? "Completing…" : "Complete"}
                    </button>
                  )}

                  <span className="text-[10px] text-stone-600 ml-auto">
                    {state.status === "idle" && "→ Create action from this decision"}
                    {state.status === "pending" && "Action created — ready to begin"}
                    {state.status === "in_progress" && "In progress — mark when done"}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
