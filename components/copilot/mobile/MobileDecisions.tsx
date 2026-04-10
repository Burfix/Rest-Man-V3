/**
 * MobileDecisions — Top 3 decisions, mobile optimised.
 *
 * Thumb-friendly: large tap targets for Start / Done / Escalate.
 * Stacked layout. No horizontal scrolling.
 */

"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { GMDecision, GMDecisionSeverity } from "@/lib/copilot/types";

type Props = {
  decisions: GMDecision[];
};

const SEV_STYLE: Record<GMDecisionSeverity, { bg: string; text: string; border: string }> = {
  critical: { bg: "bg-red-950/30",    text: "text-red-400",    border: "border-red-800/40" },
  high:     { bg: "bg-amber-950/20",  text: "text-amber-400",  border: "border-amber-800/30" },
  medium:   { bg: "bg-stone-900/50",  text: "text-stone-500 dark:text-stone-400",  border: "border-stone-700/40" },
  low:      { bg: "bg-stone-900/30",  text: "text-stone-500",  border: "border-stone-800/30" },
};

const RANK_STYLE = [
  "bg-red-500/20 text-red-400 border-red-500/30",
  "bg-amber-500/20 text-amber-400 border-amber-500/30",
  "bg-stone-500/20 text-stone-600 dark:text-stone-300 border-stone-500/30",
];

export default function MobileDecisions({ decisions }: Props) {
  const top = decisions.slice(0, 3);

  if (top.length === 0) {
    return (
      <div className="rounded-xl border border-stone-800/40 bg-stone-900/50 p-4">
        <p className="text-sm text-stone-500">No critical decisions right now.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h2 className="text-xs uppercase tracking-widest text-stone-500 font-medium px-1">
        Do Now
      </h2>
      <div className="space-y-2">
        {top.map((d, i) => (
          <MobileDecisionCard key={d.id} decision={d} rank={i} />
        ))}
      </div>
    </div>
  );
}

function MobileDecisionCard({ decision: d, rank }: { decision: GMDecision; rank: number }) {
  const [status, setStatus] = useState(d.status);
  const [actionId, setActionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const sev = SEV_STYLE[d.severity];

  async function handleAction(targetStatus: "in_progress" | "completed" | "escalated") {
    if (loading) return;
    setLoading(true);
    try {
      if (!actionId) {
        // First interaction — create the action
        const res = await fetch("/api/actions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: d.title,
            direct_instruction: d.directInstruction,
            category: d.category,
            severity: d.severity,
            status: targetStatus,
            owner: d.owner,
            source_type: "copilot",
            expected_impact_text: d.expectedImpactText,
            expected_impact_value: d.expectedImpactValue,
          }),
        });
        if (res.ok) {
          const json = await res.json();
          setActionId(json.action.id);
          setStatus(targetStatus === "in_progress" ? "in_progress" : targetStatus);
        }
      } else {
        // Subsequent interaction — PATCH existing action
        const res = await fetch(`/api/actions/${actionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: targetStatus }),
        });
        if (res.ok) {
          setStatus(targetStatus);
        }
      }
    } catch {
      // Silent fallback
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={cn("rounded-xl border p-4 space-y-3", sev.bg, sev.border)}>
      {/* Top: rank + title + severity */}
      <div className="flex items-start gap-3">
        <span className={cn(
          "flex-shrink-0 h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold border",
          RANK_STYLE[rank] ?? RANK_STYLE[2],
        )}>
          {rank + 1}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-stone-100 leading-tight">
              {d.title}
            </h3>
            <span className={cn("text-[10px] uppercase tracking-wider font-bold flex-shrink-0", sev.text)}>
              {d.severity}
            </span>
          </div>
          <p className="text-xs text-stone-500 dark:text-stone-400 mt-1 leading-snug">
            {d.directInstruction}
          </p>
        </div>
      </div>

      {/* Impact one-liner */}
      <div className="text-xs text-stone-500">
        <span className="text-emerald-400">{d.expectedImpactText}</span>
        {d.owner && (
          <span className="ml-2 text-stone-500">· {d.owner}</span>
        )}
      </div>

      {/* Action buttons — large tap targets */}
      <div className="flex gap-2">
        {status === "pending" && (
          <button
            onClick={() => handleAction("in_progress")}
            disabled={loading}
            className="flex-1 h-10 rounded-lg bg-stone-100 dark:bg-stone-800 border border-stone-300 dark:border-stone-700 text-sm font-medium text-stone-700 dark:text-stone-200 active:bg-stone-700 transition disabled:opacity-50"
          >
            Start
          </button>
        )}
        {(status === "pending" || status === "in_progress") && (
          <button
            onClick={() => handleAction("completed")}
            disabled={loading}
            className="flex-1 h-10 rounded-lg bg-emerald-900/40 border border-emerald-800/40 text-sm font-medium text-emerald-300 active:bg-emerald-900/60 transition disabled:opacity-50"
          >
            Done
          </button>
        )}
        {status !== "completed" && status !== "escalated" && (
          <button
            onClick={() => handleAction("escalated")}
            disabled={loading}
            className="h-10 px-3 rounded-lg bg-red-900/30 border border-red-800/30 text-sm font-medium text-red-300 active:bg-red-900/50 transition disabled:opacity-50"
          >
            Escalate
          </button>
        )}
        {(status === "completed" || status === "escalated") && (
          <div className={cn(
            "flex-1 h-10 rounded-lg flex items-center justify-center text-sm font-medium",
            status === "completed" ? "bg-emerald-900/30 text-emerald-400" : "bg-red-900/30 text-red-400",
          )}>
            {status === "completed" ? "✓ Done" : "↑ Escalated"}
          </div>
        )}
      </div>
    </div>
  );
}
