/**
 * TopDecisions — Ranked 1-3 executable decisions from the GM Co-Pilot.
 *
 * Each card shows: rank badge, direct instruction, consequence,
 * expected impact, owner, severity, and action buttons.
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
  medium:   { bg: "bg-stone-900/50",  text: "text-stone-400",  border: "border-stone-700/40" },
  low:      { bg: "bg-stone-900/30",  text: "text-stone-500",  border: "border-stone-800/30" },
};

const RANK_STYLE = [
  "bg-red-500/20 text-red-400 border-red-500/30",
  "bg-amber-500/20 text-amber-400 border-amber-500/30",
  "bg-stone-500/20 text-stone-300 border-stone-500/30",
];

export default function TopDecisions({ decisions }: Props) {
  const top = decisions.slice(0, 3);
  if (top.length === 0) {
    return (
      <div className="rounded-xl border border-stone-800/40 bg-stone-900/50 p-5">
        <h2 className="text-xs uppercase tracking-widest text-stone-500 font-medium">
          Top Decisions
        </h2>
        <p className="text-sm text-stone-500 mt-3">No critical decisions right now. Operations on track.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h2 className="text-xs uppercase tracking-widest text-stone-500 font-medium px-1">
        Top Decisions
      </h2>
      <div className="space-y-2">
        {top.map((d, i) => (
          <DecisionCard key={d.id} decision={d} rank={i} />
        ))}
      </div>
    </div>
  );
}

function DecisionCard({ decision: d, rank }: { decision: GMDecision; rank: number }) {
  const [status, setStatus] = useState(d.status);
  const sev = SEV_STYLE[d.severity];

  async function handleAction(op: "start" | "complete") {
    try {
      const res = await fetch(`/api/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: d.title,
          description: d.directInstruction,
          category: d.category,
          priority: d.severity,
          status: op === "start" ? "in_progress" : "done",
          source: "copilot",
        }),
      });
      if (res.ok) {
        setStatus(op === "start" ? "in_progress" : "completed");
      }
    } catch {
      // Silent fallback
    }
  }

  return (
    <div className={cn("rounded-xl border p-4 space-y-3", sev.bg, sev.border)}>
      <div className="flex items-start justify-between gap-3">
        {/* Rank badge + title */}
        <div className="flex items-start gap-3 min-w-0">
          <span className={cn(
            "flex-shrink-0 h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold border",
            RANK_STYLE[rank] ?? RANK_STYLE[2],
          )}>
            {rank + 1}
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-stone-100 leading-tight">
              {d.title}
            </h3>
            <p className="text-sm text-stone-300 mt-1 leading-snug">
              {d.directInstruction}
            </p>
          </div>
        </div>

        {/* Severity badge */}
        <span className={cn("text-[10px] uppercase tracking-wider font-bold flex-shrink-0", sev.text)}>
          {d.severity}
        </span>
      </div>

      {/* Why + Impact row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-stone-400">
        <div>
          <span className="text-stone-500">Why: </span>
          {d.whyItMatters}
        </div>
        <div>
          <span className="text-stone-500">Impact: </span>
          <span className="text-emerald-400">{d.expectedImpactText}</span>
        </div>
      </div>

      {/* Bottom row: owner + consequence + action */}
      <div className="flex items-center justify-between border-t border-stone-800/30 pt-2">
        <div className="flex items-center gap-3 text-xs text-stone-500">
          {d.owner && (
            <span className="bg-stone-800/50 px-2 py-0.5 rounded text-stone-400">
              {d.owner}
            </span>
          )}
          {d.dueAt && d.dueAt !== "now" && (
            <span>Due: {d.dueAt}</span>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          {status === "pending" && (
            <button
              onClick={() => handleAction("start")}
              className="text-xs font-medium bg-stone-800 hover:bg-stone-700 text-stone-200 px-3 py-1 rounded transition-colors"
            >
              Start
            </button>
          )}
          {(status === "pending" || status === "in_progress") && (
            <button
              onClick={() => handleAction("complete")}
              className="text-xs font-medium bg-emerald-800/50 hover:bg-emerald-700/50 text-emerald-300 px-3 py-1 rounded transition-colors"
            >
              Complete
            </button>
          )}
          {status === "completed" && (
            <span className="text-xs text-emerald-400 font-medium">✓ Done</span>
          )}
          {status === "in_progress" && (
            <span className="text-xs text-amber-400 font-medium">In Progress</span>
          )}
        </div>
      </div>

      {/* Consequence if ignored */}
      <p className="text-[11px] text-stone-500 italic">
        If ignored: {d.consequenceIfIgnored}
      </p>
    </div>
  );
}
