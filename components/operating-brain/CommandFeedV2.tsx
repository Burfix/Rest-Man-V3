/**
 * CommandFeed — The heart of the Operating Brain.
 *
 * War-room aesthetic: no buttons, terminal-style action links,
 * borders by severity, IF IGNORED dim until hover.
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
  maintenance: "Maintenance",
  compliance: "Compliance",
  service: "Service",
  forecast: "Forecast",
};

const CAT_TO_ACTION_CAT: Record<string, string> = {
  revenue: "revenue",
  labour: "labour",
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
            "h-1 w-3 rounded-none",
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
        "inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-[10px] font-medium border",
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
    <div className="mt-2 px-2.5 py-1.5 rounded-sm bg-red-950/30 border border-red-900/30 opacity-40 group-hover:opacity-100 transition-opacity duration-200">
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
  const [actionStates, setActionStates] = useState<Record<string, ActionState>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const updateState = useCallback((decId: string, patch: Partial<ActionState>) => {
    setActionStates((prev) => ({
      ...prev,
      [decId]: { ...prev[decId], ...patch },
    }));
  }, []);

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
      <div className="rounded border border-stone-800/40 bg-stone-900/50 px-5 py-8 text-center">
        <p className="text-sm text-stone-500 font-mono">— operations clear —</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h2 className="text-[9px] uppercase tracking-[0.2em] text-stone-600 font-semibold px-1">
        Command Feed
      </h2>
      <div className="space-y-1.5">
        {decisions.map((d) => {
          const sev = SEV_STYLES[d.severity];
          const state = actionStates[d.id] ?? { status: "idle" };
          const busy = loadingId === d.id;
          const isDone = state.status === "completed";

          return (
            <div
              key={d.id}
              className={cn(
                "group rounded-sm border border-stone-800/40 bg-stone-900/50 border-l-[3px] px-4 py-3 transition-opacity",
                sev.border,
                isDone && "opacity-40",
              )}
            >
              {/* Header row */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={cn(
                      "rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider border",
                      sev.badge,
                    )}
                  >
                    {d.severity}
                  </span>
                  <span className="text-[10px] text-stone-600 uppercase tracking-wider">
                    {CAT_LABEL[d.category]}
                  </span>
                  {isDone && (
                    <span className="rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                      Done
                    </span>
                  )}
                </div>
                <div className="flex items-center shrink-0">
                  {d.due && (
                    <span className="text-[10px] text-stone-600 font-mono">
                      {d.due}
                    </span>
                  )}
                  <ConfidencePips level={d.confidence} />
                </div>
              </div>

              {/* Title */}
              <h3 className="mt-1.5 text-sm font-semibold text-stone-100 leading-snug">
                {d.title}
              </h3>

              {/* Explanation */}
              <p className="mt-1 text-[11px] text-stone-500 leading-snug">
                {d.explanation}
              </p>

              {/* Action — bold + larger */}
              <div className="mt-2 flex items-start gap-2">
                <span className="text-[9px] uppercase tracking-widest text-stone-600 font-semibold shrink-0 mt-0.5">
                  ACTION
                </span>
                <span className="text-sm text-stone-100 font-bold leading-snug">
                  {d.action}
                </span>
              </div>

              {/* Impact pill */}
              {d.impact && (
                <div className="mt-1.5 flex items-center gap-2">
                  <ImpactPill impact={d.impact} />
                </div>
              )}

              {/* Consequence line — dim until hovered */}
              <ConsequenceLine decision={d} />

              {/* Terminal action links */}
              {!isDone && (
                <div className="mt-2 flex items-center gap-4 font-mono text-[11px]">
                  {state.status === "idle" && (
                    <button
                      disabled={busy}
                      onClick={() => handleExecute(d)}
                      className="text-stone-600 hover:text-amber-400 transition-colors disabled:opacity-30"
                    >
                      {busy ? "→ creating..." : "→ execute"}
                    </button>
                  )}
                  {state.status === "pending" && (
                    <>
                      <button
                        disabled={busy}
                        onClick={() => handleStart(d)}
                        className="text-stone-600 hover:text-blue-400 transition-colors disabled:opacity-30"
                      >
                        {busy ? "→ starting..." : "→ start"}
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => handleComplete(d)}
                        className="text-stone-600 hover:text-emerald-400 transition-colors disabled:opacity-30"
                      >
                        → complete
                      </button>
                    </>
                  )}
                  {state.status === "in_progress" && (
                    <button
                      disabled={busy}
                      onClick={() => handleComplete(d)}
                      className="text-stone-600 hover:text-emerald-400 transition-colors disabled:opacity-30"
                    >
                      {busy ? "→ completing..." : "→ complete"}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
