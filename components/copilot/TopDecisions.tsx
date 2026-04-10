/**
 * TopDecisions — Ranked 1-3 executable decisions from the GM Co-Pilot.
 * Command Center design language — left-border severity, monospace rank, → execute links.
 */

"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { GMDecision, GMDecisionSeverity } from "@/lib/copilot/types";

type Props = {
  decisions: GMDecision[];
};

const SEV_BORDER: Record<GMDecisionSeverity, string> = {
  critical: "border-l-red-500",
  high:     "border-l-amber-500",
  medium:   "border-l-stone-500",
  low:      "border-l-stone-700",
};

const SEV_TEXT: Record<GMDecisionSeverity, string> = {
  critical: "text-red-400",
  high:     "text-amber-400",
  medium:   "text-stone-500 dark:text-stone-400",
  low:      "text-stone-500",
};

export default function TopDecisions({ decisions }: Props) {
  const top = decisions.slice(0, 3);
  if (top.length === 0) {
    return (
      <div className="border border-[#1a1a1a] bg-[#0f0f0f] px-4 py-5">
        <h2 className="text-[9px] uppercase tracking-[0.2em] text-stone-600 font-semibold">
          Top Decisions
        </h2>
        <p className="text-[11px] text-stone-600 mt-3 font-mono">No critical decisions. Operations on track.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h2 className="text-[9px] uppercase tracking-[0.2em] text-stone-600 font-semibold px-1">
        Top Decisions
      </h2>
      <div className="border border-[#1a1a1a] bg-[#0f0f0f] divide-y divide-[#1a1a1a]">
        {top.map((d, i) => (
          <DecisionCard key={d.id} decision={d} rank={i} />
        ))}
      </div>
    </div>
  );
}

function DecisionCard({ decision: d, rank }: { decision: GMDecision; rank: number }) {
  const [status, setStatus] = useState(d.status);
  const [actionId, setActionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [awaitingComment, setAwaitingComment] = useState(false);
  const [comment, setComment] = useState("");

  async function submitComplete(notes: string) {
    if (loading) return;
    setLoading(true);
    try {
      if (!actionId) {
        const res = await fetch("/api/actions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: d.title,
            direct_instruction: d.directInstruction,
            category: d.category,
            severity: d.severity,
            status: "completed",
            owner: d.owner,
            source_type: "copilot",
            expected_impact_text: d.expectedImpactText,
            expected_impact_value: d.expectedImpactValue,
            completion_note: notes || null,
          }),
        });
        if (res.ok) {
          const json = await res.json();
          setActionId(json.action.id);
          setStatus("completed");
        }
      } else {
        const res = await fetch(`/api/actions/${actionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "completed", notes: notes || null }),
        });
        if (res.ok) setStatus("completed");
      }
    } catch {
      // Silent fallback
    } finally {
      setLoading(false);
      setAwaitingComment(false);
      setComment("");
    }
  }

  async function handleEscalate() {
    if (loading) return;
    setLoading(true);
    try {
      if (!actionId) {
        const res = await fetch("/api/actions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: d.title,
            direct_instruction: d.directInstruction,
            category: d.category,
            severity: d.severity,
            status: "escalated",
            owner: d.owner,
            source_type: "copilot",
            expected_impact_text: d.expectedImpactText,
            expected_impact_value: d.expectedImpactValue,
          }),
        });
        if (res.ok) {
          const json = await res.json();
          setActionId(json.action.id);
          setStatus("escalated");
        }
      } else {
        const res = await fetch(`/api/actions/${actionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "escalated" }),
        });
        if (res.ok) setStatus("escalated");
      }
    } catch {
      // Silent fallback
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={cn("border-l-[3px] px-4 py-4 space-y-3", SEV_BORDER[d.severity])}>
      {/* Header: rank + title + severity */}
      <div className="flex items-start gap-3">
        <span className="font-mono text-[11px] text-stone-600 flex-shrink-0 w-4 text-right mt-0.5">
          {rank + 1}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-[13px] font-semibold text-stone-900 dark:text-stone-100 leading-tight">
              {d.title}
            </h3>
            <span className={cn("text-[9px] uppercase tracking-wider font-bold flex-shrink-0", SEV_TEXT[d.severity])}>
              {d.severity}
            </span>
          </div>
          <p className="text-[11px] text-stone-500 dark:text-stone-400 mt-1 leading-snug font-mono">
            {d.directInstruction}
          </p>
        </div>
      </div>

      {/* Why + Impact */}
      <div className="flex gap-4 text-[10px] text-stone-500 ml-7">
        <div>
          <span className="text-stone-700 uppercase tracking-wider text-[9px]">Why </span>
          {d.whyItMatters}
        </div>
        <div className="flex-shrink-0">
          <span className="text-stone-700 uppercase tracking-wider text-[9px]">Impact </span>
          <span className="text-emerald-400/80">{d.expectedImpactText}</span>
        </div>
      </div>

      {/* Bottom row: owner + actions */}
      <div className="flex items-center justify-between ml-7 border-t border-[#1a1a1a] pt-2">
        <div className="flex items-center gap-2">
          {d.owner && (
            <span className="text-[10px] font-mono text-stone-600">{d.owner}</span>
          )}
          {d.dueAt && d.dueAt !== "now" && (
            <span className="text-[10px] text-stone-700">· {d.dueAt}</span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 font-mono text-[10px]">
          {status === "completed" && (
            <span className="text-emerald-500">✓ done</span>
          )}
          {status === "escalated" && (
            <span className="text-red-400">↑ escalated</span>
          )}
          {status === "in_progress" && !awaitingComment && (
            <span className="text-amber-400/70">in progress</span>
          )}
          {(status === "pending" || status === "in_progress") && !awaitingComment && (
            <>
              <button
                onClick={() => setAwaitingComment(true)}
                disabled={loading}
                className="text-stone-500 hover:text-emerald-400 transition-colors disabled:opacity-40"
              >
                → complete
              </button>
              <button
                onClick={handleEscalate}
                disabled={loading}
                className="text-stone-700 hover:text-red-400 transition-colors disabled:opacity-40"
              >
                → escalate
              </button>
            </>
          )}
        </div>
      </div>

      {/* Inline completion comment */}
      {awaitingComment && (
        <div className="ml-7 border border-[#1a1a1a] border-l-[2px] border-l-emerald-700 bg-[#060606] p-3 space-y-2">
          <p className="text-[9px] uppercase tracking-wider text-emerald-500 font-semibold">
            What did you do? — included in HQ daily report
          </p>
          <textarea
            autoFocus
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="e.g. Repositioned 2 servers to floor — avg spend improved within 30 min"
            rows={2}
            className="w-full text-[11px] font-mono bg-[#0f0f0f] border border-[#1a1a1a] px-2 py-1.5 text-stone-600 dark:text-stone-300 placeholder-stone-700 resize-none focus:outline-none focus:border-emerald-800"
          />
          <div className="flex gap-3 justify-end font-mono text-[10px]">
            <button
              onClick={() => { setAwaitingComment(false); setComment(""); }}
              className="text-stone-600 hover:text-stone-400 transition-colors"
            >
              cancel
            </button>
            <button
              onClick={() => submitComplete(comment)}
              disabled={loading}
              className="text-emerald-500 hover:text-emerald-300 transition-colors disabled:opacity-40"
            >
              {loading ? "saving…" : "→ submit"}
            </button>
          </div>
        </div>
      )}

      {/* Consequence if ignored */}
      <p className="text-[10px] text-stone-600 font-mono ml-7 opacity-40 hover:opacity-100 transition-opacity duration-200">
        If ignored → {d.consequenceIfIgnored}
      </p>
    </div>
  );
}
